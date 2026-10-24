import { isAddress, parseEther } from 'viem';
import { config } from './config.js';
import { runP3, type P3Result } from './ai.js';
import type { AttackRecord, Claim, GuardianDecision, VictimResult, VoteResult } from './protocol.js';

interface VelocityRecord { recipient: string; amount: bigint; at: number; }

export class GuardianService {
  private velocity: VelocityRecord[] = [];
  private claims = new Map<string, Claim>();

  constructor(private readonly onP3?: (result: P3Result) => void) {}

  async loadClaims(): Promise<void> {
    const { readFile } = await import('node:fs/promises');
    try {
      const claims = JSON.parse(await readFile(config.claimsFile, 'utf8')) as Claim[];
      for (const claim of claims) {
        if (!claim || typeof claim.claimId !== 'string' || !isAddress(claim.recipient) || !['unpaid', 'paid'].includes(claim.status)) continue;
        this.claims.set(claim.claimId, claim);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Could not load claim ledger:', error);
    }
  }

  getClaim(claimId: string): Claim | undefined { return this.claims.get(claimId); }

  async evaluate(attack: AttackRecord, victim: VictimResult, rehearsal: boolean, p3Promise?: Promise<P3Result>): Promise<VoteResult[]> {
    const p3Start = performance.now();
    const [p1, p2, p3] = await Promise.all([
      Promise.resolve(this.guardP1(victim)),
      config.guardianMask === 7 ? Promise.resolve(this.guardP2(victim)) : Promise.resolve(undefined),
      config.guardianMask === 7 ? (p3Promise ? p3Promise.then((result) => ({ ...result, ms: Math.round(performance.now() - p3Start) })) : this.guardP3(attack.text, rehearsal)) : Promise.resolve(undefined),
    ]);
    const decisions: Array<{ decision: GuardianDecision; reasonCode: number; ms: number }> = [
      p1,
      ...(p2 ? [p2] : []),
      ...(p3 ? [{ decision: p3.decision, reasonCode: p3.reasonCode, ms: p3.ms }] : []),
    ];
    if (p3) this.onP3?.({ decision: p3.decision, reasonCode: p3.reasonCode, source: p3.source });
    return decisions.map((entry, index) => ({ guardianId: index + 1, ...entry }));
  }

  markPaid(claimId: string): void {
    const claim = this.claims.get(claimId);
    if (!claim) return;
    claim.status = 'paid';
    void import('node:fs/promises').then(({ writeFile }) => writeFile(config.claimsFile, JSON.stringify([...this.claims.values()], null, 2), 'utf8'))
      .catch((error) => console.error('Could not update claim ledger:', error));
  }

  private guardP1(victim: VictimResult): { decision: GuardianDecision; reasonCode: number; ms: number } {
    const start = performance.now();
    const now = Date.now();
    this.velocity = this.velocity.filter((record) => now - record.at < config.newRecipientWindowMs);
    if (!isAddress(victim.recipient)) return { decision: 'VETO', reasonCode: 21, ms: Math.round(performance.now() - start) };
    if (config.blockedAddresses.has(victim.recipient.toLowerCase())) return { decision: 'VETO', reasonCode: 22, ms: Math.round(performance.now() - start) };
    let amount: bigint;
    try { amount = parseEther(victim.amount); } catch { return { decision: 'VETO', reasonCode: 23, ms: Math.round(performance.now() - start) }; }
    const recipients = new Set(this.velocity.map((record) => record.recipient));
    const total = this.velocity.reduce((sum, record) => sum + record.amount, 0n);
    const recipientAlreadySeen = recipients.has(victim.recipient.toLowerCase());
    const distinctCount = recipients.size + (recipientAlreadySeen ? 0 : 1);
    const maxAmount = parseEther(String(config.maxNewRecipientAmount));
    const veto = distinctCount > config.maxNewRecipientsPerWindow || total + amount > maxAmount;
    if (!veto) this.velocity.push({ recipient: victim.recipient.toLowerCase(), amount, at: now });
    return { decision: veto ? 'VETO' : 'CLEAR', reasonCode: veto ? 24 : 0, ms: Math.round(performance.now() - start) };
  }

  private guardP2(victim: VictimResult): { decision: GuardianDecision; reasonCode: number; ms: number } {
    const start = performance.now();
    const claim = this.claims.get(victim.claimId);
    if (!claim || claim.status !== 'unpaid') return { decision: 'VETO', reasonCode: 31, ms: Math.round(performance.now() - start) };
    let claimAmount: bigint;
    let requested: bigint;
    try { claimAmount = parseEther(claim.amount); requested = parseEther(victim.amount); }
    catch { return { decision: 'VETO', reasonCode: 32, ms: Math.round(performance.now() - start) }; }
    const matches = claim.recipient.toLowerCase() === victim.recipient.toLowerCase() && claimAmount === requested && claim.category.toLowerCase() === victim.category.toLowerCase();
    return { decision: matches ? 'CLEAR' : 'VETO', reasonCode: matches ? 0 : 33, ms: Math.round(performance.now() - start) };
  }

  private async guardP3(text: string, rehearsal: boolean): Promise<P3Result & { ms: number }> {
    const start = performance.now();
    try {
      const result = await runP3(text, rehearsal);
      return { ...result, ms: Math.round(performance.now() - start) };
    } catch {
      // Fail closed if the scanner itself fails; never convert an unavailable guard to Clear.
      return { decision: 'VETO', reasonCode: 19, source: 'regex', ms: Math.round(performance.now() - start) };
    }
  }
}
