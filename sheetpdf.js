'use strict';
// The lyric sheet as a PDF file: the same one-page sheet the lyric-sheet page shows, drawn here so it can be saved to a
// phone, sent as an attachment, and printed on exactly one page whatever the browser does with margins.
// It follows src/sheet.js measure for measure: the same six designs, the same order of fitting (smaller writing, then
// two columns, then a smaller photo, then three columns, and last of all no photo).
const path = require('path');
const fs = require('fs');
const { parseSections } = require('./sections');
const qrcode = require('qrcode-generator');

const IN = 72; // points in an inch
const HEART = 'M0,-30C-25,-75 -100,-55 -100,-5C-100,45 -40,75 0,110C40,75 100,45 100,-5C100,-55 25,-75 0,-30Z';
const DESIGNS = ['classic', 'seaglass', 'gold', 'midnight', 'liner', 'pressing'];

// The typefaces, by the names used below. The first four set the sheet; the rest are the handwritings a signature can be typed in.
const FONT_FILES = {
  serif: ['cormorant-garamond', '500Medium/CormorantGaramond_500Medium.ttf'],
  italic: ['cormorant-garamond', '500Medium_Italic/CormorantGaramond_500Medium_Italic.ttf'],
  bold: ['cormorant-garamond', '600SemiBold/CormorantGaramond_600SemiBold.ttf'],
  sans: ['jost', '500Medium/Jost_500Medium.ttf'],
  flowing: ['mrs-saint-delafield', '400Regular/MrsSaintDelafield_400Regular.ttf'],
  elegant: ['great-vibes', '400Regular/GreatVibes_400Regular.ttf'],
  formal: ['allura', '400Regular/Allura_400Regular.ttf'],
  brush: ['alex-brush', '400Regular/AlexBrush_400Regular.ttf'],
  friendly: ['dancing-script', '500Medium/DancingScript_500Medium.ttf'],
  fine: ['sacramento', '400Regular/Sacramento_400Regular.ttf'],
  classic: ['pinyon-script', '400Regular/PinyonScript_400Regular.ttf'],
  pen: ['homemade-apple', '400Regular/HomemadeApple_400Regular.ttf'],
};
FONT_FILES.handwritten = FONT_FILES.friendly;
// A typed signature: its size and line height in each handwriting, as on the page.
const SIG_SIZE = { flowing: [30, 1], elegant: [23, 1.1], formal: [25, 1.1], brush: [24, 1.1], friendly: [21, 1.1], handwritten: [21, 1.1], fine: [25, 1.1], classic: [23, 1.1], pen: [14, 1.5] };

let kit; // { PDFDocument, fontkit, paths: { name: file }, faces: { name: fontkit font } } once loaded, false if it can't be
function load() {
  if (kit !== undefined) return kit;
  try {
    const PDFDocument = require('pdfkit'), fontkit = require('fontkit');
    const paths = {};
    for (const [name, [pkg, file]] of Object.entries(FONT_FILES)) {
      try { const f = path.join(path.dirname(require.resolve(`@expo-google-fonts/${pkg}/package.json`)), file); fs.accessSync(f); paths[name] = f; }
      catch (e) { if (['serif', 'italic', 'bold', 'sans'].includes(name)) throw e; } // a handwriting that is missing falls back to italic
    }
    const faces = {};
    for (const name of ['serif', 'italic', 'bold', 'sans']) faces[name] = fontkit.openSync(paths[name]);
    kit = { PDFDocument, fontkit, paths, faces };
  } catch (e) {
    console.error('The lyric sheet cannot be made as a PDF here:', e && e.message);
    kit = false;
  }
  return kit;
}
const available = () => !!load();

// Whether every letter can be drawn in the sheet's own typefaces. A song in Japanese, say, cannot: its page still prints from the browser.
function covers(face, text) {
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    if (cp <= 32 || cp === 0xA0 || cp === 0xFE0F || cp === 0x200D) continue;
    if (!face.hasGlyphForCodePoint(cp)) return false;
  }
  return true;
}
function canDraw(s) {
  const k = load();
  if (!k) return false;
  const words = parseSections(s.lyrics).map(x => x.lines.join(' ')).join(' ');
  return covers(k.faces.serif, words) && covers(k.faces.italic, `${s.title || ''} From ${s.from || ''}`) && covers(k.faces.sans, `A song for ${s.recipient || ''}`.toUpperCase());
}

