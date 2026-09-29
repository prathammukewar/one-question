import { clampLines, smartQuotes, wrapText } from './layout.js';

export const SIZES = {
  portrait: { width: 1080, height: 1350 },
  wide: { width: 1200, height: 630 },
};

const PALETTES = {
  paper: { bg: '#f7f3ea', ink: '#1f1b16', muted: '#6c6353', accent: '#9a3a22', rule: '#d9cfbd' },
  ink: { bg: '#17150f', ink: '#efe8da', muted: '#a89f8c', accent: '#e39373', rule: '#3b362c' },
};

const SERIF = 'Newsreader, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export async function loadCardFonts() {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.all([
      document.fonts.load('500 64px Newsreader'),
      document.fonts.load('400 36px Newsreader'),
      document.fonts.load('italic 400 36px Newsreader'),
    ]);
  } catch {
    // Georgia and friends are fine too.
  }
}

function spaced(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

// Largest size from `sizes` whose wrapped lines fit in `maxHeight`, clamped at the smallest.
function fit(ctx, text, { sizes, weight, style = 'normal', lineHeight, maxWidth, maxHeight }) {
  for (const size of sizes) {
    ctx.font = `${style} ${weight} ${size}px ${SERIF}`;
    const measure = (s) => ctx.measureText(s).width;
    const lines = wrapText(text, maxWidth, measure);
    const lh = size * lineHeight;
    if (lines.length * lh <= maxHeight || size === sizes[sizes.length - 1]) {
      const maxLines = Math.max(1, Math.floor(maxHeight / lh));
      return { size, lh, lines: clampLines(lines, maxLines, maxWidth, measure), font: ctx.font, truncated: lines.length > maxLines };
    }
  }
  return null;
}

function drawLines(ctx, block, x, y) {
  ctx.font = block.font;
  ctx.textBaseline = 'alphabetic';
  let cursor = y;
  for (const line of block.lines) {
    if (line === '') {
      cursor += block.lh * 0.5;
      continue;
    }
    ctx.fillText(line, x, cursor + block.size * 0.95);
    cursor += block.lh;
  }
  return cursor;
}

const blockHeight = (block) => block.lines.reduce((h, line) => h + (line === '' ? block.lh * 0.5 : block.lh), 0);

const range = (from, to, step) => {
  const out = [];
  for (let v = from; v >= to; v -= step) out.push(v);
  return out;
};

export function drawCard(canvas, { size = 'portrait', palette = 'paper', question, answer = '', excerpt = false, issue, dateLabel, siteLabel }) {
  const { width: W, height: H } = SIZES[size];
  const colors = PALETTES[palette];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const wide = size === 'wide';
  const M = wide ? 64 : 96;
  const label = wide ? 22 : 28;
  const text = smartQuotes(answer.trim());

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, H);

  // Masthead
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 ${label}px ${SANS}`;
  spaced(ctx, label * 0.16);
  ctx.fillStyle = colors.accent;
  ctx.textAlign = 'left';
  ctx.fillText(`ONE QUESTION  #${issue}`, M, M + label);
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'right';
  ctx.fillText(dateLabel.toUpperCase(), W - M, M + label);
  spaced(ctx, 0);
  ctx.textAlign = 'left';

  const headRule = M + label + (wide ? 22 : 30);
  const footRule = H - M - (wide ? 34 : 48);
  ctx.fillStyle = colors.ink;
  ctx.fillRect(M, headRule, W - 2 * M, 2);
  ctx.fillStyle = colors.rule;
  ctx.fillRect(M, footRule, W - 2 * M, 1.5);

  // Footer
  ctx.font = `400 ${label}px ${SANS}`;
  ctx.fillStyle = colors.muted;
  ctx.fillText('A new question every day', M, H - M);
  ctx.textAlign = 'right';
  ctx.fillStyle = colors.ink;
  ctx.fillText(siteLabel, W - M, H - M);
  ctx.textAlign = 'left';

  const top = headRule + (wide ? 44 : 72);
  const bottom = footRule - (wide ? 36 : 60);
  const inner = W - 2 * M;
  ctx.fillStyle = colors.ink;

  if (!text) {
    const q = fit(ctx, question, {
      sizes: wide ? range(76, 40, 2) : range(100, 52, 2),
      weight: 500,
      lineHeight: 1.14,
      maxWidth: wide ? inner * 0.92 : inner,
      maxHeight: bottom - top,
    });
    const h = blockHeight(q);
    const y = wide ? top + Math.max(0, (bottom - top - h) / 2) : top + Math.max(0, (bottom - top - h) * 0.38);
    drawLines(ctx, q, M, y);
    return { canvas, truncated: false };
  }

  const answerStyle = excerpt ? 'italic' : 'normal';

  if (wide) {
    const leftW = 470;
    const gutter = 72;
    const height = bottom - top;
    const q = fit(ctx, question, { sizes: range(52, 30, 2), weight: 500, lineHeight: 1.16, maxWidth: leftW, maxHeight: height });
    const a = fit(ctx, text, {
      sizes: excerpt ? range(40, 21, 1) : range(30, 21, 1),
      weight: 400,
      style: answerStyle,
      lineHeight: 1.5,
      maxWidth: inner - leftW - gutter,
      maxHeight: height,
    });
    ctx.fillStyle = colors.ink;
    drawLines(ctx, q, M, top + Math.max(0, (height - blockHeight(q)) / 2));
    drawLines(ctx, a, M + leftW + gutter, top + Math.max(0, (height - blockHeight(a)) / 2));
    ctx.fillStyle = colors.rule;
    ctx.fillRect(M + leftW + gutter / 2, top + 4, 1.5, height - 4);
    return { canvas, truncated: a.truncated };
  }

  const height = bottom - top;
  const gap = 48 + 4 + 52;
  const q = fit(ctx, question, { sizes: range(76, 44, 2), weight: 500, lineHeight: 1.15, maxWidth: inner, maxHeight: height * 0.42 });
  const a = fit(ctx, text, {
    sizes: excerpt ? range(56, 28, 1) : range(40, 28, 1),
    weight: 400,
    style: answerStyle,
    lineHeight: 1.45,
    maxWidth: inner,
    maxHeight: height - blockHeight(q) - gap,
  });
  const total = blockHeight(q) + gap + blockHeight(a);
  let y = top + Math.max(0, (height - total) * 0.4);
  ctx.fillStyle = colors.ink;
  y = drawLines(ctx, q, M, y) + 48;
  ctx.fillStyle = colors.accent;
  ctx.fillRect(M, y, 72, 4);
  ctx.fillStyle = colors.ink;
  drawLines(ctx, a, M, y + 56);
  return { canvas, truncated: a.truncated };
}

export function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not make the image.'))), 'image/png');
  });
}
