import { isAddress, type Address } from 'viem';

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  return value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function number(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: number('PORT', 3000),
  baseUrl: (process.env.BASE_URL ?? '').replace(/\/$/, ''),
  hostToken: process.env.HOST_TOKEN ?? '',
  trustProxy: bool('TRUST_PROXY', false),
  rehearsal: bool('REHEARSAL', true),
  rehearsalVictimTricked: bool('REHEARSAL_VICTIM_TRICKED', true),
  panicBlur: bool('PANIC_BLUR', false),
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite',
  geminiTimeoutMs: number('GEMINI_TIMEOUT_MS', 1200),
  guardianTimeoutMs: number('GUARDIAN_TIMEOUT_MS', 250),
  guardianMask: Number(process.env.GUARDIAN_MASK ?? '7'),
  chainId: Number(process.env.MONAD_CHAIN_ID ?? 10143),
  rpcHttp: process.env.MONAD_RPC_HTTP ?? 'https://testnet-rpc.monad.xyz',
  wsPrimary: process.env.MONAD_WS_PRIMARY ?? 'wss://testnet-rpc.monad.xyz',
  wsBackup: process.env.MONAD_WS_BACKUP ?? 'wss://rpc-testnet.monadinfra.com',
  vaultAddress: (process.env.AEGIS_VAULT_ADDRESS ?? '') as Address,
  workerPrivateKeys: (process.env.WORKER_PRIVATE_KEYS ?? '').split(',').map((v) => v.trim()).filter(Boolean) as `0x${string}`[],
  guardianPrivateKeys: [
    process.env.GUARDIAN_1_PRIVATE_KEY?.trim() ?? '',
    process.env.GUARDIAN_2_PRIVATE_KEY?.trim() ?? '',
    process.env.GUARDIAN_3_PRIVATE_KEY?.trim() ?? '',
  ] as const as readonly [`0x${string}` | '', `0x${string}` | '', `0x${string}` | ''],
  executorPrivateKey: (process.env.EXECUTOR_PRIVATE_KEY ?? '') as `0x${string}`,
  monadScanTxBaseUrl: process.env.MONADSCAN_TX_BASE_URL ?? 'https://testnet.monadscan.com/tx/',
  proposeGasLimit: BigInt(process.env.PROPOSE_GAS_LIMIT ?? '120000'),
  decisionGasLimit: BigInt(process.env.DECISION_GAS_LIMIT ?? '95000'),
  executeGasLimit: BigInt(process.env.EXECUTE_GAS_LIMIT ?? '120000'),
  maxPriorityFeePerGas: BigInt(Math.floor(Number(process.env.MAX_PRIORITY_FEE_GWEI ?? '2') * 1e9)),
  queueMax: number('QUEUE_MAX', 12),
  playerCap: number('PLAYER_CAP', 40),
  joinsPerIp: number('JOINS_PER_IP', 3),
  attackCooldownMs: number('ATTACK_COOLDOWN_MS', 5000),
  serviceIntervalMs: number('SERVICE_INTERVAL_MS', 1200),
  maxNewRecipientsPerWindow: number('MAX_NEW_RECIPIENTS_PER_WINDOW', 6),
  newRecipientWindowMs: number('NEW_RECIPIENT_WINDOW_MS', 60000),
  maxNewRecipientAmount: Number(process.env.MAX_NEW_RECIPIENT_AMOUNT ?? '5'),
  claimsFile: process.env.CLAIMS_FILE ?? './claims.json',
  blockedAddresses: new Set((process.env.BLOCKED_ADDRESSES ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)),
  demoRecipient: (process.env.DEMO_RECIPIENT ?? '') as Address,
  demoAmount: process.env.DEMO_AMOUNT ?? '0.1',
  vendorRecipient: (process.env.VENDOR_RECIPIENT ?? '') as Address,
  rawDemoRecipient: (process.env.RAW_DEMO_RECIPIENT ?? '') as Address,
  rawDemoAmount: process.env.RAW_DEMO_AMOUNT ?? '0.1',
} as const;

if (config.nodeEnv === 'production' && config.hostToken.length < 24) {
  throw new Error('HOST_TOKEN must be set to at least 24 characters in production');
}
if (config.vaultAddress && !isAddress(config.vaultAddress)) throw new Error('AEGIS_VAULT_ADDRESS is invalid');
if (config.chainId !== 10143) throw new Error('This demo backend is configured for Monad Testnet chain ID 10143');
if (config.guardianMask !== 1 && config.guardianMask !== 7) throw new Error('GUARDIAN_MASK must be 1 (P0) or 7 (three-guardian mode)');

export function liveChainConfigured(): boolean {
  const guardiansReady = config.guardianMask === 1
    ? Boolean(config.guardianPrivateKeys[0])
    : config.guardianPrivateKeys.every(Boolean);
  return Boolean(config.vaultAddress && config.workerPrivateKeys.length && guardiansReady && config.executorPrivateKey);
}
