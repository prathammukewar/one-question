import { SITE_URL } from './config.js';
import { formatDate, formatShort, issueNumber, isValidKey, localKey } from './dates.js';
import { isLate, plural, sortedEntries } from './answers.js';
import { questionFor } from './questions.js';

const LONG = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };

export function inviteText({ question, issue, siteUrl = SITE_URL }) {
  return `One Question #${issue}: ${question}\nTake five minutes and answer it: ${siteUrl}`;
}

export function statLine({ issue, words, streak, siteUrl = SITE_URL }) {
  return `One Question #${issue}, ${plural(words, 'word')}, ${streak} day streak\n${siteUrl}`;
}

export function answerToMarkdown(entry, { siteUrl = SITE_URL } = {}) {
  const question = entry.question || questionFor(entry.date).text;
  return [
    `## ${question}`,
    '',
    entry.text.trim(),
    '',
    `*From [One Question a Day](${siteUrl}), #${issueNumber(entry.date)}, ${formatShort(entry.date)}.*`,
    '',
  ].join('\n');
}

export function answersToMarkdown(answers, { exportedOn = localKey() } = {}) {
  const entries = sortedEntries(answers);
  const out = ['# One Question a Day', '', `${plural(entries.length, 'answer')}, exported ${exportedOn}.`, ''];
  for (const entry of entries) {
    out.push(`## ${formatDate(entry.date, LONG)} (#${issueNumber(entry.date)})`, '');
    out.push(`> ${entry.question || questionFor(entry.date).text}`, '');
    out.push(entry.text.trim(), '');
    if (isLate(entry)) out.push(`*Written late, on ${entry.writtenOn}.*`, '');
  }
  return out.join('\n');
}

export function answersToJSON(answers, { exportedAt = new Date().toISOString() } = {}) {
  const payload = { app: 'one-question', version: 1, exportedAt, answers: sortedEntries(answers) };
  return JSON.stringify(payload, null, 2) + '\n';
}

// Accepts this site's export, a bare array of answers, or a date-keyed object.
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn’t valid JSON.");
  }
  let list;
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.answers)) list = data.answers;
  else if (data && typeof data === 'object') list = Object.values(data);
  else throw new Error("That file doesn’t contain any answers.");

  const entries = [];
  let skipped = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || !isValidKey(raw.date) || typeof raw.text !== 'string' || !raw.text.trim()) {
      skipped++;
      continue;
    }
    const fallback = new Date().toISOString();
    entries.push({
      date: raw.date,
      question: typeof raw.question === 'string' && raw.question ? raw.question : questionFor(raw.date).text,
      text: raw.text,
      writtenOn: isValidKey(raw.writtenOn) ? raw.writtenOn : raw.date,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : fallback,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : raw.createdAt || fallback,
    });
  }
  if (!entries.length && !skipped) throw new Error("That file doesn’t contain any answers.");
  return { entries, skipped };
}

// Keeps whichever copy of a day was edited most recently.
export function mergeAnswers(local, incoming) {
  const answers = { ...local };
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const entry of incoming) {
    const mine = answers[entry.date];
    if (!mine) {
      answers[entry.date] = entry;
      added++;
    } else if (mine.text === entry.text || (mine.updatedAt || '') >= (entry.updatedAt || '')) {
      unchanged++;
    } else {
      answers[entry.date] = entry;
      updated++;
    }
  }
  return { answers, added, updated, unchanged };
}

const escapeICS = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545 lines are at most 75 octets; longer ones continue after CRLF and a space.
function foldLine(line) {
  const encoder = new TextEncoder();
  const parts = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const bytes = encoder.encode(ch).length;
    const limit = parts.length ? 74 : 75;
    if (size + bytes > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

// A daily event at a floating local time, so it follows the calendar's own timezone.
export function buildICS({ time = '09:00', startDate = localKey(), now = new Date(), siteUrl = SITE_URL } = {}) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error(`Bad time: ${time}`);
  const hhmm = match[1].padStart(2, '0') + match[2];
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//One Question a Day//Daily reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:daily-reminder@one-question.prathammukewar.github.io',
    `DTSTAMP:${stamp}`,
    `DTSTART:${startDate.replace(/-/g, '')}T${hhmm}00`,
    'DURATION:PT10M',
    'RRULE:FREQ=DAILY',
    `SUMMARY:${escapeICS('One Question a Day')}`,
    `DESCRIPTION:${escapeICS(`Today's question is up. Give it five minutes: ${siteUrl}`)}`,
    `URL:${siteUrl}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeICS("Time for today's question")}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
