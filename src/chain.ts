import {
  createPublicClient, createWalletClient, decodeEventLog, formatEther,
  http, keccak256, parseAbi, parseEther, toBytes, type Address, type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config, liveChainConfigured } from './config.js';
import type { AttackRecord, GuardianDecision, VoteResult } from './protocol.js';

const chain = { id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [config.rpcHttp], webSocket: [config.wsPrimary] } } } as const;
const abi = parseAbi([
  'function proposeAction(bytes32 actionId, address to, uint96 amount, bytes32 intentHash)',
  'function submitDecision(bytes32 actionId, bool isVeto, uint8 reasonCode)',
  'function executeAction(bytes32 actionId)',
  'function actions(bytes32 actionId) view returns (address proposer, uint96 amount, address to, uint64 expireBlock, uint8 status, bytes32 intentHash)',
  'function payees(address) view returns (bool registered, uint96 perTxCap, uint96 perWindowCap, uint96 spentInWindow, uint64 windowStartBlock)',
  'event ActionProposed(bytes32 indexed actionId, address indexed to, uint256 amount, uint64 expireBlock, bytes32 intentHash)',
  'event Layer0Rejected(bytes32 indexed actionId, address indexed to, uint256 amount, uint8 reasonCode)',
  'event GuardianDecision(bytes32 indexed actionId, uint8 indexed guardianId, bool isVeto, uint8 reasonCode)',
  'event ActionResolved(bytes32 indexed actionId, uint8 status, uint256 amount)',
]);
const eventTopics = new Map<string, string>([
  [keccak256(toBytes('ActionProposed(bytes32,address,uint256,uint64,bytes32)')).toLowerCase(), 'ActionProposed'],
  [keccak256(toBytes('Layer0Rejected(bytes32,address,uint256,uint8)')).toLowerCase(), 'Layer0Rejected'],
  [keccak256(toBytes('GuardianDecision(bytes32,uint8,bool,uint8)')).toLowerCase(), 'GuardianDecision'],
  [keccak256(toBytes('ActionResolved(bytes32,uint8,uint256)')).toLowerCase(), 'ActionResolved'],
]);

export interface ChainHooks {
  onActionProposed(actionId: `0x${string}`, log: ChainLog, attack?: AttackRecord): Promise<void> | void;
  onLayer0Rejected(actionId: `0x${string}`, reasonCode: number, txHash?: string, attack?: AttackRecord): void;
  onGuardianDecision(actionId: `0x${string}`, guardianId: number, isVeto: boolean, reasonCode: number): void;
  onActionResolved(actionId: `0x${string}`, status: number, amount: bigint, txHash?: string): void;
  onPipeline(actionId: `0x${string}`, commitState: string, txHash?: string): void;
  onListenerStatus(status: { primary: boolean; backup: boolean; message?: string }): void;
  onTreasury(balance: string, held: string): void;
  onError(message: string): void;
}

interface ChainLog {
  address?: string;
  topics?: string[];
  data?: string;
  transactionHash?: string;
  blockId?: string;
  blockNumber?: string;
  commitState?: string | number;
}

export class ChainService {
  private readonly publicClient = createPublicClient({ chain, transport: http(config.rpcHttp) });
  private readonly triggeredActions = new Set<string>();
  private readonly uiCommitStates = new Set<string>();
  private readonly pipelineRanks = new Map<string, number>();
  private readonly guardianSubmissions = new Set<string>();
  private readonly seenGuardianDecisions = new Set<string>();
  private readonly handledLayer0Rejections = new Set<string>();
  private readonly executedActions = new Set<string>();
  private readonly sockets = new Set<WebSocket>();
  private readonly resolved = new Set<string>();
  private readonly pendingResolved = new Map<string, { actionId: `0x${string}`; status: number; amount: bigint; txHash?: string }>();
  private readonly reconciliations = new Set<string>();
  private readonly listenerStatus = { primary: false, backup: false };
  private heldWei = 0n;
  private timer?: NodeJS.Timeout;
  private hooks?: ChainHooks;
  private stopping = false;
  private readonly actionContexts = new Map<string, AttackRecord>();
  private readonly pathA = new Set<string>();
  private readonly accountQueues = new Map<string, Promise<void>>();
  private workerCursor = 0;
  private readonly guardianAccounts = config.guardianPrivateKeys.map((key) => key ? privateKeyToAccount(key) : undefined);
  private readonly workers = config.workerPrivateKeys.map((key) => privateKeyToAccount(key));
  private readonly executor = config.executorPrivateKey ? privateKeyToAccount(config.executorPrivateKey) : undefined;

