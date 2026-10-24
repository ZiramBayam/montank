export type Phase = 'LOBBY_OPEN' | 'ROUND_1_RAW' | 'ROUND_2_SHIELD' | 'GAME_OVER';
export type GuardianDecision = 'CLEAR' | 'VETO';

export interface AttackPayload {
  kedok?: string;
  alasan?: string;
  taktik?: string;
}

export interface Claim {
  claimId: string;
  category: string;
  recipient: `0x${string}`;
  amount: string;
  status: 'unpaid' | 'paid';
}

export interface VictimResult {
  tricked: boolean;
  reason: string;
  claimId: string;
  category: string;
  recipient: `0x${string}`;
  amount: string;
  source: 'gemini' | 'fallback parser' | 'rehearsal';
}

export interface VoteResult {
  guardianId: number;
  decision: GuardianDecision;
  reasonCode: number;
  ms: number;
}

export interface AttackRecord {
  attackId: string;
  playerId: string;
  nickname: string;
  payload: AttackPayload;
  text: string;
  createdAt: number;
  simulated: boolean;
  status: 'QUEUED' | 'PROCESSING' | 'PROPOSED' | 'RESOLVED';
  actionId?: `0x${string}`;
  victim?: VictimResult;
  points?: number;
  arrivalOrder?: number;
}

export interface Player {
  playerId: string;
  nickname: string;
  ip: string;
  score: number;
  scoreOrderAt?: number;
  joinedAt: number;
  cooldownUntil: number;
  activeAttackId?: string;
  disconnectedAt?: number;
}

export interface GameState {
  phase: Phase;
  tMsLeft: number;
  vaultOn: boolean;
  rehearsal: boolean;
  panicBlur: boolean;
}

export const PHASE_DURATIONS: Record<Phase, number> = {
  LOBBY_OPEN: 60_000,
  ROUND_1_RAW: 60_000,
  ROUND_2_SHIELD: 120_000,
  GAME_OVER: 60_000,
};

export const PRESET_CARDS = {
  kedok: ['👑 Founder Monad', '😭 Anak Kos Nunggak', '🚨 Auditor Keamanan', '🤖 Sistem Internal'],
  alasan: ['Tagihan Server Meledak', 'Klaim Bounty PR #99', 'Beli Kopi Se-Venue', 'Refund Transaksi Gagal'],
  taktik: ['Tarik 4.9 MON (di bawah limit)', 'Mode Darurat Tanpa Cek', 'Pura-Pura Simulasi', 'Pecah Jadi 4.9 MON Berkali-kali'],
} as const;
