// Run with: node test/test.mjs
// Uses a US timezone so the daylight saving cases are real.
process.env.TZ = 'America/New_York';

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LAUNCH_DATE, SITE_URL } from '../js/config.js';
import {
  addDays, daysBetween, formatCountdown, isValidKey, issueNumber, localKey, monthGrid, msUntilTomorrow, questionIndex, shiftMonth,
} from '../js/dates.js';
import { QUESTIONS, QUESTIONS_BY_MONTH, THEMES, questionFor } from '../js/questions.js';
import { countsForStreak, currentStreak, longestStreak } from '../js/streak.js';
import { earlierAnswers, isLate, searchAnswers, upsertAnswer, wordCount } from '../js/answers.js';
import {
  answerToMarkdown, answersToJSON, answersToMarkdown, buildICS, inviteText, mergeAnswers, parseImport, statLine,
} from '../js/exporters.js';
import { clampLines, smartQuotes, wrapText } from '../js/layout.js';

const EM_DASH = String.fromCharCode(0x2014);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message.split('\n').join('\n       ')}`);
  }
}

// An on-time answer for `date`, or a late one written on `writtenOn`.
function entry(date, text = 'Something.', writtenOn = date) {
  return { date, question: questionFor(date).text, text, writtenOn, createdAt: `${writtenOn}T12:00:00.000Z`, updatedAt: `${writtenOn}T12:00:00.000Z` };
}
const book = (...entries) => Object.fromEntries(entries.map((e) => [e.date, e]));
const days = (...dates) => book(...dates.map((d) => entry(d)));

console.log('dates');

test('question index is fixed by month and day', () => {
  assert.equal(questionIndex('2027-01-01'), 0);
  assert.equal(questionIndex('2027-02-28'), 58);
  assert.equal(questionIndex('2028-02-28'), 58);
  assert.equal(questionIndex('2028-02-29'), 59);
  assert.equal(questionIndex('2027-03-01'), 60);
  assert.equal(questionIndex('2028-03-01'), 60);
  assert.equal(questionIndex('2027-12-31'), 365);
  assert.equal(questionIndex('2028-12-31'), 365);
  assert.equal(questionIndex('2026-10-01'), 274);
});

test('Feb 29 exists only in leap years', () => {
  assert.ok(isValidKey('2028-02-29'));
  assert.ok(isValidKey('2000-02-29'));
  assert.ok(!isValidKey('2027-02-29'));
  assert.ok(!isValidKey('1900-02-29'));
  assert.ok(!isValidKey('2027-13-01'));
  assert.ok(!isValidKey('2027-4-01'));
});

test('the same date asks the same question every year', () => {
  for (const md of ['01-01', '03-01', '07-04', '10-01', '12-31']) {
    const texts = ['2026', '2027', '2028', '2031'].map((y) => questionFor(`${y}-${md}`).text);
    assert.equal(new Set(texts).size, 1, md);
  }
  assert.equal(questionFor('2028-02-29').index, 59);
  assert.notEqual(questionFor('2028-02-28').text, questionFor('2028-02-29').text);
  assert.notEqual(questionFor('2028-02-29').text, questionFor('2028-03-01').text);
});

test('every index maps to exactly one date in a leap year', () => {
  const seen = new Set();
  for (let d = '2028-01-01'; d <= '2028-12-31'; d = addDays(d, 1)) seen.add(questionIndex(d));
  assert.equal(seen.size, 366);
  const plain = new Set();
  for (let d = '2027-01-01'; d <= '2027-12-31'; d = addDays(d, 1)) plain.add(questionIndex(d));
  assert.equal(plain.size, 365);
  assert.ok(!plain.has(59));
});

test('issue numbers count from the launch date', () => {
  assert.equal(LAUNCH_DATE, '2026-10-01');
  assert.equal(issueNumber('2026-10-01'), 1);
  assert.equal(issueNumber('2026-10-02'), 2);
  assert.equal(issueNumber('2026-11-10'), 41);
  assert.equal(issueNumber('2027-10-01'), 366);
  assert.equal(issueNumber('2028-10-01'), 732);
  assert.equal(issueNumber('2026-09-30'), 1);
  assert.equal(issueNumber('2026-01-01'), 1);
});

test('adding days crosses months, years and leap days', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(daysBetween('2026-10-01', '2027-10-01'), 365);
  assert.equal(daysBetween('2027-10-01', '2028-10-01'), 366);
});

test('daylight saving days are ordinary days', () => {
  assert.equal(addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(daysBetween('2026-03-01', '2026-03-15'), 14);
  assert.equal(localKey(new Date(2026, 2, 8, 0, 30)), '2026-03-08');
  assert.equal(localKey(new Date(2026, 2, 8, 23, 59)), '2026-03-08');
  assert.equal(localKey(new Date(2026, 10, 1, 1, 30)), '2026-11-01');
  assert.equal(localKey(new Date(2026, 10, 1, 23, 59)), '2026-11-01');
});

test('countdown to midnight follows the local clock', () => {
  const hour = 3600 * 1000;
  assert.equal(msUntilTomorrow(new Date(2026, 8, 29, 0, 0)), 24 * hour);
  assert.equal(msUntilTomorrow(new Date(2026, 2, 8, 0, 0)), 23 * hour);
  assert.equal(msUntilTomorrow(new Date(2026, 10, 1, 0, 0)), 25 * hour);
  assert.equal(msUntilTomorrow(new Date(2026, 8, 29, 23, 59, 30)), 30 * 1000);
  assert.equal(formatCountdown(5 * hour + 12 * 60000 + 33000), '5:12:33');
  assert.equal(formatCountdown(0), '0:00:00');
});

test('month grid starts on Sunday and pads with blanks', () => {
  const oct = monthGrid(2026, 10);
  assert.equal(oct[0].indexOf('2026-10-01'), 4);
  assert.ok(oct.every((w) => w.length === 7));
  assert.equal(oct.flat().filter(Boolean).length, 31);
  assert.equal(monthGrid(2028, 2).flat().filter(Boolean).length, 29);
  assert.deepEqual(shiftMonth(2026, 12, 1), { y: 2027, m: 1 });
  assert.deepEqual(shiftMonth(2027, 1, -1), { y: 2026, m: 12 });
});

console.log('streaks');

test('a streak runs across a month boundary', () => {
  const a = days('2026-09-29', '2026-09-30', '2026-10-01');
  assert.equal(currentStreak(a, '2026-10-01'), 3);
  assert.equal(currentStreak(a, '2026-10-02'), 3, 'today unanswered keeps the streak alive');
  assert.equal(currentStreak(a, '2026-10-03'), 0, 'a missed day ends it');
  assert.equal(longestStreak(a), 3);
});

test('a streak runs across a year boundary', () => {
  const a = days('2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02');
  assert.equal(currentStreak(a, '2027-01-02'), 4);
  assert.equal(longestStreak(a), 4);
});

test('a streak runs across Feb 29 and both DST changes', () => {
  assert.equal(currentStreak(days('2028-02-28', '2028-02-29', '2028-03-01'), '2028-03-01'), 3);
  assert.equal(currentStreak(days('2027-02-27', '2027-02-28', '2027-03-01'), '2027-03-01'), 3);
  assert.equal(currentStreak(days('2026-03-07', '2026-03-08', '2026-03-09'), '2026-03-09'), 3);
  assert.equal(currentStreak(days('2026-10-31', '2026-11-01', '2026-11-02'), '2026-11-02'), 3);
});

test('longest streak finds the best run among gaps', () => {
  const a = days('2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-20');
  assert.equal(longestStreak(a), 4);
  assert.equal(currentStreak(a, '2026-10-21'), 1);
  assert.equal(longestStreak({}), 0);
  assert.equal(currentStreak({}, '2026-10-01'), 0);
});

test('late answers never count', () => {
  const a = book(entry('2026-10-01'), entry('2026-10-02', 'Late one.', '2026-10-03'), entry('2026-10-03'));
  assert.ok(isLate(a['2026-10-02']));
  assert.ok(!countsForStreak(a['2026-10-02']));
  assert.equal(currentStreak(a, '2026-10-03'), 1);
  assert.equal(longestStreak(a), 1);
  assert.ok(!countsForStreak(entry('2026-10-04', '   ')));
});

test('writing records the local date and marks late answers', () => {
  let a = {};
  a = upsertAnswer(a, '2026-10-01', 'First draft', { now: new Date(2026, 9, 1, 23, 58) });
  assert.equal(a['2026-10-01'].writtenOn, '2026-10-01');
  assert.ok(!isLate(a['2026-10-01']));

  a = upsertAnswer(a, '2026-10-01', 'First draft, edited after midnight', { now: new Date(2026, 9, 2, 0, 10) });
  assert.equal(a['2026-10-01'].writtenOn, '2026-10-01', 'editing keeps the original date');
  assert.equal(a['2026-10-01'].text, 'First draft, edited after midnight');

  a = upsertAnswer(a, '2026-09-30', 'Catching up', { now: new Date(2026, 9, 2, 9, 0) });
  assert.ok(isLate(a['2026-09-30']));
  assert.equal(currentStreak(a, '2026-10-02'), 1);

  a = upsertAnswer(a, '2026-09-30', '  \n ', { now: new Date(2026, 9, 2, 9, 5) });
  assert.ok(!('2026-09-30' in a), 'emptying an answer removes it');
});

test('word count', () => {
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount('   '), 0);
  assert.equal(wordCount('one'), 1);
  assert.equal(wordCount(' two  words\n\nand three '), 4);
});

test('earlier answers to the same date come back, newest first', () => {
  const a = book(entry('2024-10-01', 'Oldest'), entry('2025-10-01', 'Last year'), entry('2025-10-02'), entry('2026-10-01', 'This year'));
  const found = earlierAnswers(a, '2026-10-01');
  assert.deepEqual(found.map((e) => e.date), ['2025-10-01', '2024-10-01']);
  assert.deepEqual(earlierAnswers(book(entry('2024-02-29', 'Leap')), '2028-02-29').map((e) => e.date), ['2024-02-29']);
  assert.equal(earlierAnswers(a, '2025-10-02').length, 0);
});

test('search ignores case and accents and marks the match', () => {
  const a = book(entry('2026-10-01', 'I think the Café on Main Street is overrated.'), entry('2026-10-02', 'Nothing here.'));
  const r = searchAnswers(a, 'cafe');
  assert.equal(r.length, 1);
  assert.equal(r[0].snippet.match, 'Café');
  assert.equal(searchAnswers(a, '').length, 0);
  assert.equal(searchAnswers(a, 'MAIN').length, 1);
});

console.log('question bank');

test('there are exactly 366 questions, one per date', () => {
  assert.equal(QUESTIONS.length, 366);
  assert.deepEqual(QUESTIONS_BY_MONTH.map((m) => m.length), [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
});

test('no question is empty or repeated', () => {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const q of QUESTIONS) assert.ok(q.text && q.text.trim().length > 10, `too short: ${q.text}`);
  const seen = new Map();
  for (const [i, q] of QUESTIONS.entries()) {
    const key = norm(q.text);
    assert.ok(!seen.has(key), `duplicate at ${seen.get(key)} and ${i}: ${q.text}`);
    seen.set(key, i);
  }
});

test('questions have no em dashes and read as open questions', () => {
  const yesNo = /^(do|does|did|is|are|was|were|have|has|had|can|could|would|will|should|shall|may|might|am)\b/i;
  for (const q of QUESTIONS) {
    assert.ok(!q.text.includes(EM_DASH), `em dash: ${q.text}`);
    assert.ok(!q.text.includes('--'), `double hyphen: ${q.text}`);
    assert.ok(/[?.]$/.test(q.text), `no ending: ${q.text}`);
    assert.ok(!yesNo.test(q.text), `yes/no question: ${q.text}`);
    assert.ok(q.text.length <= 160, `too long: ${q.text}`);
    assert.ok(THEMES[q.theme], `unknown theme ${q.theme}`);
  }
});

test('themes follow the weekday through the launch year', () => {
  const byWeekday = ['F', 'L', 'P', 'W', 'B', 'H', 'S'];
  for (let d = '2026-10-01'; d <= '2027-09-30'; d = addDays(d, 1)) {
    const [y, m, day] = d.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    assert.equal(questionFor(d).theme, byWeekday[weekday], d);
  }
  assert.equal(questionFor('2028-02-29').theme, 'X');
});

console.log('sharing and export');

test('invite and stat lines', () => {
  const invite = inviteText({ question: 'What do friends owe each other?', issue: 41 });
  assert.equal(invite, `One Question #41: What do friends owe each other?\nTake five minutes and answer it: ${SITE_URL}`);
  assert.equal(statLine({ issue: 41, words: 212, streak: 6 }), `One Question #41, 212 words, 6 day streak\n${SITE_URL}`);
  assert.equal(statLine({ issue: 1, words: 1, streak: 1 }).split('\n')[0], 'One Question #1, 1 word, 1 day streak');
});