  constructor() {}

  get configured(): boolean { return liveChainConfigured(); }

  isRegisteredAction(actionId: string): boolean { return this.pathA.has(actionId.toLowerCase()); }

  setHooks(hooks: ChainHooks): void { this.hooks = hooks; }

  start(): void {
    this.stopping = false;
    if (!this.configured) {
      this.hooks?.onListenerStatus({ primary: false, backup: false, message: 'Chain dinonaktifkan: isi alamat vault dan key EOA di .env' });
      return;
    }
    this.connect(config.wsPrimary, 'primary');
    this.connect(config.wsBackup, 'backup');
    this.timer = setInterval(() => void this.refreshTreasury(), 5000);
    void this.refreshTreasury();
  }

  stop(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    for (const socket of this.sockets) socket.close();
    this.sockets.clear();
  }

  bindAction(actionId: `0x${string}`, attack: AttackRecord): void { this.actionContexts.set(actionId.toLowerCase(), attack); }

  async propose(attack: AttackRecord, recipient: Address, amount: string, rehearsal = false): Promise<{ actionId: `0x${string}`; txHash?: Hash; pathA: boolean }> {
    const actionId = randomActionId();
    const intentHash = keccak256(toBytes(attack.text));
    attack.actionId = actionId;
    this.bindAction(actionId, attack);
    if (rehearsal || !this.configured) return { actionId, pathA: false };
    const payee = await this.publicClient.readContract({ address: config.vaultAddress, abi, functionName: 'payees', args: [recipient] });
    const pathA = payee[0];
    if (pathA) this.pathA.add(actionId.toLowerCase());
    const worker = this.nextWorker();
    const client = createWalletClient({ account: worker, chain, transport: http(config.rpcHttp) });
    const txHash = await this.serialize(worker.address, () => client.writeContract({
        address: config.vaultAddress, abi, functionName: 'proposeAction',
        args: [actionId, recipient, parseEther(amount), intentHash],
        gas: config.proposeGasLimit,
        maxPriorityFeePerGas: config.maxPriorityFeePerGas,
      }));
    return { actionId, txHash, pathA };
  }

  async rawTransfer(recipient: Address, amount: string): Promise<Hash> {
    if (!this.configured) throw new Error('Live worker wallet is not configured');
    const value = parseEther(amount);
    if (value > parseEther('5')) throw new Error('Raw demo transfer exceeds 5 MON safety cap');
    const worker = this.nextWorker();
    const wallet = createWalletClient({ account: worker, chain, transport: http(config.rpcHttp) });
    return this.serialize(worker.address, () => wallet.sendTransaction({ to: recipient, value, gas: 21_000n, maxPriorityFeePerGas: config.maxPriorityFeePerGas }));
  }

