import { AUTHOR_NAME, AUTHOR_URL, GOATCOUNTER, LAUNCH_DATE, REPO_URL, SITE_URL } from './config.js';
import {
  addDays, formatCountdown, formatDate, formatShort, isValidKey, issueNumber, localKey,
  makeKey, monthGrid, monthLabel, msUntilTomorrow, pad, parseKey, shiftMonth, daysInMonth,
} from './dates.js';
import { questionFor } from './questions.js';
import { currentStreak, longestStreak } from './streak.js';
import { earlierAnswers, isLate, plural, searchAnswers, sortedEntries, upsertAnswer, wordCount } from './answers.js';
import { answerToMarkdown, answersToJSON, answersToMarkdown, buildICS, inviteText, mergeAnswers, parseImport, statLine } from './exporters.js';
import { canvasBlob, drawCard, loadCardFonts } from './card.js';
import * as store from './store.js';

const $ = (selector) => document.querySelector(selector);
const TIMER_MS = 5 * 60 * 1000;
const LONG = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
const SITE_LABEL = SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
const TITLES = { today: 'One Question a Day', archive: 'Archive · One Question a Day', about: 'About · One Question a Day' };

const state = {
  today: localKey(),
  writingDate: null,
  view: null,
  month: null,
  selected: null,
  calFocus: null,
  editing: false,
  revealReader: false,
  prefs: store.loadPrefs(),
};

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

function paragraphs(text) {
  return text.trim().split(/\n\s*\n/).map((p) => h('p', { text: p }));
}

function announce(message) {
  const el = $('#announcer');
  el.textContent = '';
  setTimeout(() => { el.textContent = message; }, 40);
}

function flash(el, message) {
  el.textContent = '';
  clearTimeout(el.flashTimer);
  setTimeout(() => { el.textContent = message; }, 40);
  el.flashTimer = setTimeout(() => { if (el.textContent === message) el.textContent = ''; }, 8000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function autosize(ta) {
  if (!ta.isConnected) return;
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 32;
  const scrollY = window.scrollY;
  ta.style.height = 'auto';
  const lines = Math.ceil((ta.scrollHeight - 2) / lh);
  ta.style.height = `${Math.max(lines + 1, 7) * lh}px`;
  window.scrollTo(window.scrollX, scrollY);
}

// Autosave. The date is captured when typing starts, so switching days can't
// send text to the wrong date.
const flushers = new Set();
function createWriter({ textarea, getDate, countEl, statusEl, onInput, onSaved }) {
  let timer = null;
  let pendingDate = null;

  function save() {
    const date = pendingDate;
    timer = null;
    pendingDate = null;
    if (!date) return;
    try {
      const next = upsertAnswer(store.loadAnswers(), date, textarea.value, { question: questionFor(date).text });
      store.saveAnswers(next);
      statusEl.textContent = 'Saved';
      if (onSaved) onSaved(next, date);
    } catch {
      statusEl.textContent = "Couldn’t save. This browser may be blocking storage or be out of space.";
    }
  }

  function flush() {
    if (timer === null) return;
    clearTimeout(timer);
    save();
  }

  textarea.addEventListener('input', () => {
    autosize(textarea);
    countEl.textContent = plural(wordCount(textarea.value), 'word');
    if (!pendingDate) pendingDate = getDate();
    clearTimeout(timer);
    timer = setTimeout(save, 350);
    if (onInput) onInput();
  });
  textarea.addEventListener('blur', flush);
  flushers.add(flush);
  return { flush };
}

const flushAll = () => flushers.forEach((flush) => flush());
window.addEventListener('pagehide', flushAll);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushAll();
  else tick();
});

/* Today */

const answerEl = $('#answer');
const saveStatus = $('#save-status');
const shareStatus = $('#share-status');

const todayWriter = createWriter({
  textarea: answerEl,
  getDate: () => state.writingDate,
  countEl: $('#word-count'),
  statusEl: saveStatus,
  onInput: startTimer,
  onSaved(answers, date) {
    if (date !== state.writingDate) return;
    if (!answers[date]) hideDone();
    else if (!$('#done').hidden) updateStats(answers);
    if ($('#card-maker').open && cardState.content === 'answer') renderCard();
  },
});

