'use strict';
// Lyrics arrive as text with section labels on their own lines: [Verse 1], [Chorus], ...
// Returns [{ name, lines }] in order. Text before the first label becomes "Verse 1".
function parseSections(lyrics) {
  const out = [];
  let cur = null;
  for (const raw of String(lyrics || '').split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^\[(.+?)\]$/.exec(line);
    if (m) { cur = { name: m[1].trim(), lines: [] }; out.push(cur); continue; }
    if (!line) continue;
    if (!cur) { cur = { name: 'Verse 1', lines: [] }; out.push(cur); }
    cur.lines.push(line);
  }
  return out;
}
module.exports = { parseSections };