test('single answer Markdown', () => {
  const md = answerToMarkdown(entry('2026-11-10', 'First paragraph.\n\nSecond paragraph.'));
  const lines = md.split('\n');
  assert.equal(lines[0], `## ${questionFor('2026-11-10').text}`);
  assert.ok(md.includes('First paragraph.\n\nSecond paragraph.'));
  assert.ok(md.includes(`[One Question a Day](${SITE_URL}), #41, November 10, 2026.`));
});

test('Markdown export shape', () => {
  const a = book(entry('2026-10-02', 'Second day.'), entry('2026-10-01', 'First day.\nWith a line break.'), entry('2026-09-15', 'Caught up.', '2026-10-03'));
  const md = answersToMarkdown(a, { exportedOn: '2026-10-05' });
  const lines = md.split('\n');
  assert.equal(lines[0], '# One Question a Day');
  assert.equal(lines[1], '');
  assert.equal(lines[2], '3 answers, exported 2026-10-05.');
  const headings = lines.filter((l) => l.startsWith('## '));
  assert.deepEqual(headings, [
    '## Tuesday, September 15, 2026 (#1)',
    '## Thursday, October 1, 2026 (#1)',
    '## Friday, October 2, 2026 (#2)',
  ]);
  const quotes = lines.filter((l) => l.startsWith('> '));
  assert.equal(quotes.length, 3);
  assert.equal(quotes[1], `> ${questionFor('2026-10-01').text}`);
  assert.ok(md.includes('First day.\nWith a line break.'));
  assert.ok(md.includes('*Written late, on 2026-10-03.*'));
  assert.equal(md.match(/Written late/g).length, 1);
  assert.equal(answersToMarkdown({}, { exportedOn: '2026-10-05' }).split('\n')[2], '0 answers, exported 2026-10-05.');
});

