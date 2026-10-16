import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export class Problem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireThat(condition, status, message) {
  if (!condition) throw new Problem(status, message);
}
export const id = () => randomBytes(18).toString('base64url');
export const digest = value => createHash('sha256').update(String(value)).digest('hex');
export function equal(a, b) {
  const left = Buffer.from(String(a ?? '')); const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && timingSafeEqual(left, right);
}
export function phone(value) {
  const raw = String(value ?? '').replace(/[\s().-]/g, '');
  const normalized = /^\d{10}$/.test(raw) ? `+1${raw}` : /^1\d{10}$/.test(raw) ? `+${raw}` : raw;
  requireThat(/^\+[1-9]\d{7,14}$/.test(normalized), 400, 'Enter a valid phone number with country code.');
  return normalized;
}
export function text(value, name, max = 120) {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, 400, `Enter ${name} (up to ${max} characters).`);
  return value.trim();
}
export function integer(value, min, max, name) {
  requireThat(Number.isSafeInteger(value) && value >= min && value <= max, 400, `Invalid ${name}.`);
  return value;
}
export function quotePrice(event, now) {
  requireThat(now < event.starts_at, 409, 'Sales have closed for this game.');
  const hours = (event.starts_at - now) / 3_600_000;
  const factor = hours <= 24 ? 1.5 : hours <= 72 ? 1.25 : 1;
  return Math.round(event.base_price_cents * factor);
}
export function priorityPrice(baseCents, ahead) {
  integer(ahead, 0, 3, 'priority queue capacity');
  return baseCents * (2 ** ahead);
}
export function overlap(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && bStart < aEnd; }
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