// How each design is dressed. Lengths are in inches, as in the page's own styles.
function theme(design) {
  const t = { ink: '#0E2A33', soft: '#52686E', silver: '#8B949F', bg: null, pad: [0.82, 0.9, 0.7, 0.9], align: 'center', disc: 'platinum', discSize: 0.56, kickerTop: 0.13,
    outer: { inset: 0.36, w: 1.1, c: '#0E2A33' }, inner: { inset: 0.43, w: 0.6, c: '#6CBCCB' }, picBg: '#FFFFFF' };
  if (design === 'seaglass') Object.assign(t, { bg: '#6CBCCB', pad: [1.04, 1.12, 0.9, 1.12], outer: null, mat: 0.52, inner: { inset: 0.64, w: 0.5, c: '#A9D6DE' } });
  if (design === 'gold') Object.assign(t, { silver: '#B8902F', disc: 'gold', outer: { inset: 0.36, w: 1.5, c: '#B8902F' }, inner: { inset: 0.43, w: 0.6, c: '#D9BE7A' } });
  if (design === 'midnight') Object.assign(t, { bg: '#0E2A33', ink: '#FFFFFF', soft: '#BFD9DE', silver: '#6CBCCB', outer: { inset: 0.36, w: 1.1, c: '#6CBCCB' }, inner: { inset: 0.43, w: 0.6, c: '#6CBCCB', o: 0.5 }, picBg: '#0E2A33' });
  if (design === 'liner') Object.assign(t, { align: 'left', pad: [0.92, 0.95, 0.78, 1.08], outer: null, inner: null, rule: true, disc: 'platinum', discSize: 0.98, kickerTop: 0 });
  if (design === 'pressing') Object.assign(t, { outer: null, inner: null, disc: null, kickerTop: 0.2, grooves: true });
  return t;
}

