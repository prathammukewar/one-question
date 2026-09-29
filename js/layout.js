// Line breaking for the share card. `measure` returns a string's width.

export function wrapText(text, maxWidth, measure) {
  const lines = [];
  const paragraphs = String(text).replace(/\r/g, '').split(/\n\s*\n+/);
  paragraphs.forEach((para, p) => {
    if (p > 0) lines.push('');
    for (const rawLine of para.split('\n')) {
      let line = '';
      for (const word of rawLine.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (measure(candidate) <= maxWidth) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        line = '';
        if (measure(word) <= maxWidth) {
          line = word;
          continue;
        }
        let piece = '';
        for (const ch of word) {
          if (piece && measure(piece + ch) > maxWidth) {
            lines.push(piece);
            piece = '';
          }
          piece += ch;
        }
        line = piece;
      }
      if (line) lines.push(line);
    }
  });
  return lines;
}

// Cut to maxLines, ending the last kept line with an ellipsis if anything was dropped.
export function clampLines(lines, maxLines, maxWidth, measure) {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, Math.max(1, maxLines));
  while (kept.length > 1 && kept[kept.length - 1] === '') kept.pop();
  let last = kept[kept.length - 1];
  while (last && measure(`${last}…`) > maxWidth) last = last.replace(/\s*\S+$/, '');
  kept[kept.length - 1] = `${last.replace(/[\s,;:.]+$/, '')}…`;
  return kept;
}

// Typographer's quotes for text typed with straight ones.
export function smartQuotes(text) {
  return String(text)
    .replace(/(\w)'(\w)/g, '$1\u2019$2')
    .replace(/(^|[\s([{\u201c-])'/g, '$1\u2018')
    .replace(/'/g, '\u2019')
    .replace(/(^|[\s([{\u2018-])"/g, '$1\u201c')
    .replace(/"/g, '\u201d');
}
