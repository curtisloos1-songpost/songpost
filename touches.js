'use strict';
// The sender's personal touches on a gift page: a signature drawn with a finger, and a few words in their own voice.
// Both arrive from the browser; this checks them before they are kept.

/*
  A signature is the strokes the sender drew: [[[x, y], [x, y], ...], ...], on a pad 600 wide and 200 high.
  Returns the strokes with whole-number points, or null when it is not a signature we can keep.
*/
const PAD_W = 600, PAD_H = 200;
function cleanStrokes(v) {
  if (!Array.isArray(v) || !v.length || v.length > 120) return null;
  const out = []; let points = 0, ink = 0;
  for (const s of v) {
    if (!Array.isArray(s) || !s.length) continue;
    const pts = [];
    for (const p of s) {
      if (!Array.isArray(p) || p.length < 2) return null;
      const x = Math.round(Number(p[0])), y = Math.round(Number(p[1]));
      if (!(x >= 0 && x <= PAD_W && y >= 0 && y <= PAD_H)) return null;
      const last = pts[pts.length - 1];
      if (last) ink += Math.hypot(x - last[0], y - last[1]);
      pts.push([x, y]);
    }
    points += pts.length;
    if (points > 6000) return null;
    out.push(pts);
  }
  return out.length && ink >= 25 ? out : null; // a dot or two is not a signature
}

// The strokes as a drawing that stays sharp at any size, cut close around the ink. It takes the colour of the writing around it.
function strokesSvg(strokes, cls) {
  if (!Array.isArray(strokes) || !strokes.length) return '';
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, d = '';
  for (const s of strokes) {
    for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (s.length === 1) { d += `M${s[0][0]} ${s[0][1]}l.1 0`; continue; }
    d += `M${s[0][0]} ${s[0][1]}`;
    for (let i = 1; i < s.length - 1; i++) d += `Q${s[i][0]} ${s[i][1]} ${(s[i][0] + s[i + 1][0]) / 2} ${(s[i][1] + s[i + 1][1]) / 2}`;
    d += `L${s[s.length - 1][0]} ${s[s.length - 1][1]}`;
  }
  const pad = 6;
  return `<svg class="${cls || 'sig'}" viewBox="${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}" role="img" aria-label="Signature"><path d="${d}" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/*
  The spoken message arrives as a WAV file the browser made: one channel, 16 bits. Returns { seconds, rate },
  or null when the bytes are not that.
*/
function wavInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return null;
  let i = 12, fmt = null, data = 0;
  while (i + 8 <= buf.length) {
    const id = buf.toString('latin1', i, i + 4), len = buf.readUInt32LE(i + 4);
    if (id === 'fmt ' && len >= 16 && i + 24 <= buf.length) fmt = { format: buf.readUInt16LE(i + 8), channels: buf.readUInt16LE(i + 10), rate: buf.readUInt32LE(i + 12), bits: buf.readUInt16LE(i + 22) };
    if (id === 'data') { data = Math.min(len, buf.length - i - 8); break; }
    i += 8 + len + (len % 2);
  }
  if (!fmt || fmt.format !== 1 || fmt.channels !== 1 || fmt.bits !== 16 || fmt.rate < 8000 || fmt.rate > 48000 || !data) return null;
  return { seconds: data / (fmt.rate * 2), rate: fmt.rate };
}

module.exports = { cleanStrokes, strokesSvg, wavInfo, PAD_W, PAD_H };
