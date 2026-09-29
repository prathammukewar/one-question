// localStorage access. Reads never throw; writes throw so callers can report failures.

const ANSWERS = 'one-question:answers';
const PREFS = 'one-question:prefs';
const TIMER = 'one-question:timer';
export const THEME = 'one-question:theme';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

export const loadAnswers = () => read(ANSWERS, {});
export const saveAnswers = (answers) => localStorage.setItem(ANSWERS, JSON.stringify(answers));

export const loadPrefs = () => ({ timer: true, introDismissed: false, reminderTime: '09:00', ...read(PREFS, {}) });
export function savePrefs(patch) {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    // Preferences are a convenience; losing them is fine.
  }
}

export const loadTimer = () => read(TIMER, null);
export function saveTimer(value) {
  try {
    localStorage.setItem(TIMER, JSON.stringify(value));
  } catch {
    // Same as above.
  }
}

export function loadTheme() {
  try {
    return localStorage.getItem(THEME);
  } catch {
    return null;
  }
}
export function saveTheme(theme) {
  try {
    localStorage.setItem(THEME, theme);
  } catch {
    // Same as above.
  }
}

export const ANSWERS_KEY = ANSWERS;
