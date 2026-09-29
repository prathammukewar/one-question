import { localKey } from './dates.js';

// An answer: { date, question, text, writtenOn, createdAt, updatedAt }.
// `date` is the question's date. `writtenOn` is the local date it was first
// written. When they differ, the answer is late.

export function wordCount(text) {
  const trimmed = String(text || '').trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function isLate(entry) {
  return entry.writtenOn !== entry.date;
}

export function upsertAnswer(answers, date, text, { now = new Date(), question = '' } = {}) {
  const next = { ...answers };
  if (!String(text).trim()) {
    delete next[date];
    return next;
  }
  const stamp = now.toISOString();
  const existing = answers[date];
  next[date] = existing
    ? { ...existing, text, updatedAt: stamp }
    : { date, question, text, writtenOn: localKey(now), createdAt: stamp, updatedAt: stamp };
  return next;
}

export function sortedEntries(answers, direction = 1) {
  return Object.values(answers)
    .filter((e) => e && typeof e.text === 'string' && e.text.trim())
    .sort((a, b) => (a.date < b.date ? -direction : a.date > b.date ? direction : 0));
}

// Answers to the same calendar date from earlier years, newest first.
export function earlierAnswers(answers, today) {
  const monthDay = today.slice(5);
  return sortedEntries(answers, -1).filter((e) => e.date.slice(5) === monthDay && e.date < today);
}

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019]/g, "'");

export function searchAnswers(answers, query, { limit = 50, radius = 60 } = {}) {
  const needle = fold(query.trim());
  if (!needle) return [];
  const results = [];
  for (const entry of sortedEntries(answers, -1)) {
    const hay = fold(entry.text);
    const at = hay.indexOf(needle);
    const inQuestion = fold(entry.question || '').includes(needle);
    if (at === -1 && !inQuestion) continue;
    let snippet;
    if (at === -1) {
      snippet = { before: entry.text.slice(0, radius * 2).trim(), match: '', after: entry.text.length > radius * 2 ? '…' : '' };
    } else {
      const start = Math.max(0, at - radius);
      const end = Math.min(entry.text.length, at + needle.length + radius);
      snippet = {
        before: (start > 0 ? '…' : '') + entry.text.slice(start, at),
        match: entry.text.slice(at, at + needle.length),
        after: entry.text.slice(at + needle.length, end) + (end < entry.text.length ? '…' : ''),
      };
    }
    results.push({ entry, snippet });
    if (results.length >= limit) break;
  }
  return results;
}