function renderToday() {
  state.writingDate = state.today;
  const key = state.today;
  const q = questionFor(key);
  $('#issue').textContent = `#${issueNumber(key)}`;
  $('#today-date').textContent = formatDate(key, LONG);
  $('#today-theme').textContent = q.themeName;
  $('#question').textContent = q.text;
  $('#new-day').hidden = true;
  $('#intro').hidden = Boolean(state.prefs.introDismissed);

  const entry = store.loadAnswers()[key];
  answerEl.value = entry ? entry.text : '';
  autosize(answerEl);
  $('#word-count').textContent = plural(wordCount(answerEl.value), 'word');
  saveStatus.textContent = entry ? 'Saved' : 'Saves as you type';
  $('#timer-on').checked = Boolean(state.prefs.timer);
  updateTimer();
  if (entry) showDone(); else hideDone();
}

function hideDone() {
  $('#done').hidden = true;
  $('#writer-actions').hidden = false;
}

function showDone({ focus = false } = {}) {
  const answers = store.loadAnswers();
  if (!answers[state.writingDate]) return hideDone();
  $('#done').hidden = false;
  $('#writer-actions').hidden = true;
  updateStats(answers);
  renderYearAgo(answers, state.writingDate);
  if (focus) $('#done-title').focus();
}

function updateStats(answers) {
  const current = currentStreak(answers, state.today);
  const longest = longestStreak(answers);
  const words = wordCount(answers[state.writingDate]?.text || '');
  const set = (id, n, unit) => {
    $(`#${id}`).textContent = String(n);
    $(`#${id}-unit`).textContent = n === 1 ? unit : `${unit}s`;
  };
  set('stat-current', current, 'day');
  set('stat-longest', longest, 'day');
  set('stat-words', words, 'word');
  $('#stat-preview').textContent = statLine({ issue: issueNumber(state.writingDate), words, streak: current }).split('\n')[0];
}

function renderYearAgo(answers, key) {
  const box = $('#year-ago');
  const list = earlierAnswers(answers, key);
  if (!list.length) {
    box.hidden = true;
    return;
  }
  const [latest, ...older] = list;
  const years = Number(key.slice(0, 4)) - Number(latest.date.slice(0, 4));
  $('#year-ago-title').textContent = years === 1 ? 'A year ago' : `${years} years ago`;
  $('#year-ago-meta').textContent = `You wrote this on ${formatShort(latest.date)}${isLate(latest) ? ', a little late' : ''}.`;
  $('#year-ago-text').replaceChildren(...paragraphs(latest.text));
  const more = $('#year-ago-more');
  if (older.length) {
    const links = older.map((e) => h('a', { href: `#archive/${e.date}`, text: e.date.slice(0, 4) }));
    const joined = links.flatMap((link, i) => (i === 0 ? [link] : [i === links.length - 1 ? ' and ' : ', ', link]));
    more.replaceChildren('You also answered it in ', ...joined, '.');
  } else {
    more.replaceChildren();
  }
  box.hidden = false;
}

$('#done-btn').addEventListener('click', () => {
  todayWriter.flush();
  if (!answerEl.value.trim()) {
    saveStatus.textContent = 'Write something first, even one sentence.';
    answerEl.focus();
    return;
  }
  if (!store.loadAnswers()[state.writingDate]) {
    saveStatus.textContent = "Couldn’t save. This browser may be blocking storage or be out of space.";
    return;
  }
  showDone({ focus: true });
});

$('#intro-dismiss').addEventListener('click', () => {
  state.prefs.introDismissed = true;
  store.savePrefs({ introDismissed: true });
  $('#intro').hidden = true;
  $('#question').focus();
});

$('#new-day-go').addEventListener('click', () => {
  todayWriter.flush();
  renderToday();
  $('#question').focus();
});

/* Timer */

function timerRecord() {
  const t = store.loadTimer();
  return t && t.date === state.writingDate ? t : null;
}

function startTimer() {
  if (!state.prefs.timer || timerRecord()) return;
  store.saveTimer({ date: state.writingDate, startedAt: Date.now() });
  updateTimer();
}

