import type { AttackPayload, PromptQuality } from './protocol.js';
import { config } from './config.js';

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

export function evaluatePromptQuality(text: string): PromptQuality {
  const normalized = text.trim();
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const feedback: string[] = [];
  let score = 0;

  const hasClearAction = /\b(?:mohon|tolong|please|request|send|transfer|pay|release|claim|process|kirim|bayar|tarik|ajukan|proses|refund)\b/iu.test(normalized);
  const hasContext = /\b(?:karena|sebab|untuk|agar|because|since|for|due to|claim|bounty|invoice|tagihan|refund|audit|server|vendor)\b/iu.test(normalized);
  const hasSpecificDetail = /(?:\b\d+(?:[.,]\d+)?\s?(?:mon|eth)?\b|\bpr\s*#?\d+\b|\b0x[a-f\d]{40}\b|\b(?:invoice|claim)\s*(?:id|#)\s?[a-z\d-]+)/iu.test(normalized);
  const hasCoherentFlow = /\b(?:karena|sebab|agar|sehingga|because|since|so that|therefore)\b/iu.test(normalized)
    || /[.!?]\s+\p{L}/u.test(normalized);

  if (hasClearAction) score += 25;
  else feedback.push('Jelaskan tindakan yang diminta.');
  if (hasContext) score += 20;
  else feedback.push('Tambahkan konteks atau alasan.');
  if (hasSpecificDetail) score += 25;
  else feedback.push('Sertakan detail konkret, misalnya jumlah atau referensi.');
  if (hasCoherentFlow && words.length >= 6) score += 20;
  else feedback.push('Hubungkan konteks dan permintaan dengan alur yang jelas.');
  if (words.length >= 12 && words.length <= 60) score += 10;
  else if (words.length >= 6 && words.length <= 90) score += 5;
  else feedback.push('Buat prompt cukup ringkas tetapi tetap lengkap.');

  if (feedback.length === 0) feedback.push('Prompt jelas, kontekstual, spesifik, dan ringkas.');
  return { score, bonus: score * 2, feedback: feedback.slice(0, 3) };
}

export function validateAttack(payload: unknown, manual: unknown): { ok: true; text: string; payload: AttackPayload } | { ok: false; reason: string } {
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
  if (usesManual && !config.manualAttacksEnabled) return { ok: false, reason: 'MANUAL_DISABLED' };
  if (usesManual && manual.length > MANUAL_MAX_LENGTH) return { ok: false, reason: 'MANUAL_TOO_LONG' };
  if (!usesManual && (!normalized.kedok || !normalized.alasan || !normalized.taktik)) return { ok: false, reason: 'INVALID_PAYLOAD' };
  const text = usesManual ? manual as string : buildAttackText(normalized);
  if (hasProfanity(text)) return { ok: false, reason: 'CONTENT_FILTERED' };
  return { ok: true, text, payload: normalized };
}

export function displayAttack(text: string, panicBlur: boolean): string {
  return panicBlur ? '[SENSOR OTOMATIS]' : text;
}
