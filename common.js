// Shared by the making page and the gift page.
"use strict";
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const str = v => (typeof v === "string" ? v : "");
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const money = c => "$" + (c / 100).toFixed(2);
const longDate = ms => new Date(ms).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

// A contact can be an email address or a mobile number. Returns "email", "phone" or "".
function contactKind(v){
  v = String(v || "").trim();
  if (/^\S+@\S+\.\S+$/.test(v)) return "email";
  if (v.replace(/\D/g, "").length >= 10 && /^[\d\s().+-]+$/.test(v)) return "phone";
  return "";
}

async function api(path, opts){
  const headers = { "content-type": "application/json" };
  if (opts && opts.key) headers["x-order-key"] = opts.key;
  let res;
  try { res = await fetch(path, { method: (opts && opts.method) || "GET", headers, body: opts && opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch (e) { throw new Error("You seem to be offline. Check your connection and try again."); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Something went wrong. Try again.");
  return json;
}

let recN = 0;
// The shape that opens around the record on the gift page follows the song's tone.
const HEART = "M0,-30C-25,-75 -100,-55 -100,-5C-100,45 -40,75 0,110C40,75 100,45 100,-5C100,-55 25,-75 0,-30Z";
function polarPath(rAt, steps){
  let d = "";
  for (let i = 0; i < steps; i++){
    const a = -Math.PI / 2 + i * 2 * Math.PI / steps, r = rAt(i, a);
    d += (i ? "L" : "M") + (r * Math.cos(a)).toFixed(1) + "," + (r * Math.sin(a)).toFixed(1);
  }
  return d + "Z";
}
const SHAPES = {
  heart: { d: HEART, cy: 12, base: 0.92 },                                            // love and tenderness
  star:  { d: polarPath(i => (i % 2 ? 60 : 98), 10), cy: 0, base: 1 },                // pride and thanks
  sun:   { d: polarPath((i, a) => 81 + 7 * Math.cos(12 * (a + Math.PI / 2)), 240), cy: 0, base: 1 }, // warmth and lift
  burst: { d: polarPath(i => (i % 2 ? 77 : 97), 32), cy: 0, base: 1 }                 // fun
};
const TONE_SHAPE = { Heartfelt:"heart", Romantic:"heart", Tender:"heart", Bittersweet:"heart",
  Proud:"star", Grateful:"star", Uplifting:"sun", Nostalgic:"sun", Funny:"burst", Playful:"burst" };
// With two tones blended, the first one chosen decides.
function shapeFor(tone){ return TONE_SHAPE[String(tone || "").split(" and ")[0].trim()] || "heart"; }
function shapeSVG(kind){
  const s = SHAPES[kind] || SHAPES.heart;
  let lines = "";
  for (let i = -1; i < 10; i++){
    const k = s.base * 1.1 * Math.pow(1.15, i), o = i < 0 ? 1 : Math.max(0, 1 - i / 10), o2 = Math.max(0, 1 - (i + 1) / 10);
    lines += '<path class="hl" d="' + s.d + '" style="--k:' + k.toFixed(3) + ';--o:' + o.toFixed(2) + ';--o2:' + o2.toFixed(2) + '"/>';
  }
  return '<svg class="hearts' + (s.cy ? '' : ' centered') + '" viewBox="-130 ' + (s.cy - 130) + ' 260 260" aria-hidden="true" focusable="false">' + lines +
    '<g class="hb"><g transform="translate(0 ' + s.cy + ') scale(' + s.base + ') translate(0 ' + (-s.cy) + ')"><path class="well" d="' + s.d + '"/><path class="foil" d="' + s.d + '"/></g></g></svg>';
}

/* ---------- the record ---------- */
function wrapTitle(t){
  const words = t.split(/\s+/).filter(Boolean), lines = [""];
  for (const w of words){
    const cur = lines[lines.length - 1];
    if (!cur) lines[lines.length - 1] = w;
    else if ((cur + " " + w).length <= 24) lines[lines.length - 1] = cur + " " + w;
    else if (lines.length < 2) lines.push(w);
    else { lines[1] = lines[1].replace(/[\s.,;:!?]*$/, "") + "…"; break; }
  }
  return lines.map(l => l.length > 26 ? l.slice(0, 25) + "…" : l).filter(Boolean);
}
function recordSVG(o){
  const n = ++recN, to = str(o.recipient).trim(), from = str(o.sender).trim();
  const occ = str(o.occasion || "custom");
  const title = str(o.title).trim() || (/^(a |our )/i.test(occ) ? occ : "A " + occ.toLowerCase() + " song");
  const shown = to || "Rachel"; // the example name on the record until a visitor types their own
  const size = Math.max(20, Math.min(50, Math.round(380 / Math.max(shown.length, 7))));
  const lines = wrapTitle(title), ys = lines.length > 1 ? [243, 261] : [250];
  let grooves = "";
  for (let r = 192; r >= 114; r -= 4) grooves += '<circle cx="200" cy="200" r="' + r + '" fill="none" stroke="var(--groove)" stroke-width="' + (r % 28 === 0 ? 2.2 : 1) + '"/>';
  const bottom = from ? "from " + from : str(o.genre);
  const aria = "Record label. For " + shown + (from ? ", from " + from : "") + ". " + title + ".";
  return '<svg viewBox="0 0 400 400" role="img" aria-label="' + esc(aria) + '">' +
    '<defs><path id="arcT' + n + '" d="M 108 200 A 92 92 0 0 1 292 200"/><path id="arcB' + n + '" d="M 101 200 A 99 99 0 0 0 299 200"/></defs>' +
    '<circle cx="200" cy="200" r="198" fill="var(--disc)"/>' +
    '<circle cx="200" cy="200" r="197" fill="none" stroke="var(--disc-edge)" stroke-width="2"/>' + grooves +
    '<circle cx="200" cy="200" r="107" fill="var(--label)"/>' +
    '<circle cx="200" cy="200" r="107" fill="none" stroke="var(--disc-edge)" stroke-width="2.5"/>' +
    '<circle cx="200" cy="200" r="101" fill="none" stroke="var(--label-ink)" stroke-width=".8" opacity=".35"/>' +
    '<text class="lab-brand"><textPath href="#arcT' + n + '" startOffset="50%" text-anchor="middle">SONGPOST</textPath></text>' +
    '<text class="lab-for" x="200" y="138" text-anchor="middle">for</text>' +
    '<text class="lab-name" x="200" y="' + (160 + size * 0.36) + '" text-anchor="middle" font-size="' + size + '">' + esc(shown) + '</text>' +
    '<circle class="hole-dot" cx="200" cy="200" r="7" fill="var(--label-ink)"/>' +
    '<path class="hole-heart" d="M0,-30C-25,-75 -100,-55 -100,-5C-100,45 -40,75 0,110C40,75 100,45 100,-5C100,-55 25,-75 0,-30Z" transform="translate(200 200) scale(.105) translate(0 -24)" fill="var(--label-ink)"/>' +
    lines.map((l, i) => '<text class="lab-title" x="200" y="' + ys[i] + '" text-anchor="middle">' + esc(l) + '</text>').join("") +
    '<text class="lab-from"><textPath href="#arcB' + n + '" startOffset="50%" text-anchor="middle">' + esc(bottom.slice(0, 30)) + '</textPath></text></svg>';
}

// Lyrics as readable lines, with the section labels set apart.
function lyricsInto(box, lyrics){
  String(lyrics || "").split(/\r?\n/).forEach(line => {
    const t = line.trim(), m = /^\[(.+)\]$/.exec(t);
    if (m) box.append(el("p", "sec", m[1])); else if (!t) box.append(el("div", "gap")); else box.append(el("p", "ln", t));
  });
}

// A play button with a progress line, driving a real audio file. rec is the record that turns while it plays.
const mmss = t => Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0");
function mountAudio(box, src, playLabel, rec, onFirstPlay){
  box.textContent = "";
  const audio = new Audio(); audio.preload = "metadata"; audio.src = src;
  const btn = el("button", "btn small primary", playLabel); btn.type = "button";
  const bar = el("div", "pbar"), fill = el("i"); bar.append(fill);
  const time = el("span", "ptime", "0:00");
  const wrap = el("div", "player"); wrap.append(btn, bar, time); box.append(wrap);
  let played = false;
  const total = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
  const paint = () => { const d = total(); fill.style.width = d ? (audio.currentTime / d * 100) + "%" : "0"; time.textContent = mmss(audio.currentTime) + (d ? " / " + mmss(d) : ""); };
  audio.addEventListener("loadedmetadata", paint); audio.addEventListener("timeupdate", paint);
  audio.addEventListener("play", () => { btn.textContent = "Pause"; if (rec) rec.classList.add("spinning"); if (!played){ played = true; if (onFirstPlay) onFirstPlay(); } });
  const stopped = () => { btn.textContent = playLabel; if (rec) rec.classList.remove("spinning"); };
  audio.addEventListener("pause", stopped); audio.addEventListener("ended", stopped);
  audio.addEventListener("error", () => { time.textContent = "The song couldn't load. Reload the page."; });
  btn.addEventListener("click", () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
  return audio;
}