test('JSON export round-trips through import', () => {
  const a = book(entry('2026-10-01', 'One'), entry('2026-10-02', 'Two', '2026-10-04'));
  const json = answersToJSON(a, { exportedAt: '2026-10-05T00:00:00.000Z' });
  const data = JSON.parse(json);
  assert.equal(data.app, 'one-question');
  assert.equal(data.version, 1);
  assert.equal(data.answers.length, 2);
  const { entries, skipped } = parseImport(json);
  assert.equal(skipped, 0);
  assert.deepEqual(book(...entries), a);
});

test('import skips junk and merges by most recent edit', () => {
  const { entries, skipped } = parseImport(JSON.stringify({ answers: [
    { date: '2026-10-01', text: 'Newer text', updatedAt: '2026-10-09T00:00:00.000Z' },
    { date: '2026-10-02', text: 'Brand new' },
    { date: '2027-02-29', text: 'Not a real day' },
    { date: '2026-10-03', text: '   ' },
    'nonsense',
  ] }));
  assert.equal(entries.length, 2);
  assert.equal(skipped, 3);
  assert.equal(entries[1].writtenOn, '2026-10-02');
  assert.equal(entries[1].question, questionFor('2026-10-02').text);

  const local = book(entry('2026-10-01', 'Older text'));
  const merged = mergeAnswers(local, entries);
  assert.equal(merged.added, 1);
  assert.equal(merged.updated, 1);
  assert.equal(merged.answers['2026-10-01'].text, 'Newer text');

  const again = mergeAnswers(merged.answers, entries);
  assert.equal(again.added, 0);
  assert.equal(again.unchanged, 2);

  assert.throws(() => parseImport('not json'), /valid JSON/);
  assert.throws(() => parseImport('42'), /any answers/);
});

