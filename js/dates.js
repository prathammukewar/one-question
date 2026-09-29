import { LAUNCH_DATE } from './config.js';

// Dates are handled as local calendar keys like '2026-10-01'. Arithmetic runs
// on UTC midnights so daylight saving changes never shift a day.

const DAY_MS = 86400000;
const DAYS_BEFORE_MONTH = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const pad = (n) => String(n).padStart(2, '0');

export function makeKey(y, m, d) {
  return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
}

export function localKey(date = new Date()) {
  return makeKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y, m) {
  return m === 2 && isLeapYear(y) ? 29 : MONTH_LENGTHS[m - 1];
}

export function parseKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key));
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export const isValidKey = (key) => parseKey(key) !== null;

function toUTC(key) {
  const p = parseKey(key);
  if (!p) throw new Error(`Bad date: ${key}`);
  return Date.UTC(p.y, p.m - 1, p.d);
}

function fromUTC(ms) {
  const t = new Date(ms);
  return makeKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// Position in a 366-day year, so March 1 is 60 whether or not the year is leap.
export function questionIndex(key) {
  const p = parseKey(key);
  if (!p) throw new Error(`Bad date: ${key}`);
  return DAYS_BEFORE_MONTH[p.m - 1] + p.d - 1;
}

export function addDays(key, n) {
  return fromUTC(toUTC(key) + n * DAY_MS);
}

export function daysBetween(from, to) {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS);
}

export function issueNumber(key, launch = LAUNCH_DATE) {
  return Math.max(1, daysBetween(launch, key) + 1);
}

export function msUntilTomorrow(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${pad(m)}:${pad(s)}`;
}

const formatters = new Map();
export function formatDate(key, options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) {
  const id = JSON.stringify(options);
  if (!formatters.has(id)) {
    formatters.set(id, new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }));
  }
  return formatters.get(id).format(new Date(toUTC(key)));
}

export const formatShort = (key) => formatDate(key, { month: 'long', day: 'numeric', year: 'numeric' });

export function monthLabel(y, m) {
  return formatDate(makeKey(y, m, 1), { month: 'long', year: 'numeric' });
}

export function shiftMonth(y, m, delta) {
  const index = y * 12 + (m - 1) + delta;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

// Weeks of a month, Sunday first, padded with nulls.
export function monthGrid(y, m) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells = Array(first).fill(null);
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push(makeKey(y, m, d));
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