function updateTimer() {
  const display = $('#timer-display');
  if (!state.prefs.timer) {
    display.hidden = true;
    return;
  }
  display.hidden = false;
  const t = timerRecord();
  if (!t) {
    display.textContent = 'Starts when you type';
    display.classList.remove('is-up');
    return;
  }
  const left = TIMER_MS - (Date.now() - t.startedAt);
  if (left > 0) {
    const secs = Math.ceil(left / 1000);
    display.textContent = `${Math.floor(secs / 60)}:${pad(secs % 60)} left`;
    display.classList.remove('is-up');
    return;
  }
  display.textContent = "Time’s up. Keep going if you like.";
  display.classList.add('is-up');
  if (!t.announced) {
    store.saveTimer({ ...t, announced: true });
    if (state.view === 'today') announce('Five minutes are up. Keep writing if you like.');
  }
}

$('#timer-on').addEventListener('change', (e) => {
  state.prefs.timer = e.target.checked;
  store.savePrefs({ timer: e.target.checked });
  updateTimer();
});

/* Sharing */

function todayEntry() {
  return store.loadAnswers()[state.writingDate];
}

$('#copy-invite').addEventListener('click', async () => {
  const q = questionFor(state.writingDate);
  const ok = await copyText(inviteText({ question: q.text, issue: issueNumber(state.writingDate) }));
  flash(shareStatus, ok ? 'Copied the invite. Paste it anywhere.' : "Couldn’t reach the clipboard. Your browser may have blocked it.");
});

$('#copy-stats').addEventListener('click', async () => {
  const answers = store.loadAnswers();
  const text = statLine({
    issue: issueNumber(state.writingDate),
    words: wordCount(answers[state.writingDate]?.text || ''),
    streak: currentStreak(answers, state.today),
  });
  const ok = await copyText(text);
  flash(shareStatus, ok ? 'Copied your stat line. It has no answer text in it.' : "Couldn’t reach the clipboard. Your browser may have blocked it.");
});

$('#copy-md').addEventListener('click', async () => {
  todayWriter.flush();
  const entry = todayEntry();
  if (!entry) return;
  const ok = await copyText(answerToMarkdown(entry));
  flash(shareStatus, ok ? 'Copied the question and your answer as Markdown.' : "Couldn’t reach the clipboard. Your browser may have blocked it.");
});

const cardState = { size: 'portrait', content: 'question', palette: null, fontsLoaded: false };
const canvas = $('#card-canvas');

function excerptSeed() {
  const text = answerEl.value;
  const picked = text.slice(answerEl.selectionStart, answerEl.selectionEnd).trim();
  if (picked) return picked;
  const words = text.trim().split(/\s+/);
  if (words.length <= 45) return text.trim();
  const cut = words.slice(0, 45).join(' ');
  const stop = cut.search(/[.!?][^.!?]*$/);
  return stop > 80 ? cut.slice(0, stop + 1) : `${cut}…`;
}

function renderCard() {
  const key = state.writingDate;
  const text = cardState.content === 'answer' ? answerEl.value : cardState.content === 'excerpt' ? $('#excerpt').value : '';
  const { truncated } = drawCard(canvas, {
    size: cardState.size,
    palette: cardState.palette,
    question: questionFor(key).text,
    answer: text,
    excerpt: cardState.content === 'excerpt',
    issue: issueNumber(key),
    dateLabel: formatShort(key),
    siteLabel: SITE_LABEL,
  });
  canvas.classList.toggle('is-wide', cardState.size === 'wide');
  const withText = text.trim() ? (cardState.content === 'excerpt' ? ' and your excerpt' : ' and your answer') : '';
  canvas.setAttribute('aria-label', `Preview of the image: the question${withText}, on ${cardState.palette === 'ink' ? 'a dark' : 'a light'} background.`);
  const hint = $('#card-hint');
  hint.hidden = !truncated;
  hint.textContent = cardState.content === 'answer'
    ? "Your answer is too long to fit, so it’s cut off. An excerpt usually looks better."
    : 'The excerpt is cut off. Try a shorter one.';
}

