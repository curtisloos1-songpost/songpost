'use strict';
/*
  The picture a messaging app shows when a gift link is sent: the record, in its metal, with their name on it.
  Without it a text message shows a bare link.

  It is drawn as an SVG and turned into a PNG by @resvg/resvg-js, with the site's own serif from an npm package,
  so it looks the same wherever the site runs. If either package is missing the site carries on without the
  picture: available() says so, and the gift page then leaves the picture out of what it tells messaging apps.
*/
const path = require('path');

const W = 960, H = 504; // drawn 1200 x 630 and made this size: large enough for any app, and well under their file-size limits
const HEART = 'M0,-30C-25,-75 -100,-55 -100,-5C-100,45 -40,75 0,110C40,75 100,45 100,-5C100,-55 25,-75 0,-30Z';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (s, max) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max - 1).trim() + '...' : s; };

let tools; // { Resvg, fonts } once loaded, false if they can't be
function load() {
  if (tools !== undefined) return tools;
  try {
    const { Resvg } = require('@resvg/resvg-js');
    const dir = path.dirname(require.resolve('@expo-google-fonts/cormorant-garamond/package.json'));
    const fonts = ['700Bold/CormorantGaramond_700Bold.ttf', '500Medium_Italic/CormorantGaramond_500Medium_Italic.ttf', '600SemiBold/CormorantGaramond_600SemiBold.ttf'].map(f => path.join(dir, f));
    fonts.forEach(f => require('fs').accessSync(f));
    tools = { Resvg, fonts };
  } catch (e) {
    console.warn('The link-preview picture is off: its drawing tools could not be loaded.', e && e.message);
    tools = false;
  }
  return tools;
}
const available = () => !!load();

