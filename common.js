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
  if (opts && opts.headers) Object.assign(headers, opts.headers);
  let res;
  try { res = await fetch(path, { method: (opts && opts.method) || "GET", headers, body: opts && opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch (e) { throw new Error("You seem to be offline. Check your connection and try again."); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Something went wrong. Try again.");
  return json;
}

// Four short questions take the place of one blank box. A memory or a life story asks different ones.
const QUESTIONS = {
  "A favorite memory": ["What's the memory?", [
    ["Where were you, and when?", "Grandma's porch, the summer I turned ten"],
    ["What happened?", "She taught me to play dominoes and let me win"],
    ["A detail you can still picture", "The sound of the tiles on the metal table"],
    ["Why does it stay with you?", "It was the first time I felt grown up"]]],
  "Our story": ["What's your story?", [
    ["How did it begin?", "She raised three of us mostly on her own"],
    ["A moment along the way", "She ran behind my bike the whole way across the lot"],
    ["Where are things now?", "I have kids of my own and finally understand"],
    ["How do they make you feel?", "Like I could do anything"]]],
  "A theme or feeling": ["What's the song about?", [
    ["The theme, in a few words", "Young love. Growing old together. Coming home."],
    ["What should it make them feel?", "Like they're seventeen again"],
    ["Pictures or moments to put in it", "A gravel road, a porch light, a first slow dance"],
    ["Why this theme, for this person?", "It's how the two of us started"]]],
  "": ["What should the song say?", [
    ["What do you love most about them?", "He shows up for everyone, every time"],
    ["A moment with them you'll never forget", "The road trip when the truck broke down"],
    ["Something they always say or do", "He ends every call with \"be good\""],
    ["What do you want them to know?", "That I noticed all of it"]]]
};
function questionsFor(occasion){ return QUESTIONS[occasion] || QUESTIONS[""]; }

// Who a song made together is from: "Anna, Beth and Carol", or "Anna and 5 others" when the list runs long.
function listNames(names){ return names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]; }
function fromLine(names){ const all = listNames(names); return names.length < 3 || all.length <= 40 ? all : names[0] + " and " + (names.length - 1) + " others"; }

// How the visitor arrived, kept on this device for 30 days: from a gift page, from adding to a group song, or by a partner's link.
// heard is their answer to "How did you hear about Songpost?", asked once.
const SOURCE_KEY = "songpost-source-v1";
function readSource(){
  try { const s = JSON.parse(localStorage.getItem(SOURCE_KEY) || "null") || {}; if (s.at && Date.now() - s.at > 30 * 24 * 3600 * 1000){ delete s.from; delete s.join; delete s.ref; } return s; }
  catch (e) { return {}; }
}
function writeSource(patch){ try { localStorage.setItem(SOURCE_KEY, JSON.stringify(Object.assign(readSource(), patch))); } catch (e) {} }

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
  // Until the song has a title: "A birthday song", "An anniversary song". A named day keeps its capitals: "A National Histology Day song".
  const said = /\s[A-Z]/.test(occ) ? occ : occ.toLowerCase();
  const title = str(o.title).trim() || (/^(a |our )/i.test(occ) ? occ : (/^[aeiou]/i.test(said) ? "An " : "A ") + said + " song");
  const shown = to || "their name"; // a blank to fill in, shown until a visitor types the name
  const size = o.nameSize || Math.max(20, Math.min(50, Math.round(380 / Math.max(shown.length, 7))));
  const lines = wrapTitle(title), ys = lines.length > 1 ? [243, 261] : [250];
  let grooves = "";
  for (let r = 192; r >= 114; r -= 4) grooves += '<circle cx="200" cy="200" r="' + r + '" fill="none" stroke="var(--groove)" stroke-width="' + (r % 28 === 0 ? 2.2 : 1) + '"/>';
  const bottom = from ? "from " + from : str(o.genre);
  // o.lead replaces the small "for" above the name, and o.aria the spoken description: used by the two records on the opening page.
  const aria = str(o.aria) || "Record label. " + (to ? "For " + to : "Your song for someone you love") + (from ? ", from " + from : "") + ". " + title + ".";
  return '<svg viewBox="0 0 400 400" role="img" aria-label="' + esc(aria) + '">' +
    '<defs><path id="arcT' + n + '" d="M 108 200 A 92 92 0 0 1 292 200"/><path id="arcB' + n + '" d="M 101 200 A 99 99 0 0 0 299 200"/></defs>' +
    '<circle cx="200" cy="200" r="198" fill="var(--disc)"/>' +
    '<circle cx="200" cy="200" r="197" fill="none" stroke="var(--disc-edge)" stroke-width="2"/>' + grooves +
    '<circle cx="200" cy="200" r="107" fill="var(--label)"/>' +
    '<circle cx="200" cy="200" r="107" fill="none" stroke="var(--disc-edge)" stroke-width="2.5"/>' +
    '<circle cx="200" cy="200" r="101" fill="none" stroke="var(--label-ink)" stroke-width=".8" opacity=".35"/>' +
    '<text class="lab-brand"><textPath href="#arcT' + n + '" startOffset="50%" text-anchor="middle">SONGPOST</textPath></text>' +
    '<text class="lab-for" x="200" y="138" text-anchor="middle">' + esc(str(o.lead) || "for") + '</text>' +
    '<text class="lab-name' + (to ? '' : ' blank') + '" x="200" y="' + (160 + size * 0.36) + '" text-anchor="middle" font-size="' + size + '">' + esc(shown) + '</text>' +
    '<circle class="hole-dot" cx="200" cy="200" r="7" fill="var(--label-ink)"/>' +
    '<path class="hole-heart" d="M0,-30C-25,-75 -100,-55 -100,-5C-100,45 -40,75 0,110C40,75 100,45 100,-5C100,-55 25,-75 0,-30Z" transform="translate(200 200) scale(.105) translate(0 -24)" fill="var(--label-ink)"/>' +
    lines.map((l, i) => '<text class="lab-title" x="200" y="' + ys[i] + '" text-anchor="middle">' + esc(l) + '</text>').join("") +
    '<text class="lab-from"><textPath href="#arcB' + n + '" startOffset="50%" text-anchor="middle">' + esc(bottom.slice(0, 30)) + '</textPath></text></svg>';
}

// Makes sure the writing on a record's label fits inside the label: any line that is too wide for the
// label at its height is made smaller until it fits. Needs the record to be on the page, so it can be measured.
function fitLabel(box){
  const svg = box && box.querySelector("svg"); if (!svg) return;
  svg.querySelectorAll(".lab-for, .lab-name, .lab-title").forEach(t => {
    let bb; try { bb = t.getBBox(); } catch (e) { return; }
    if (!bb.width) return;
    const far = Math.max(Math.abs(bb.y - 200), Math.abs(bb.y + bb.height - 200)); // the label is a circle of radius 101 about (200, 200)
    const room = 2 * Math.sqrt(Math.max(0, 96 * 96 - far * far));
    if (room > 0 && bb.width > room){
      const now = parseFloat(getComputedStyle(t).fontSize) || 16;
      t.style.fontSize = Math.max(7, now * room / bb.width).toFixed(1) + "px";
    }
  });
}
// Draws a record's label and fits its writing. The details are kept, so it can be drawn again once the fonts have loaded.
function setRecord(box, o){ box._rec = o; box.innerHTML = recordSVG(o); fitLabel(box); }
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => $$(".record").forEach(b => { if (b._rec) setRecord(b, b._rec); }));

// Lyrics as readable lines, with the section labels set apart.
function lyricsInto(box, lyrics){
  String(lyrics || "").split(/\r?\n/).forEach(line => {
    const t = line.trim(), m = /^\[(.+)\]$/.exec(t);
    if (m) box.append(el("p", "sec", m[1])); else if (!t) box.append(el("div", "gap"));
    else { const p = el("p", "ln", t); p.dir = "auto"; box.append(p); } // right-to-left scripts read the right way round
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
