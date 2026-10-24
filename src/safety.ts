import type { AttackPayload } from './protocol.js';

const MANUAL_MAX_LENGTH = 1000;
const BANNED_TERMS = [
  /\b(?:fuck|shit|bitch|bastard|asshole|cunt|nigger|faggot)\b/iu,
  /\b(?:anjing|bangsat|bajingan|kontol|memek|tolol|goblok|brengsek|jancuk|asu)\b/iu,
  /\b(?:bunuh|bakar|bom)\b/iu,
];

export function validNickname(input: unknown): input is string {
  return typeof input === 'string' && /^[a-zA-Z0-9_]{2,12}$/.test(input);
}

export function hasProfanity(value: string): boolean {
  return BANNED_TERMS.some((pattern) => pattern.test(value));
}

export function sanitizeNickname(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 12);
}

export function buildAttackText(payload: AttackPayload): string {
  return [payload.kedok, payload.alasan, payload.taktik].filter(Boolean).join('. ').slice(0, MANUAL_MAX_LENGTH);
}

export function validateAttack(payload: unknown, manual: unknown, manualEnabled: boolean): { ok: true; text: string; payload: AttackPayload } | { ok: false; reason: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'INVALID_PAYLOAD' };
  const raw = payload as Record<string, unknown>;
  const normalized: AttackPayload = {};
  for (const field of ['kedok', 'alasan', 'taktik'] as const) {
    const value = raw[field];
    if (value !== undefined && (typeof value !== 'string' || value.length > MANUAL_MAX_LENGTH)) return { ok: false, reason: 'INVALID_PAYLOAD' };
    if (typeof value === 'string') normalized[field] = value;
  }
  if (manual !== undefined && typeof manual !== 'string') return { ok: false, reason: 'INVALID_PAYLOAD' };
  const usesManual = typeof manual === 'string' && manual.length > 0;
  if (usesManual && !manualEnabled) return { ok: false, reason: 'MANUAL_DISABLED' };
  if (usesManual && manual.length > MANUAL_MAX_LENGTH) return { ok: false, reason: 'MANUAL_TOO_LONG' };
  if (!usesManual && (!normalized.kedok || !normalized.alasan || !normalized.taktik)) return { ok: false, reason: 'INVALID_PAYLOAD' };
  const text = usesManual ? manual as string : buildAttackText(normalized);
  if (hasProfanity(text)) return { ok: false, reason: 'CONTENT_FILTERED' };
  return { ok: true, text, payload: normalized };
}

export function displayAttack(text: string, panicBlur: boolean): string {
  return panicBlur ? '[SENSOR OTOMATIS]' : text;
}