/*
  s: { design, paper ('letter' | 'a4'), title, recipient, from, paidAt, lyrics, photo (a JPEG as a Buffer, or null),
       signature (strokes, or { text, font }, or null), qr (what the QR code opens, or '' for none) }
  Resolves to { pdf: Buffer, note } where note says, in a sentence, if the photo had to be left off or the song did not all fit.
  Resolves to null when the sheet can't be drawn here (the typefaces are missing, or the words use letters they don't have).
*/
function sheetPdf(s) {
  const k = load();
  if (!k || !canDraw(s)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    try {
      const a4 = s.paper === 'a4', W = a4 ? 595.28 : 612, H = a4 ? 841.89 : 792;
      const design = DESIGNS.includes(s.design) ? s.design : 'classic', t = theme(design), left = t.align === 'left';
      const doc = new k.PDFDocument({ size: [W, H], margin: 0, autoFirstPage: true, info: { Title: `${s.title || 'Your song'} - lyric sheet`, Author: 'Songpost', Creator: 'Songpost' } });
      const chunks = []; let note = '';
      doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve({ pdf: Buffer.concat(chunks), note })); doc.on('error', reject);
      for (const [name, file] of Object.entries(k.paths)) doc.registerFont(name, file);

      const [pt, pr, pb, pl] = t.pad.map(v => v * IN), cw = W - pl - pr;
      // ---- measuring and setting words ----
      const width = (text, font, size, track) => { doc.font(font).fontSize(size); return doc.widthOfString(text, { characterSpacing: track || 0 }) - (track && text.length ? track : 0); };
      // Breaks text into lines no wider than max. A single word wider than the line is broken where it must be.
      const wrap = (text, font, size, max, track) => {
        const out = []; let line = '';
        for (const word of String(text).split(/\s+/).filter(Boolean)) {
          const tryLine = line ? line + ' ' + word : word;
          if (width(tryLine, font, size, track) <= max) { line = tryLine; continue; }
          if (line) out.push(line);
          line = word;
          while (width(line, font, size, track) > max && line.length > 1) {
            let n = line.length - 1;
            while (n > 1 && width(line.slice(0, n), font, size, track) > max) n--;
            out.push(line.slice(0, n)); line = line.slice(n);
          }
        }
        if (line) out.push(line);
        return out.length ? out : [''];
      };
      // One line of text, set the way a browser sets it: in a line box of the given height, with the letters in the middle of it.
      const put = (text, font, size, x, top, boxW, lineH, color, align, track) => {
        doc.font(font).fontSize(size).fillColor(color);
        const w = width(text, font, size, track), natural = doc.currentLineHeight();
        const tx = align === 'center' ? x + (boxW - w) / 2 : align === 'right' ? x + boxW - w : x;
        doc.text(text, tx, top + (lineH - natural) / 2, { lineBreak: false, characterSpacing: track || 0 });
      };
      const heart = (cx, cy, size, color) => { // size: how wide the heart is drawn
        const sc = size / 220; doc.save().translate(cx, cy).scale(sc).translate(0, -20).path(HEART).fill(color).restore();
      };
      // The record at the head of the sheet: platinum, or gold in the gold design.
      const disc = (x, y, size, gold) => {
        const u = size / 48, c = gold ? ['#FFF6D8', '#D3A53A', '#9A7218'] : ['#FFFFFF', '#C8CED6', '#8B949F'];
        doc.save().translate(x, y).scale(u);
        const g = doc.radialGradient(0.34 * 48, 0.28 * 48, 0, 0.34 * 48, 0.28 * 48, 0.8 * 48); g.stop(0, c[0]).stop(0.5, c[1]).stop(1, c[2]);
        doc.circle(24, 24, 23.3).fill(g); doc.circle(24, 24, 23.3).lineWidth(0.7).stroke(c[2]);
        for (const r of [19.4, 16.2, 13]) doc.circle(24, 24, r).lineWidth(0.45).strokeOpacity(0.22).stroke('#283440');
        doc.strokeOpacity(1); doc.circle(24, 24, 9.6).fill('#FFFFFF'); doc.circle(24, 24, 9.6).lineWidth(0.5).stroke(c[2]);
        doc.translate(24, 24).scale(0.052).translate(0, -24).path(HEART).fill('#0E2A33');
        doc.restore();
      };
      // The ornament between the parts: a rule, a small heart, a rule. In the liner design it is one short rule on the left.
      const ORN_H = t.align === 'left' ? 1 : 0.11 * IN;
      const orn = top => {
        if (left) { doc.moveTo(pl, top + 0.5).lineTo(pl + 1.25 * IN, top + 0.5).lineWidth(1).stroke(t.ink); return; }
        const w = 2.6 * IN, x = pl + (cw - w) / 2, mid = top + ORN_H / 2, hw = 0.11 * IN, gap = 0.12 * IN, arm = (w - hw - 2 * gap) / 2;
        doc.lineWidth(0.5).moveTo(x, mid).lineTo(x + arm, mid).stroke(t.silver).moveTo(x + w - arm, mid).lineTo(x + w, mid).stroke(t.silver);
        heart(x + w / 2, mid, hw, t.silver);
      };

      // ---- the sheet itself ----
      if (t.bg) doc.rect(0, 0, W, H).fill(t.bg);
      if (t.mat) { const m = t.mat * IN; doc.rect(m, m, W - 2 * m, H - 2 * m).fill('#FFFFFF'); doc.rect(m, m, W - 2 * m, H - 2 * m).lineWidth(0.75).strokeOpacity(0.28).stroke('#0E2A33'); doc.strokeOpacity(1); }
      if (t.grooves) { // the grooves of the record itself, running off the corner of the sheet, behind the words
        const u = 9.4 * IN / 200, cx = W - 1.2 * IN, cy = H - 1.2 * IN;
        doc.save().translate(cx, cy).scale(u);
        for (let i = 0; i < 34; i++) doc.circle(0, 0, 99 - i * 2.05).lineWidth(i % 7 === 0 ? 0.42 : 0.16).stroke('#C9D9DE');
        doc.circle(0, 0, 27).fill('#E3F1F4'); doc.circle(0, 0, 27).lineWidth(0.35).stroke('#A9D6DE');
        doc.scale(0.075).translate(0, -24).path(HEART).fill('#A9D6DE');
        doc.restore();
      }
      for (const b of [t.outer, t.inner]) {
        if (!b) continue;
        const m = b.inset * IN; doc.rect(m + b.w / 2, m + b.w / 2, W - 2 * m - b.w, H - 2 * m - b.w).lineWidth(b.w).strokeOpacity(b.o || 1).stroke(b.c); doc.strokeOpacity(1);
      }
      if (t.rule) doc.moveTo(0.62 * IN + 1.5, 0.62 * IN).lineTo(0.62 * IN + 1.5, H - 0.62 * IN).lineWidth(3).stroke('#6CBCCB');

      // The head: record, who it is for, the title.
      let y = pt;
      const headW = left ? cw - 1.3 * IN : cw;
      if (left) disc(W - 0.82 * IN - 0.98 * IN, 0.8 * IN, 0.98 * IN, false);
      else if (t.disc) { disc(pl + (cw - t.discSize * IN) / 2, y, t.discSize * IN, t.disc === 'gold'); y += t.discSize * IN; }
      y += t.kickerTop * IN;
      const KT = 8.5 * 0.24;
      for (const line of wrap(`A song for ${s.recipient || ''}`.toUpperCase(), 'sans', 8.5, headW, KT)) { put(line, 'sans', 8.5, pl, y, headW, 8.5 * 1.3, t.soft, t.align, KT); y += 8.5 * 1.3; }
      y += 0.07 * IN;
      let ts = 34, tl = wrap(s.title || 'Your song', 'italic', ts, headW);
      while (ts > 18 && tl.length > 2) { ts -= 1; tl = wrap(s.title || 'Your song', 'italic', ts, headW); }
      for (const line of tl) { put(line, 'italic', ts, pl, y, headW, ts * 1.08, t.ink, t.align); y += ts * 1.08; }
      y += 0.15 * IN; orn(y); y += ORN_H + 0.16 * IN;
      const headEnd = y;

      // The foot, measured from the bottom up: ornament, signature, who it is from, the date, the Songpost mark.
      const sig = s.signature, typed = sig && !Array.isArray(sig) && sig.text ? sig : null, drawn = Array.isArray(sig) && sig.length ? sig : null;
      const sigFont = typed ? (k.paths[typed.font] ? typed.font : 'italic') : null, [sigPt, sigLh] = typed ? (SIG_SIZE[typed.font] || [22, 1.1]) : [0, 0];
      const sigOk = typed && (sigFont === 'italic' ? covers(k.faces.italic, typed.text) : covers(k.fontkit.openSync(k.paths[sigFont]), typed.text));
      const sigH = drawn ? 0.5 * IN + 0.04 * IN : typed ? sigPt * sigLh + 0.04 * IN : 0;
      const fromW = s.qr ? cw - (left ? 1.1 : 2.2) * IN : cw, fromLines = wrap(`From ${s.from || ''}`, 'italic', 15, fromW);
      const footH = 0.16 * IN + ORN_H + 0.1 * IN + sigH + fromLines.length * 15 * 1.2 + 0.06 * IN + 8 * 1.3 + 0.14 * IN + 0.16 * IN;
      const footTop = H - pb - footH;

      // The photo, in its narrow white mount.
      let photo = null;
      if (s.photo) { try { photo = doc.openImage(s.photo); } catch (e) { photo = null; } }
      const picBox = small => {
        const maxW = (small ? 2.4 : 3.5) * IN - 11, maxH = (small ? 1.3 : 2.25) * IN - 11;
        const sc = Math.min(maxW / photo.width, maxH / photo.height, 0.75); // never larger than the picture's own size
        const w = photo.width * sc, h = photo.height * sc;
        return { w: w + 11, h: h + 11, after: (small ? 0.13 : 0.18) * IN };
      };

      // The words: verses as blocks, set in one, two or three columns, in the largest writing that fits.
      const stanzas = parseSections(s.lyrics).filter(x => x.lines.length).map(x => x.lines);
      const count = stanzas.reduce((n, st) => n + st.length, 0);
      const GAP = { 1: 0, 2: 0.42 * IN, 3: 0.3 * IN };
      // Tries one setting. Returns how it would be laid out, or null when it does not fit in the room given.
      const setting = (cols, size, room, loose) => {
        const colW = (cw - GAP[cols] * (cols - 1)) / cols, lh = size * 1.42, gap = size * 0.92;
        // what cannot be split: a whole verse, or in the loose setting a single line
        const blocks = [];
        for (const st of stanzas) {
          const lines = st.map(l => wrap(l, 'serif', size, colW)).reduce((a, b) => a.concat(b), []);
          if (loose) lines.forEach((l, i) => blocks.push({ lines: [l], lead: i === 0 }));
          else blocks.push({ lines, lead: true });
        }
        const fill = h => { // puts the blocks into columns no taller than h; returns the columns, or null if they don't all go in
          const out = [[]]; let used = 0;
          for (const b of blocks) {
            const bh = b.lines.length * lh, before = out[out.length - 1].length && b.lead ? gap : 0;
            if (used + before + bh > h + 0.01 && out[out.length - 1].length) { if (out.length === cols) return null; out.push([]); used = 0; }
            else used += before;
            if (bh > h + 0.01) return null;
            out[out.length - 1].push(b); used += bh;
          }
          return out;
        };
        if (!fill(room)) return null;
        // columns of even height, as a browser balances them: the shortest height that still takes everything
        let lo = 0, hi = room;
        for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fill(mid)) hi = mid; else lo = mid; }
        const columns = fill(hi) || fill(room);
        const tall = Math.max(...columns.map(c => c.reduce((n, b, i) => n + (i && b.lead ? gap : 0) + b.lines.length * lh, 0)));
        return { cols, size, colW, lh, gap, columns, tall };
      };
      const tryFit = (cols, from, to, room, loose) => { for (let sz = from; sz >= to - 0.001; sz -= 0.25) { const r = setting(cols, sz, room, loose); if (r) return r; } return null; };
      const roomWith = pic => footTop - headEnd - (pic ? pic.h + pic.after : 0);
      let pic = photo ? picBox(false) : null, fit = null;
      fit = (count <= 34 && tryFit(1, 14.5, 10.5, roomWith(pic))) || tryFit(2, 12.5, 8.5, roomWith(pic));
      if (!fit && pic) { pic = picBox(true); fit = tryFit(2, 12.5, 8, roomWith(pic)) || tryFit(3, 10.5, 7.5, roomWith(pic)); }
      if (!fit && pic) { pic = null; note = 'This is a long song, so the photo was left off to make room for the words.'; fit = tryFit(2, 12.5, 8, roomWith(null)); }
      if (!fit) fit = tryFit(3, 10.5, 6.5, roomWith(pic)) || tryFit(3, 8, 6, roomWith(pic), true);
      if (!fit) { // too long for one page even so: as much as fits, in the smallest writing, and say so
        note = 'This song is too long to fit on one page. The last lines are missing from the sheet.';
        const room = roomWith(pic), size = 6, lh = size * 1.42, gap = size * 0.92, colW = (cw - GAP[3] * 2) / 3, columns = [[]]; let used = 0;
        outer: for (const st of stanzas) {
          const lines = st.map(l => wrap(l, 'serif', size, colW)).reduce((a, b) => a.concat(b), []);
          for (let i = 0; i < lines.length; i++) {
            const before = i === 0 && columns[columns.length - 1].length ? gap : 0;
            if (used + before + lh > room) { if (columns.length === 3) break outer; columns.push([]); used = 0; } else used += before;
            columns[columns.length - 1].push({ lines: [lines[i]], lead: i === 0 }); used += lh;
          }
        }
        fit = { cols: 3, size, colW, lh, gap, columns, tall: room };
      }

      y = headEnd;
      if (pic) {
        const x = left ? pl : pl + (cw - pic.w) / 2;
        doc.rect(x, y, pic.w, pic.h).fill(t.picBg); doc.rect(x + 0.25, y + 0.25, pic.w - 0.5, pic.h - 0.5).lineWidth(0.5).stroke(t.silver);
        doc.image(photo, x + 5.5, y + 5.5, { width: pic.w - 11, height: pic.h - 11 });
        y += pic.h + pic.after;
      }
      // what is left over goes above and below, so a short song sits in the middle of the sheet
      const spare = footTop - y - fit.tall; let ly = y + (spare > 6 ? Math.floor(spare * 0.42) : 0);
      fit.columns.forEach((col, ci) => {
        const x = pl + ci * (fit.colW + GAP[fit.cols]); let cy = ly;
        col.forEach((b, bi) => {
          if (bi && b.lead) cy += fit.gap;
          for (const line of b.lines) { put(line, 'serif', fit.size, x, cy, fit.colW, fit.lh, t.ink, t.align); cy += fit.lh; }
        });
      });

      // The foot.
      y = footTop + 0.16 * IN; orn(y); y += ORN_H + 0.1 * IN;
      if (drawn) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const st of drawn) for (const [px, py] of st) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
        const pad = 6, vw = x1 - x0 + 2 * pad, vh = y1 - y0 + 2 * pad, sc = Math.min(0.5 * IN / vh, 2.6 * IN / vw), w = vw * sc;
        doc.save().translate(left ? pl : pl + (cw - w) / 2, y).scale(sc).translate(-(x0 - pad), -(y0 - pad)).lineWidth(3.4).lineCap('round').lineJoin('round');
        for (const st of drawn) {
          if (st.length === 1) { doc.moveTo(st[0][0], st[0][1]).lineTo(st[0][0] + 0.1, st[0][1]); continue; }
          doc.moveTo(st[0][0], st[0][1]);
          for (let i = 1; i < st.length - 1; i++) doc.quadraticCurveTo(st[i][0], st[i][1], (st[i][0] + st[i + 1][0]) / 2, (st[i][1] + st[i + 1][1]) / 2);
          doc.lineTo(st[st.length - 1][0], st[st.length - 1][1]);
        }
        doc.stroke(t.ink).restore(); y += sigH;
      } else if (typed) {
        const f = sigOk ? sigFont : 'italic'; let sz = sigPt;
        while (sz > 10 && width(typed.text, f, sz) > cw - (s.qr ? 2.2 * IN : 0)) sz -= 1;
        put(typed.text, f, sz, pl, y, cw, sigPt * sigLh, t.ink, t.align); y += sigH;
      }
      const fx = left ? pl : pl + (cw - fromW) / 2;
      for (const line of fromLines) { put(line, 'italic', 15, fx, y, fromW, 15 * 1.2, t.ink, t.align); y += 15 * 1.2; }
      y += 0.06 * IN;
      const when = new Date(s.paidAt || Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
      put(when, 'sans', 8, pl, y, cw, 8 * 1.3, t.soft, t.align, 8 * 0.22); y += 8 * 1.3 + 0.14 * IN;
      // the Songpost mark: the gold record with its heart, and the name
      const ms = 0.16 * IN, nameW = width('Songpost', 'bold', 11.5), markW = ms + 0.06 * IN + nameW, mx = left ? pl : pl + (cw - markW) / 2;
      doc.save().translate(mx, y).scale(ms / 24);
      doc.circle(12, 12, 11.3).fill('#D3A53A'); doc.circle(12, 12, 11.3).lineWidth(1).stroke('#9A7218'); doc.circle(12, 12, 7).fill('#FFFFFF');
      doc.translate(12, 12).scale(0.0504).translate(0, -18).path(HEART).fill('#0E2A33'); doc.restore();
      put('Songpost', 'bold', 11.5, mx + ms + 0.06 * IN, y, nameW, ms, t.ink, 'left');

      // A QR code that plays the song, in the corner beside the signature.
      if (s.qr) {
        const q = qrcode(0, 'Q'); q.addData(String(s.qr)); q.make();
        const n = q.getModuleCount(), m = 4, full = n + 2 * m, side = 0.82 * IN, u = side / full, badge = n * 0.115;
        const gap = (design === 'midnight' ? 0.09 : 0.045) * IN, x = W - pr - side, top = H - pb - 6.5 - gap - side;
        if (design === 'midnight') doc.rect(x - 0.04 * IN, top - 0.04 * IN, side + 0.08 * IN, side + 0.08 * IN).fill('#FFFFFF');
        doc.save().translate(x, top).scale(u);
        doc.rect(0, 0, full, full).fill('#FFFFFF');
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
          if (!q.isDark(r, c) || Math.hypot(c + 0.5 - n / 2, r + 0.5 - n / 2) < badge + 0.6) continue;
          doc.rect(c + m, r + m, 1.02, 1.02);
        }
        doc.fill('#0E2A33');
        doc.circle(full / 2, full / 2, badge).fill('#FFFFFF'); doc.circle(full / 2, full / 2, badge).lineWidth(n * 0.012).stroke('#6CBCCB');
        doc.translate(full / 2, full / 2).scale(badge * 0.0064).translate(0, -18).path(HEART).fill('#0E2A33');
        doc.restore();
        put('SCAN TO HEAR IT', 'sans', 6.5, x - 0.3 * IN, top + side + gap, side + 0.6 * IN, 6.5, t.soft, 'center', 6.5 * 0.14);
      }
      doc.end();
    } catch (e) { reject(e); }
  });
}

module.exports = { sheetPdf, canDraw, available, DESIGNS };