$('#card-maker').addEventListener('toggle', async () => {
  if (!$('#card-maker').open) return;
  todayWriter.flush();
  if (!cardState.palette) {
    cardState.palette = effectiveTheme() === 'dark' ? 'ink' : 'paper';
    $(`input[name="card-palette"][value="${cardState.palette}"]`).checked = true;
  }
  renderCard();
  if (!cardState.fontsLoaded) {
    await loadCardFonts();
    cardState.fontsLoaded = true;
    renderCard();
  }
});

$('#card-maker').addEventListener('change', (e) => {
  const { name, value } = e.target;
  if (name === 'card-size') cardState.size = value;
  else if (name === 'card-palette') cardState.palette = value;
  else if (name === 'card-content') {
    cardState.content = value;
    $('#excerpt-field').hidden = value !== 'excerpt';
    if (value === 'excerpt' && !$('#excerpt').value.trim()) $('#excerpt').value = excerptSeed();
  } else return;
  renderCard();
});

let excerptTimer = null;
$('#excerpt').addEventListener('input', () => {
  clearTimeout(excerptTimer);
  excerptTimer = setTimeout(renderCard, 150);
});

const imageName = () => `one-question-${state.writingDate}-${cardState.size}.png`;

if (!(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write)) $('#card-copy').hidden = true;

$('#card-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasBlob(canvas) })]);
    flash(shareStatus, 'Copied the image.');
  } catch {
    flash(shareStatus, "This browser wouldn’t copy the image. Download it instead.");
  }
});

$('#card-download').addEventListener('click', async () => {
  try {
    download(imageName(), await canvasBlob(canvas));
    flash(shareStatus, 'Downloaded the image.');
  } catch {
    flash(shareStatus, "Couldn’t make the image.");
  }
});