// Whether the font can draw a letter. The font covers Latin and Cyrillic writing; a letter it lacks would come out
// as an empty box, so each letter outside plain English is tried once: drawn alone, and compared with a letter known to be missing.
const drawn = new Map();
let blank;
function draws(ch) {
  const code = ch.codePointAt(0);
  if (code >= 0x20 && code <= 0x7e) return true;
  if (drawn.has(ch)) return drawn.get(ch);
  const t = load();
  const one = c => new t.Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><text x="4" y="30" font-family="Cormorant Garamond" font-weight="700" font-size="28">${esc(c)}</text></svg>`,
    { font: { fontFiles: t.fonts, loadSystemFonts: false, defaultFontFamily: 'Cormorant Garamond' } }).render().asPng();
  if (!blank) blank = [one(String.fromCodePoint(0x10FFFD)), one(String.fromCodePoint(0xE000))];
  let ok = false;
  try { const png = one(ch); ok = /\s/.test(ch) || !blank.some(b => b.equals(png)); } catch (e) { ok = false; }
  if (drawn.size > 5000) drawn.clear();
  drawn.set(ch, ok);
  return ok;
}
// Text with the letters the font cannot draw (and emoji) taken out.
const drawable = s => Array.from(String(s || '')).filter(draws).join('').replace(/\s+/g, ' ').trim();
// A name can go on the picture when every one of its letters can be drawn. One that cannot gets no picture: a bare link beats a wrong name.
function canDraw(name) {
  if (!load()) return false;
  try { const letters = Array.from(String(name || '')).filter(c => /\p{L}/u.test(c)); return letters.length > 0 && letters.every(draws); }
  catch (e) { return false; }
}

// o: { recipient, sender, title, metal }
function cardSvg(o) {
  const gold = o.metal !== 'platinum';
  const c = gold ? { disc: '#D3A53A', edge: '#9A7218', groove: 'rgba(96,62,0,.22)', hi: '#FFF3C4', lo: '#A87A14' }
    : { disc: '#C8CED6', edge: '#8B949F', groove: 'rgba(40,52,64,.22)', hi: '#FFFFFF', lo: '#8E98A3' };
  const name = short(drawable(o.recipient), 26) || 'you', title = short(drawable(o.title), 34), from = short(drawable(o.sender), 26);
  // sized so each line stays inside the round label
  const nameSize = Math.max(13, Math.min(52, Math.round(350 / Math.max(name.length, 6))));
  const titleSize = Math.max(9.5, Math.min(14.5, 390 / Math.max(title.length, 1))).toFixed(1);
  let grooves = '';
  for (let r = 192; r >= 114; r -= 4) grooves += `<circle cx="200" cy="200" r="${r}" fill="none" stroke="${c.groove}" stroke-width="${r % 28 === 0 ? 2.2 : 1}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="disc" cx="50%" cy="50%" r="50%"><stop offset=".5" stop-color="${c.disc}"/><stop offset=".78" stop-color="${c.hi}"/><stop offset=".9" stop-color="${c.disc}"/><stop offset="1" stop-color="${c.lo}"/></radialGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".42" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".75"/><stop offset=".58" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <clipPath id="ring"><path d="M200,2a198,198 0 1,0 0.01,0Z M200,93a107,107 0 1,1 -0.01,0Z" clip-rule="evenodd"/></clipPath>
    <path id="arcT" d="M 108 200 A 92 92 0 0 1 292 200"/><path id="arcB" d="M 101 200 A 99 99 0 0 0 299 200"/>
  </defs>
  <rect width="1200" height="630" fill="#6CBCCB"/>
  <g fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="1.5"><circle cx="600" cy="315" r="300"/><circle cx="600" cy="315" r="350"/><circle cx="600" cy="315" r="410"/><circle cx="600" cy="315" r="480"/><circle cx="600" cy="315" r="560"/></g>
  <g fill="#06323C" fill-opacity=".05"><ellipse cx="600" cy="340" rx="290" ry="286"/><ellipse cx="600" cy="340" rx="284" ry="280"/><ellipse cx="600" cy="340" rx="278" ry="274"/><ellipse cx="600" cy="340" rx="272" ry="268"/></g>
  <g transform="translate(332 47) scale(1.34)">
    <circle cx="200" cy="200" r="198" fill="url(#disc)"/>
    <g clip-path="url(#ring)"><rect x="-40" y="-40" width="480" height="480" fill="url(#shine)"/><rect x="-40" y="-40" width="480" height="480" fill="url(#shine)" transform="rotate(118 200 200)" opacity=".7"/></g>
    <circle cx="200" cy="200" r="197" fill="none" stroke="${c.edge}" stroke-width="2"/>${grooves}
    <circle cx="200" cy="200" r="107" fill="#FFFFFF"/><circle cx="200" cy="200" r="107" fill="none" stroke="${c.edge}" stroke-width="2.5"/>
    <circle cx="200" cy="200" r="101" fill="none" stroke="#0E2A33" stroke-width=".8" opacity=".35"/>
    <text font-family="Cormorant Garamond" font-weight="600" font-size="9.5" letter-spacing="3.2" fill="#0E2A33"><textPath href="#arcT" startOffset="50%" text-anchor="middle">SONGPOST</textPath></text>
    <text x="200" y="138" text-anchor="middle" font-family="Cormorant Garamond" font-style="italic" font-weight="500" font-size="17" fill="#0E2A33">for</text>
    <text x="200" y="${(160 + nameSize * 0.36).toFixed(1)}" text-anchor="middle" font-family="Cormorant Garamond" font-weight="700" font-size="${nameSize}" fill="#0E2A33">${esc(name)}</text>
    <path d="${HEART}" transform="translate(200 200) scale(.105) translate(0 -24)" fill="#0E2A33"/>
    <text x="200" y="250" text-anchor="middle" font-family="Cormorant Garamond" font-style="italic" font-weight="500" font-size="${titleSize}" fill="#0E2A33">${esc(title)}</text>
    ${from ? `<text font-family="Cormorant Garamond" font-weight="600" font-size="10.5" letter-spacing="1.2" fill="#0E2A33"><textPath href="#arcB" startOffset="50%" text-anchor="middle">from ${esc(from)}</textPath></text>` : ''}
  </g>
</svg>`;
}

// The last pictures drawn, so a link sent to a group is drawn once and not once for each phone that shows it.
const kept = new Map();
function cardPng(o) {
  const t = load();
  if (!t) return null;
  const key = JSON.stringify([o.recipient, o.sender, o.title, o.metal]);
  if (kept.has(key)) return kept.get(key);
  const png = new t.Resvg(cardSvg(o), { font: { fontFiles: t.fonts, loadSystemFonts: false, defaultFontFamily: 'Cormorant Garamond' }, fitTo: { mode: 'width', value: W } }).render().asPng();
  kept.set(key, png);
  if (kept.size > 40) kept.delete(kept.keys().next().value);
  return png;
}

module.exports = { available, canDraw, cardPng, cardSvg, W, H };