test('.ics reminder is valid', () => {
  const ics = buildICS({ time: '07:30', startDate: '2026-10-01', now: new Date(Date.UTC(2026, 8, 29, 18, 4, 5)) });
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'every line ends with CRLF');
  const lines = ics.split('\r\n').slice(0, -1);
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines[lines.length - 1], 'END:VCALENDAR');
  assert.ok(lines.includes('VERSION:2.0'));
  assert.ok(lines.some((l) => l.startsWith('PRODID:')));
  assert.ok(lines.includes('RRULE:FREQ=DAILY'));
  assert.ok(lines.includes('DTSTART:20261001T073000'));
  assert.ok(lines.includes('DTSTAMP:20260929T180405Z'));
  assert.ok(lines.some((l) => l.startsWith('UID:')));
  for (const block of ['VCALENDAR', 'VEVENT', 'VALARM']) {
    assert.equal(lines.filter((l) => l === `BEGIN:${block}`).length, 1);
    assert.equal(lines.filter((l) => l === `END:${block}`).length, 1);
  }
  const enc = new TextEncoder();
  for (const l of lines) assert.ok(enc.encode(l).length <= 75, `line too long: ${l}`);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes(`DESCRIPTION:Today's question is up. Give it five minutes: ${SITE_URL}`));
  assert.ok(unfolded.includes(`URL:${SITE_URL}`));
  assert.throws(() => buildICS({ time: '25:00' }));
  assert.ok(buildICS({ time: '9:05', startDate: '2026-10-01' }).includes('DTSTART:20261001T090500'));
});