try {
  const probe = new File([new Blob()], 'probe.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [probe] })) $('#card-share').hidden = false;
} catch {
  // No file sharing here.
}

$('#card-share').addEventListener('click', async () => {
  try {
    const blob = await canvasBlob(canvas);
    await navigator.share({ files: [new File([blob], imageName(), { type: 'image/png' })] });
  } catch (err) {
    if (err && err.name !== 'AbortError') flash(shareStatus, "Sharing didn’t work here. Download the image instead.");
  }
});

/* Archive */

const calBody = $('#cal-body');
const readerEl = $('#reader');
const archiveAnswer = h('textarea', { id: 'archive-answer', class: 'answer', rows: '7', spellcheck: 'true', placeholder: 'Start anywhere.' });
const archiveCount = h('span', { text: '0 words' });
const archiveStatus = h('span', { role: 'status', 'aria-live': 'polite' });

const archiveWriter = createWriter({
  textarea: archiveAnswer,
  getDate: () => state.selected,
  countEl: archiveCount,
  statusEl: archiveStatus,
  onSaved(answers) {
    renderCalendar(answers);
    renderSummary(answers);
  },
});

function earliestMonth(answers) {
  const first = sortedEntries(answers)[0];
  const keys = [LAUNCH_DATE, state.today, first && first.date].filter(Boolean).sort();
  const p = parseKey(keys[0]);
  return { y: p.y, m: p.m };
}

const monthIndex = ({ y, m }) => y * 12 + m;

function latestAnswered(answers) {
  const past = sortedEntries(answers, -1).filter((e) => e.date <= state.today);
  return past.length ? past[0].date : null;
}

function renderSummary(answers) {
  const count = sortedEntries(answers).length;
  $('#archive-summary').textContent = count
    ? `${plural(count, 'answer')} so far. Your longest streak is ${plural(longestStreak(answers), 'day')}.`
    : 'Nothing here yet. Your answers will show up on this calendar, and you can answer past questions from here too.';
}

function renderArchive() {
  const answers = store.loadAnswers();
  if (!state.selected) state.selected = latestAnswered(answers);
  if (!state.month) {
    const p = parseKey(state.selected || state.today);
    state.month = { y: p.y, m: p.m };
  }
  renderSummary(answers);
  renderCalendar(answers);
  renderReader(answers);
  if ($('#search').value.trim()) runSearch();
}

function renderCalendar(answers = store.loadAnswers()) {
  const { y, m } = state.month;
  const hadFocus = calBody.contains(document.activeElement);
  $('#cal-title').textContent = monthLabel(y, m);
  const inMonth = (key) => key && key.startsWith(makeKey(y, m, 1).slice(0, 8));
  const candidates = [state.calFocus, state.selected, state.today].filter((k) => inMonth(k) && k <= state.today);
  const firstEnabled = makeKey(y, m, 1) <= state.today ? makeKey(y, m, 1) : null;
  const focusKey = candidates[0] || firstEnabled;

  const rows = monthGrid(y, m).map((week) => h('tr', {}, week.map((key) => {
    if (!key) return h('td');
    const entry = answers[key];
    const future = key > state.today;
    const late = entry && isLate(entry);
    const status = entry ? (late ? ', answered late' : ', answered') : future ? '' : ', no answer';
    const classes = ['day', entry && (late ? 'is-late' : 'is-done'), key === state.today && 'is-today', key === state.selected && 'is-selected'];
    return h('td', {}, h('button', {
      type: 'button',
      class: classes.filter(Boolean).join(' '),
      'data-date': key,
      disabled: future,
      tabindex: key === focusKey ? '0' : '-1',
      'aria-label': `${formatDate(key, LONG)}${key === state.today ? ', today' : ''}${status}`,
      'aria-current': key === state.today ? 'date' : null,
      text: String(Number(key.slice(8))),
    }));
  })));
  calBody.replaceChildren(...rows);

  const min = earliestMonth(answers);
  const todayP = parseKey(state.today);
  $('#cal-prev').disabled = monthIndex(state.month) <= monthIndex(min);
  $('#cal-next').disabled = monthIndex(state.month) >= monthIndex({ y: todayP.y, m: todayP.m });
  if (hadFocus && focusKey) calBody.querySelector(`[data-date="${focusKey}"]`)?.focus();
}

function changeMonth(delta) {
  state.month = shiftMonth(state.month.y, state.month.m, delta);
  state.calFocus = null;
  renderCalendar();
  const prev = $('#cal-prev');
  const next = $('#cal-next');
  if (document.activeElement === prev && prev.disabled) next.focus();
  if (document.activeElement === next && next.disabled) prev.focus();
  if (document.activeElement === document.body) (prev.disabled ? next : prev).focus();
}

$('#cal-prev').addEventListener('click', () => changeMonth(-1));
$('#cal-next').addEventListener('click', () => changeMonth(1));

calBody.addEventListener('click', (e) => {
  const button = e.target.closest('button.day');
  if (!button || button.disabled) return;
  const key = button.dataset.date;
  state.calFocus = key;
  state.revealReader = e.detail > 0;
  if (location.hash !== `#archive/${key}`) location.hash = `#archive/${key}`;
});

function focusDay(key, answers) {
  const min = earliestMonth(answers);
  const floor = makeKey(min.y, min.m, 1);
  const target = key > state.today ? state.today : key < floor ? floor : key;
  const p = parseKey(target);
  state.calFocus = target;
  if (p.y !== state.month.y || p.m !== state.month.m) {
    state.month = { y: p.y, m: p.m };
    renderCalendar(answers);
  }
  calBody.querySelectorAll('button.day').forEach((b) => { b.tabIndex = b.dataset.date === target ? 0 : -1; });
  calBody.querySelector(`[data-date="${target}"]`)?.focus();
}

calBody.addEventListener('keydown', (e) => {
  const button = e.target.closest('button.day');
  if (!button) return;
  const key = button.dataset.date;
  const p = parseKey(key);
  const weekday = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  const sameDay = (delta) => {
    const s = shiftMonth(p.y, p.m, delta);
    return makeKey(s.y, s.m, Math.min(p.d, daysInMonth(s.y, s.m)));
  };
  const moves = {
    ArrowLeft: () => addDays(key, -1),
    ArrowRight: () => addDays(key, 1),
    ArrowUp: () => addDays(key, -7),
    ArrowDown: () => addDays(key, 7),
    Home: () => addDays(key, -weekday),
    End: () => addDays(key, 6 - weekday),
    PageUp: () => sameDay(-1),
    PageDown: () => sameDay(1),
  };
  if (!moves[e.key]) return;
  e.preventDefault();
  focusDay(moves[e.key](), store.loadAnswers());
});

function renderReader(answers = store.loadAnswers()) {
  const key = state.selected;
  if (!key) {
    readerEl.replaceChildren(h('p', { class: 'reader-empty', text: 'Pick a day on the calendar to read what you wrote, or to answer a question you missed.' }));
    return;
  }
  const q = questionFor(key);
  const entry = answers[key];
  const dateline = `${formatDate(key, LONG)}${key >= LAUNCH_DATE ? ` · #${issueNumber(key)}` : ''}`;
  const parts = [
    h('p', { class: 'dateline-small', text: dateline }),
    h('p', { class: 'kicker', text: q.themeName }),
    h('h2', { class: 'reader-question', id: 'reader-question', tabindex: '-1', text: q.text }),
  ];

  if (key === state.today) {
    parts.push(h('p', { class: 'reader-status', text: "This is today’s question." }));
    if (entry) parts.push(h('div', { class: 'reader-text' }, paragraphs(entry.text)));
    parts.push(h('div', { class: 'reader-actions' }, h('a', { class: 'btn btn-primary', href: './', 'data-nav': 'today', text: entry ? 'Keep writing' : 'Write your answer' })));
  } else if (state.editing) {
    const note = !entry
      ? "This day has passed, so your answer will be marked late. It’s kept like any other answer but won’t count toward your streak."
      : isLate(entry) ? 'Marked late.' : 'Written on the day. Editing it now keeps it that way.';
    archiveAnswer.value = entry ? entry.text : '';
    archiveCount.textContent = plural(wordCount(archiveAnswer.value), 'word');
    archiveStatus.textContent = entry ? 'Saved' : 'Saves as you type';
    parts.push(
      h('p', { class: 'reader-status', text: note }),
      h('div', { class: 'writer' }, h('label', { for: 'archive-answer', class: 'visually-hidden', text: 'Your answer' }), archiveAnswer),
      h('div', { class: 'writer-meta' }, h('p', { class: 'writer-counts' }, archiveCount, h('span', { class: 'sep', 'aria-hidden': 'true', text: '·' }), archiveStatus)),
      h('div', { class: 'reader-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: stopEditing, text: 'Done' })),
    );
  } else if (entry) {
    const status = isLate(entry)
      ? h('p', { class: 'reader-status' }, h('span', { class: 'late-tag', text: 'Late' }), `Written on ${formatShort(entry.writtenOn)}.`)
      : h('p', { class: 'reader-status', text: `Written on the day. ${plural(wordCount(entry.text), 'word')}.` });
    parts.push(
      status,
      h('div', { class: 'reader-text' }, paragraphs(entry.text)),
      h('div', { class: 'reader-actions' },
        h('button', { type: 'button', class: 'btn', onclick: startEditing, text: 'Edit' }),
        h('button', { type: 'button', class: 'btn', onclick: () => copyEntryMarkdown(key), text: 'Copy as Markdown' }),
        h('button', { type: 'button', class: 'btn btn-quiet btn-danger', onclick: () => deleteEntry(key), text: 'Delete' })),
      h('p', { class: 'status-line', id: 'reader-status', role: 'status', 'aria-live': 'polite' }),
    );
  } else {
    parts.push(
      h('p', { class: 'reader-status reader-empty', text: "You didn’t answer this one. You still can, and it’ll be marked late." }),
      h('div', { class: 'reader-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: startEditing, text: 'Answer it now' })),
    );
  }
  readerEl.replaceChildren(...parts);
  if (state.editing) autosize(archiveAnswer);
}

function startEditing() {
  state.editing = true;
  renderReader();
  archiveAnswer.focus();
  archiveAnswer.setSelectionRange(archiveAnswer.value.length, archiveAnswer.value.length);
}

function stopEditing() {
  archiveWriter.flush();
  state.editing = false;
  const answers = store.loadAnswers();
  renderCalendar(answers);
  renderSummary(answers);
  renderReader(answers);
  $('#reader-question')?.focus();
}

async function copyEntryMarkdown(key) {
  const entry = store.loadAnswers()[key];
  if (!entry) return;
  const ok = await copyText(answerToMarkdown(entry));
  const status = $('#reader-status');
  if (status) flash(status, ok ? 'Copied as Markdown.' : "Couldn’t reach the clipboard.");
}

function deleteEntry(key) {
  if (!window.confirm(`Delete your answer for ${formatShort(key)}? This can’t be undone.`)) return;
  try {
    store.saveAnswers(upsertAnswer(store.loadAnswers(), key, ''));
  } catch {
    return;
  }
  const answers = store.loadAnswers();
  renderSummary(answers);
  renderCalendar(answers);
  renderReader(answers);
  announce(`Deleted the answer for ${formatShort(key)}.`);
  $('#reader-question')?.focus();
}

function runSearch() {
  const query = $('#search').value;
  const list = $('#search-results');
  const status = $('#search-status');
  if (!query.trim()) {
    list.replaceChildren();
    status.textContent = '';
    return;
  }
  const results = searchAnswers(store.loadAnswers(), query);
  list.replaceChildren(...results.map(({ entry, snippet }) => h('li', {},
    h('a', { href: `#archive/${entry.date}` },
      h('span', { class: 'result-date', text: formatShort(entry.date) }),
      h('span', { class: 'result-q', text: entry.question || questionFor(entry.date).text }),
      h('span', { class: 'result-snippet' }, snippet.before, snippet.match ? h('mark', { text: snippet.match }) : null, snippet.after)))));
  status.textContent = results.length
    ? `${plural(results.length, 'answer')} ${results.length === 1 ? 'matches' : 'match'}.`
    : 'Nothing matches that.';
}

let searchTimer = null;
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 120);
});

/* About */

function formatTime(value) {
  const [hh, mm] = value.split(':').map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hh, mm));
}

