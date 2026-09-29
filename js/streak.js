import { addDays } from './dates.js';

// A day counts when that day's question was answered on that same local date.
export function countsForStreak(entry) {
  return Boolean(entry) && typeof entry.text === 'string' && entry.text.trim() !== '' && entry.writtenOn === entry.date;
}

export function streakDays(answers) {
  return new Set(Object.values(answers).filter(countsForStreak).map((e) => e.date));
}

// Today still being blank doesn't break the streak until the day is over.
export function currentStreak(answers, today) {
  const days = streakDays(answers);
  let cursor = days.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (days.has(cursor)) {
    count++;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export function longestStreak(answers) {
  const days = [...streakDays(answers)].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of days) {
    run = prev && addDays(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return best;
}