  async submitDecisions(actionId: `0x${string}`, votes: VoteResult[]): Promise<void> {
    if (!this.configured) return;
    await Promise.all(votes.map(async (vote) => {
      const key = `${actionId.toLowerCase()}:${vote.guardianId}`;
      if (this.guardianSubmissions.has(key)) return;
      const account = this.guardianAccounts[vote.guardianId - 1];
      if (!account) return;
      const wallet = createWalletClient({ account, chain, transport: http(config.rpcHttp) });
      try {
        await this.serialize(account.address, async () => {
          const txHash = await wallet.writeContract({
            address: config.vaultAddress, abi, functionName: 'submitDecision',
            args: [actionId, vote.decision === 'VETO', vote.reasonCode],
            gas: config.decisionGasLimit,
            maxPriorityFeePerGas: config.maxPriorityFeePerGas,
          });
          this.guardianSubmissions.add(key);
          void this.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 }).catch((error) => {
            this.guardianSubmissions.delete(key);
            this.hooks?.onError(`Guardian ${vote.guardianId} transaction was not confirmed: ${error instanceof Error ? error.message : String(error)}`);
          });
        });
      } catch (error) {
        this.hooks?.onError(`Guardian ${vote.guardianId} transaction failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
  }

  async execute(actionId: `0x${string}`): Promise<void> {
    if (!this.configured || this.executedActions.has(actionId.toLowerCase()) || !this.executor) return;
    this.executedActions.add(actionId.toLowerCase());
    const wallet = createWalletClient({ account: this.executor, chain, transport: http(config.rpcHttp) });
    try {
      await this.serialize(this.executor.address, () => wallet.writeContract({
          address: config.vaultAddress, abi, functionName: 'executeAction', args: [actionId],
          gas: config.executeGasLimit, maxPriorityFeePerGas: config.maxPriorityFeePerGas,
        }));
    } catch (error) {
      this.executedActions.delete(actionId.toLowerCase());
      this.hooks?.onError(`executeAction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private connect(url: string, label: 'primary' | 'backup'): void {
    let socket: WebSocket;
    try { socket = new WebSocket(url); }
    catch (error) {
      this.hooks?.onError(`${label} Monad WebSocket could not start: ${String(error)}`);
      this.reconnect(url, label);
      return;
    }
    this.sockets.add(socket);
    let subscribed = false;
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['monadLogs', { address: config.vaultAddress }] }));
    });
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { id?: number; result?: string; error?: { message?: string }; params?: { result?: ChainLog } };
        if (message.id === 1) {
          subscribed = Boolean(message.result);
          this.publishListenerStatus(label, subscribed, message.error?.message);
          return;
        }
        if (message.params?.result) void this.handleLog(message.params.result);
      } catch (error) { this.hooks?.onError(`Bad ${label} monadLogs frame: ${String(error)}`); }
    });
    socket.addEventListener('close', () => {
      this.sockets.delete(socket);
      this.publishListenerStatus(label, false, 'connection closed');
      this.reconnect(url, label);
    });
    socket.addEventListener('error', () => this.publishListenerStatus(label, false, 'socket error'));
  }

  private reconnect(url: string, label: 'primary' | 'backup'): void {
    setTimeout(() => { if (this.configured && !this.stopping) this.connect(url, label); }, 1500 + Math.random() * 1500).unref();
  }

  private publishListenerStatus(label: 'primary' | 'backup', active: boolean, message?: string): void {
    this.listenerStatus[label] = active;
    this.hooks?.onListenerStatus({ ...this.listenerStatus, ...(message ? { message } : {}) });
  }

  private async handleLog(log: ChainLog): Promise<void> {
    const topic0 = log.topics?.[0]?.toLowerCase();
    const eventName = topic0 ? eventTopics.get(topic0) : undefined;
    if (!eventName) return;
    const commitState = normalizeCommitState(log.commitState);
    try {
      const decoded = decodeEventLog({ abi, data: (log.data ?? '0x') as `0x${string}`, topics: (log.topics ?? []) as [`0x${string}`, ...`0x${string}`[]], strict: false }) as { eventName: string; args: Record<string, unknown> };
      const args = decoded.args;
      if (eventName === 'ActionProposed') {
        const actionId = String(args.actionId).toLowerCase() as `0x${string}`;
        if (!this.triggeredActions.has(actionId)) {
          this.triggeredActions.add(actionId);
          if (!this.pathA.has(actionId)) this.heldWei += BigInt(String(args.amount));
          this.hooks?.onPipeline(actionId, commitState, log.transactionHash);
          const context = this.actionContexts.get(actionId);
          if (context && !this.pathA.has(actionId)) {
            await this.hooks?.onActionProposed(actionId, log, context);
            this.scheduleReconciliation(actionId);
          }
        } else this.publishPipelineOnce(actionId, commitState, log.transactionHash);
      } else if (eventName === 'Layer0Rejected') {
        const actionId = String(args.actionId).toLowerCase() as `0x${string}`;
        if (commitStateRank(commitState) >= 2 && !this.handledLayer0Rejections.has(actionId)) {
          this.handledLayer0Rejections.add(actionId);
          this.hooks?.onLayer0Rejected(actionId, Number(args.reasonCode), log.transactionHash, this.actionContexts.get(actionId));
        }
      } else if (eventName === 'GuardianDecision') {
        const actionId = String(args.actionId).toLowerCase() as `0x${string}`;
        const guardianId = Number(args.guardianId);
        const isVeto = Boolean(args.isVeto);
        const key = `${actionId}:${guardianId}`;
        if (!this.seenGuardianDecisions.has(key)) {
          this.seenGuardianDecisions.add(key);
          this.hooks?.onGuardianDecision(actionId, guardianId, isVeto, Number(args.reasonCode));
          const requiredIds = config.guardianMask === 1 ? [1] : [1, 2, 3];
          if (isVeto || requiredIds.every((id) => this.guardianSubmissions.has(`${actionId}:${id}`))) {
            await this.execute(actionId);
          }
        }
      } else if (eventName === 'ActionResolved') {
        const actionId = String(args.actionId).toLowerCase() as `0x${string}`;
        const status = Number(args.status);
        const amount = BigInt(String(args.amount));
        if (commitStateRank(commitState) >= 2) {
          this.finishResolution(actionId, status, amount, log.transactionHash);
        } else {
          this.pendingResolved.set(actionId, { actionId, status, amount, ...(log.transactionHash ? { txHash: log.transactionHash } : {}) });
        }
        void this.refreshTreasury();
      }
      if (eventName !== 'ActionProposed') this.publishPipelineOnce(String(args.actionId).toLowerCase() as `0x${string}`, commitState, log.transactionHash);
      void this.refreshTreasury();
    } catch (error) {
      this.hooks?.onError(`Cannot decode Monad log ${eventName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private publishPipelineOnce(actionId: `0x${string}`, commitState: string, txHash?: string): void {
    const key = `${actionId}:${commitState}`;
    if (this.uiCommitStates.has(key)) return;
    const rank = commitStateRank(commitState);
    const prior = this.pipelineRanks.get(actionId.toLowerCase()) ?? -1;
    if (rank < prior) return;
    this.pipelineRanks.set(actionId.toLowerCase(), rank);
    this.uiCommitStates.add(key);
    this.hooks?.onPipeline(actionId, commitState, txHash);
  }

  private nextWorker() {
    if (this.workers.length === 0) throw new Error('No Worker private key is configured');
    const worker = this.workers[this.workerCursor % this.workers.length]!;
    this.workerCursor++;
    return worker;
  }

  private async serialize<T>(address: Address, operation: () => Promise<T>): Promise<T> {
    const key = address.toLowerCase();
    const previous = this.accountQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.accountQueues.set(key, current);
    await previous;
    try { return await operation(); }
    finally {
      release();
      if (this.accountQueues.get(key) === current) this.accountQueues.delete(key);
    }
  }

  private finishResolution(actionId: `0x${string}`, status: number, amount: bigint, txHash?: string): void {
    const key = actionId.toLowerCase();
    if (this.resolved.has(key)) return;
    this.resolved.add(key);
    this.pendingResolved.delete(key);
    this.heldWei = this.heldWei > amount ? this.heldWei - amount : 0n;
    this.hooks?.onActionResolved(actionId, status, amount, txHash);
    void this.refreshTreasury();
  }

  private scheduleReconciliation(actionId: `0x${string}`): void {
    const key = actionId.toLowerCase();
    if (this.reconciliations.has(key)) return;
    this.reconciliations.add(key);
    const timer = setTimeout(() => {
      void this.publicClient.readContract({ address: config.vaultAddress, abi, functionName: 'actions', args: [actionId] })
        .then((action) => {
          const status = Number(action[4]);
          if (status > 1 && !this.resolved.has(key)) this.finishResolution(actionId, status, BigInt(action[1]));
          else if (status === 0 && !this.resolved.has(key)) {
            const amount = this.pendingResolved.get(key)?.amount ?? 0n;
            this.heldWei = this.heldWei > amount ? this.heldWei - amount : 0n;
            this.pendingResolved.delete(key);
            void this.refreshTreasury();
          }
        })
        .catch((error) => this.hooks?.onError(`One-shot reconciliation failed: ${error instanceof Error ? error.message : String(error)}`));
    }, 5000);
    timer.unref();
  }

  private async refreshTreasury(): Promise<void> {
    if (!config.vaultAddress || !this.hooks) return;
    try {
      const balance = await this.publicClient.getBalance({ address: config.vaultAddress });
      this.hooks.onTreasury(formatEther(balance), formatEther(this.heldWei));
    } catch (error) { this.hooks.onError(`Could not read vault balance: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

function randomActionId(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function normalizeCommitState(raw?: string | number): string {
  if (typeof raw === 'string') {
    const normalized = raw.toLowerCase();
    if (['proposed', 'voted', 'finalized', 'verified'].includes(normalized)) return normalized[0]!.toUpperCase() + normalized.slice(1);
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return normalizeCommitState(numeric);
  }
  const states = ['Proposed', 'Voted', 'Finalized', 'Verified'];
  return states[Math.min(Math.max(Number(raw ?? 0), 0), states.length - 1)]!;
}

function commitStateRank(state: string): number {
  return ({ Proposed: 0, Voted: 1, Finalized: 2, Verified: 3 } as Record<string, number>)[state] ?? -1;
}