function renderAbout() {
  $('#reminder-time').value = state.prefs.reminderTime || '09:00';
  $('#analytics-note').hidden = !GOATCOUNTER;
}

const dataStatus = $('#data-status');

$('#export-md').addEventListener('click', () => {
  flushAll();
  const answers = store.loadAnswers();
  const count = sortedEntries(answers).length;
  if (!count) return flash(dataStatus, 'There are no answers to export yet.');
  download(`one-question-answers-${state.today}.md`, answersToMarkdown(answers, { exportedOn: state.today }), 'text/markdown');
  flash(dataStatus, `Downloaded ${plural(count, 'answer')} as Markdown.`);
});

$('#export-json').addEventListener('click', () => {
  flushAll();
  const answers = store.loadAnswers();
  const count = sortedEntries(answers).length;
  if (!count) return flash(dataStatus, 'There are no answers to export yet.');
  download(`one-question-answers-${state.today}.json`, answersToJSON(answers), 'application/json');
  flash(dataStatus, `Downloaded ${plural(count, 'answer')} as JSON.`);
});

$('#import-json').addEventListener('click', () => $('#import-file').click());

$('#import-file').addEventListener('change', async (e) => {
  const input = e.target;
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const { entries, skipped } = parseImport(await file.text());
    const { answers, added, updated, unchanged } = mergeAnswers(store.loadAnswers(), entries);
    store.saveAnswers(answers);
    const bits = [`${added} new`];
    if (updated) bits.push(`${updated} replaced an older copy`);
    if (unchanged) bits.push(`${unchanged} already here`);
    let message = `Imported ${plural(entries.length, 'answer')}: ${bits.join(', ')}.`;
    if (skipped) message += ` Skipped ${skipped === 1 ? '1 entry' : `${skipped} entries`} that couldn’t be read.`;
    flash(dataStatus, message);
  } catch (err) {
    flash(dataStatus, err instanceof Error && err.message ? err.message : "Couldn’t read that file.");
  } finally {
    input.value = '';
  }
});