console.log('card layout');

test('wrapping respects width, paragraphs and long words', () => {
  const measure = (s) => s.length * 10;
  const lines = wrapText('one two three four five\n\nsix', 100, measure);
  assert.deepEqual(lines, ['one two', 'three four', 'five', '', 'six']);
  assert.ok(wrapText('abcdefghijklmnopqrstuvwxyz', 100, measure).every((l) => measure(l) <= 100));
  const clamped = clampLines(['aaa bbb', 'ccc ddd', 'eee fff'], 2, 70, measure);
  assert.equal(clamped.length, 2);
  assert.ok(clamped[1].endsWith('…'));
  assert.ok(measure(clamped[1]) <= 70);
});

test('smart quotes for card text', () => {
  const R = String.fromCharCode(0x2019);
  const L = String.fromCharCode(0x2018);
  const LD = String.fromCharCode(0x201c);
  const RD = String.fromCharCode(0x201d);
  assert.equal(smartQuotes("it's fine"), `it${R}s fine`);
  assert.equal(smartQuotes('she said "no" twice'), `she said ${LD}no${RD} twice`);
  assert.equal(smartQuotes("the 'quoted' bit"), `the ${L}quoted${R} bit`);
  assert.equal(smartQuotes("students' notes"), `students${R} notes`);
});

console.log('files');

test('no em dashes anywhere in the site', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === '.git' || name === 'node_modules') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(html|css|js|mjs|md|json|webmanifest|svg|txt)$/.test(name) || name === 'LICENSE') {
        if (readFileSync(path, 'utf8').includes(EM_DASH)) hits.push(path);
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