$('#reminder-download').addEventListener('click', () => {
  const time = $('#reminder-time').value || '09:00';
  state.prefs.reminderTime = time;
  store.savePrefs({ reminderTime: time });
  download('one-question-reminder.ics', buildICS({ time, startDate: state.today }), 'text/calendar');
  flash($('#reminder-status'), `Downloaded a daily reminder for ${formatTime(time)}. Open the file to add it to your calendar.`);
});

/* Theme */

const themeButton = $('#theme-toggle');
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function effectiveTheme() {
  return document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light');
}

function syncTheme() {
  const dark = effectiveTheme() === 'dark';
  themeButton.querySelector('.theme-toggle-text').textContent = dark ? 'Light' : 'Dark';
  themeButton.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  if (document.documentElement.dataset.theme) {
    const color = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute('content', color);
      meta.removeAttribute('media');
    });
  }
}

themeButton.addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.saveTheme(next);
  syncTheme();
});
darkQuery.addEventListener('change', syncTheme);

/* Routing */

function parseRoute() {
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [view, date] = hash.split('/');
  if (view === 'archive') return { view: 'archive', date: isValidKey(date) ? date : null };
  if (view === 'about') return { view: 'about' };
  if (view === 'privacy') return { view: 'about', anchor: 'privacy' };
  return { view: 'today' };
}

let lastRoute = null;
function route({ initial = false } = {}) {
  const r = parseRoute();
  const signature = `${r.view}/${r.date || r.anchor || ''}`;
  if (signature === lastRoute && !initial) return;
  lastRoute = signature;
  flushAll();
  const changedView = state.view !== r.view;
  state.view = r.view;

  for (const name of ['today', 'archive', 'about']) $(`#view-${name}`).hidden = name !== r.view;
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.dataset.nav === r.view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = TITLES[r.view];

  if (r.view === 'today') renderToday();
  if (r.view === 'archive') {
    if (r.date && r.date <= state.today) {
      if (state.selected !== r.date) state.editing = false;
      state.selected = r.date;
      const p = parseKey(r.date);
      state.month = { y: p.y, m: p.m };
    }
    renderArchive();
    const top = readerEl.getBoundingClientRect().top;
    const offscreen = top > window.innerHeight * 0.7 || top < 0;
    if (!changedView && r.date && offscreen && (state.revealReader || !calBody.contains(document.activeElement))) {
      readerEl.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    state.revealReader = false;
  }
  if (r.view === 'about') renderAbout();

  if (r.anchor) {
    const target = document.getElementById(r.anchor);
    target.scrollIntoView({ block: 'start' });
    if (!initial) target.focus({ preventScroll: true });
  } else if (!initial && changedView) {
    window.scrollTo(0, 0);
    const heading = r.view === 'today' ? $('#question') : r.view === 'archive' ? $('#archive-title') : $('#about-title');
    heading.focus({ preventScroll: true });
  }
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-nav="today"]');
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  if (location.hash) history.pushState(null, '', location.pathname + location.search);
  route();
});
window.addEventListener('hashchange', () => route());
window.addEventListener('popstate', () => route());

/* Clock */

function tick() {
  const now = new Date();
  $('#countdown').textContent = formatCountdown(msUntilTomorrow(now));
  const key = localKey(now);
  if (key !== state.today) {
    state.today = key;
    if (state.view === 'today') {
      const busy = document.activeElement === answerEl && answerEl.value.trim();
      if (busy) $('#new-day').hidden = false;
      else {
        todayWriter.flush();
        renderToday();
      }
    } else if (state.view === 'archive' && !state.editing) {
      renderArchive();
    }
  }
  if (state.view === 'today') updateTimer();
}

/* Other tabs */

window.addEventListener('storage', (e) => {
  if (e.key !== store.ANSWERS_KEY) return;
  if (state.view === 'today' && document.activeElement !== answerEl) renderToday();
  if (state.view === 'archive' && !state.editing) renderArchive();
});

/* Start */

$('#author-link').textContent = AUTHOR_NAME;
$('#author-link').href = AUTHOR_URL;
$('#source-link').href = REPO_URL;

if (GOATCOUNTER) {
  const script = document.createElement('script');
  script.async = true;
  script.src = '//gc.zgo.at/count.js';
  script.dataset.goatcounter = GOATCOUNTER;
  document.head.append(script);
}

syncTheme();
route({ initial: true });
tick();
setInterval(tick, 1000);
window.addEventListener('resize', () => {
  autosize(answerEl);
  if (state.editing) autosize(archiveAnswer);
});
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => autosize(answerEl));
