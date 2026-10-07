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

// Four short questions take the place of one blank box. They change with what the song is for: a memory, a life
// story, a couple, a newborn and a working life each ask for different things.
const STORY_QUESTIONS = [
    ["How did it begin?", "She raised three of us mostly on her own"],
    ["A moment along the way", "She ran behind my bike the whole way across the lot"],
    ["Where are things now?", "I have kids of my own and finally understand"],
    ["How do they make you feel?", "Like I could do anything"]];
const WORK_QUESTIONS = [
    ["What are they like to work with?", "She knows everyone's kids by name and never raises her voice"],
    ["A moment that shows how they work", "She stayed until midnight so the rest of us could go home"],
    ["Something they always say or do", "\"Let's find out\" whenever something breaks"],
    ["What do you want them to know?", "That the place runs on her, and we see it"]];
const QUESTIONS = {
  "A favorite memory": ["What's the memory?", [
    ["Where were you, and when?", "Grandma's porch, the summer I turned ten"],
    ["What happened?", "She taught me to play dominoes and let me win"],
    ["A detail you can still picture", "The sound of the tiles on the metal table"],
    ["Why does it stay with you?", "It was the first time I felt grown up"]]],
  "Our story": ["What's your story?", STORY_QUESTIONS],
  "Anniversary": ["What's your story?", [
    ["How did it begin?", "A blind date at a diner off the highway"],
    ["A moment along the way", "The winter the pipes froze and we slept by the stove"],
    ["Where are things now?", "Two kids, one dog, and the same Sunday coffee"],
    ["How do they make you feel?", "Like I am home wherever they are"]]],
  "Wedding": ["What should the song say?", [
    ["How did the two of them meet?", "At a friend's cookout. He burned the burgers and she stayed anyway"],
    ["When did you know they were right for each other?", "The day he drove four hours to change her flat tire"],
    ["Something about the two of them together", "They finish each other's sentences and argue over the map"],
    ["What do you wish for them?", "A long life of ordinary Tuesdays together"]]],
  "New baby": ["What should the song say?", [
    ["Who is the baby, and who are the parents?", "Nora, born to Kate and Ben in March"],
    ["What was the waiting, or the day they arrived, like?", "Two weeks late, in the middle of a thunderstorm"],
    ["What do you already love or notice about them?", "She has her grandfather's frown and holds on tight"],
    ["What do you hope for them?", "That she always knows how wanted she was"]]],
  "Graduation": ["What should the song say?", [
    ["What did they achieve, and what did it take?", "A nursing degree, working nights the whole way through"],
    ["A moment that shows who they are", "She studied in the car while her little brother had practice"],
    ["Something they always say or do", "\"One more page\""],
    ["What comes next, and what do you want them to know?", "The night shift at St. Mary's. We never doubted her"]]],
  "Retirement": ["What should the song say?", [
    ["What did they do, and for how long?", "Thirty-one years teaching fourth grade at the same school"],
    ["A moment that shows how they worked", "She stayed late every Thursday so one boy could learn to read"],
    ["Something they always say or do", "\"Sharpen your pencil and try again\""],
    ["What comes next, and what do you want them to know?", "A garden and a camper van. We were lucky to have her"]]],
  "Mother's Day": ["What should the song say?", [
    ["A memory of her from when you were small", "She sang along to the radio while she braided my hair"],
    ["Something she always says or does", "\"Call me when you get there\""],
    ["What do you understand now that you didn't then?", "How tired she must have been, and never showed it"],
    ["What do you want her to know?", "That everything good in me started with her"]]],
  "Father's Day": ["What should the song say?", [
    ["Something he taught you", "How to back a trailer down a boat ramp"],
    ["Something he always says or does", "He checks the oil before anyone leaves the driveway"],
    ["A time he showed up when it counted", "He drove all night to get me home from college"],
    ["What do you want him to know?", "That I still hear his voice when I don't know what to do"]]],
  "Valentine's Day": ["What should the song say?", [
    ["How did you meet?", "She spilled coffee on my notes in the library"],
    ["The small thing they do that you love", "He warms up my side of the car first"],
    ["A moment that was just the two of you", "Dancing in the kitchen at midnight with no music on"],
    ["What do you want them to know?", "I would choose you again, every time"]]],
  "Christmas": ["What should the song say?", [
    ["A Christmas you spent together", "The year the power went out and we cooked on the fireplace"],
    ["What do they do that shows who they are?", "She wraps a present for the mail carrier every year"],
    ["Something they always say or do", "He reads the same story out loud on Christmas Eve"],
    ["What do you wish for them in the year ahead?", "A slower year, and more time on the porch"]]],
  "Proposal": ["What should the song say?", [
    ["How did you meet?", "At a friend's wedding, both of us at the wrong table"],
    ["When did you know?", "The night she laughed so hard she had to pull the car over"],
    ["What is life with them like?", "Quiet mornings, loud dinners, and the dog between us"],
    ["How do you want to ask?", "Simply: will you marry me, with her full name"]]],
  "Congratulations": ["What should the song say?", [
    ["What did they achieve?", "She opened her own bakery on Main Street"],
    ["What did it take to get there?", "Six years of four a.m. shifts and a second job"],
    ["A moment that shows who they are", "She gave away the first loaf to the man who fixed the oven"],
    ["What do you want them to know?", "Nobody is surprised but her"]]],
  "Good luck": ["What should the song say?", [
    ["What are they about to do?", "Leave for basic training on Monday"],
    ["Why do you believe in them?", "He has never once quit something he started"],
    ["Something they always say or do", "\"One more rep\""],
    ["What should they remember when it gets hard?", "That home is right here, and we are proud already"]]],
  "An apology": ["What do you want to say?", [
    ["What happened, in your own words?", "I missed her recital for a meeting I could have moved"],
    ["What do you wish you had done?", "Been in the second row with my phone turned off"],
    ["What do they mean to you?", "She is the reason I work at all"],
    ["What do you want them to know?", "I am sorry, and I will be there next time"]]],
  "A song in their memory": ["Who are we remembering?", [
    ["Their name, and who they were to you", "My grandfather, Walt"],
    ["A memory that brings them back", "Shelling peas on his porch while the ballgame played on the radio"],
    ["Something they always said or did", "\"Leave it better than you found it\""],
    ["What would you say to them now?", "I kept the garden going"]]],
  "A song about a pet": ["Who is the pet?", [
    ["Their name, and what kind of animal they are", "Biscuit, a beagle with one white ear"],
    ["What do they do that no other pet does?", "She howls along with the fire truck every single time"],
    ["A moment with them you'll never forget", "She waited by the door the whole week I was in the hospital"],
    ["What do they mean to the person this is for?", "She is the first one he tells about his day"]]],
  "A prayer or blessing": ["What is the prayer for?", [
    ["What are you asking for, for them?", "Strength and peace through her treatment"],
    ["What is happening in their life right now?", "She starts a new job in a new city next month"],
    ["A saying or belief that matters to them", "\"This too shall pass\""],
    ["What do you want them to feel?", "That they are held, and not alone"]]],
  "Work anniversary": ["What should the song say?", WORK_QUESTIONS],
  "Boss's Day": ["What should the song say?", WORK_QUESTIONS],
  "A theme or feeling": ["What's the song about?", [
    ["The theme, in a few words", "Young love. Growing old together. Coming home."],
    ["What should it make them feel?", "Like they're seventeen again"],
    ["Pictures or moments to put in it", "A gravel road, a porch light, a first slow dance"],
    ["Why this theme, for this person?", "It's how the two of us started"]]],
  "": ["What should the song say?", [
    ["What do they do that shows who they are?", "He shows up for everyone, every time"],
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
  const said = /\s[A-Z]/.test(occ) || /^(Christmas|Easter|Hanukkah)$/.test(occ) ? occ : occ.toLowerCase();
  const title = str(o.title).trim() || (/^(a |an |our )/i.test(occ) ? occ : (/^[aeiou]/i.test(said) ? "An " : "A ") + said + " song");
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

// A signature: the strokes the sender drew, as a drawing that stays sharp at any size, cut close around the ink.
// It takes the colour of the writing around it, so it reads on a light page and a dark one.
function sigSVG(strokes){
  if (!Array.isArray(strokes) || !strokes.length) return "";
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, d = "";
  strokes.forEach(s => {
    if (!Array.isArray(s) || !s.length) return;
    s.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    if (s.length === 1){ d += "M" + s[0][0] + " " + s[0][1] + "l.1 0"; return; }
    d += "M" + s[0][0] + " " + s[0][1];
    for (let i = 1; i < s.length - 1; i++) d += "Q" + s[i][0] + " " + s[i][1] + " " + (s[i][0] + s[i + 1][0]) / 2 + " " + (s[i][1] + s[i + 1][1]) / 2;
    d += "L" + s[s.length - 1][0] + " " + s[s.length - 1][1];
  });
  if (!d) return "";
  const pad = 6;
  return '<svg class="sig" viewBox="' + (x0 - pad) + " " + (y0 - pad) + " " + (x1 - x0 + 2 * pad) + " " + (y1 - y0 + 2 * pad) + '" role="img" aria-label="Signature">' +
    '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

// A play button with a progress line, driving a real audio file. rec is the record that turns while it plays.
// intro, when given, is a short recording heard before the song: { src, label, auto, onDone }. With auto, the first
// press of play starts with it. One player plays both, one after the other, because a phone only lets a page start
// sound on the player the listener themselves pressed.
const mmss = t => Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0");
// A small celebration: a few reactions rise from an element and fade. Nothing moves for someone who has asked for less motion.
function burst(from, emojis, count){
  if (!from || !emojis || !emojis.length) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const r = from.getBoundingClientRect(), n = count || 8;
  const layer = el("div", "burst"); layer.setAttribute("aria-hidden", "true");
  for (let i = 0; i < n; i++){
    const b = el("span", "burst-bit", emojis[i % emojis.length]);
    b.style.left = (r.left + r.width * (0.15 + 0.7 * Math.random())) + "px";
    b.style.top = (r.top + r.height * (0.3 + 0.4 * Math.random())) + "px";
    b.style.setProperty("--dx", Math.round((Math.random() - 0.5) * 80) + "px");
    b.style.setProperty("--rise", Math.round(90 + Math.random() * 90) + "px");
    b.style.animationDelay = Math.round(i * 70 + Math.random() * 60) + "ms";
    b.style.fontSize = (1.3 + Math.random() * 0.9).toFixed(2) + "rem";
    layer.append(b);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2600);
}
// Reactions counted: [["heart", 2], ["laugh", 1]] in the order each first arrived.
function tapCounts(taps){
  const order = [], n = {};
  (taps || []).forEach(t => { if (!(t.emoji in n)){ n[t.emoji] = 0; order.push(t.emoji); } n[t.emoji]++; });
  return order.map(e => [e, n[e]]);
}

function mountAudio(box, src, playLabel, rec, onFirstPlay, intro){
  box.textContent = "";
  const audio = new Audio(); audio.preload = "metadata";
  let inIntro = !!(intro && intro.auto), then = "song", wanted = false, backTo = 0;
  audio.src = inIntro ? intro.src : src;
  // While the few words play, the song is fetched, so it starts without a gap.
  if (inIntro){ const warm = new Audio(); warm.preload = "auto"; warm.src = src; }
  // A round button with the play and pause symbols everyone knows. Its name is still read out to someone who cannot see it.
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 5.6v12.8a1 1 0 0 0 1.52.86l10.6-6.4a1 1 0 0 0 0-1.72L9.52 4.74A1 1 0 0 0 8 5.6z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6.2" y="5" width="4.3" height="14" rx="1.4" fill="currentColor"/><rect x="13.5" y="5" width="4.3" height="14" rx="1.4" fill="currentColor"/></svg>';
  const btn = el("button", "pbtn"); btn.type = "button";
  const face = playing => { btn.innerHTML = playing ? PAUSE : PLAY; btn.setAttribute("aria-label", playing ? "Pause" : playLabel); btn.title = playing ? "Pause" : playLabel; btn.classList.toggle("playing", playing); };
  face(false);
  const bar = el("div", "pbar"), fill = el("i"); bar.append(fill);
  const time = el("span", "ptime", "0:00");
  const wrap = el("div", "player"); wrap.append(btn, bar, time); box.append(wrap);
  let played = false;
  const total = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
  const paint = () => { const d = total(); fill.style.width = d ? (audio.currentTime / d * 100) + "%" : "0";
    time.textContent = inIntro ? intro.label : mmss(audio.currentTime) + (d ? " / " + mmss(d) : "");
    // Whoever shows the words as they are sung is told where the song is. Not during the few spoken words before it.
    if (!inIntro && typeof audio.onSongTime === "function") audio.onSongTime(audio.currentTime); };
  audio.addEventListener("loadedmetadata", paint); audio.addEventListener("timeupdate", paint);
  // While it plays, the bar and the words are kept up to date many times a second, so they move smoothly.
  let ticking = 0;
  const tick = () => { paint(); ticking = audio.paused ? 0 : requestAnimationFrame(tick); };
  audio.addEventListener("play", () => { wanted = true; face(true); if (!ticking) ticking = requestAnimationFrame(tick); if (rec) rec.classList.add("spinning"); if (!played){ played = true; if (onFirstPlay) onFirstPlay(); } });
  const stopped = () => { face(false); if (rec) rec.classList.remove("spinning"); };
  // Touch or drag the bar to move through the song.
  const seek = e => { const d = total(); if (inIntro || !d) return; const r = bar.getBoundingClientRect(); try { audio.currentTime = Math.min(d - 0.05, Math.max(0, (e.clientX - r.left) / r.width * d)); } catch (x) {} paint(); };
  bar.addEventListener("pointerdown", e => { seek(e); try { bar.setPointerCapture(e.pointerId); } catch (x) {} });
  bar.addEventListener("pointermove", e => { if (e.buttons || e.pointerType === "touch") { if (bar.hasPointerCapture && bar.hasPointerCapture(e.pointerId)) seek(e); } });
  // The few words are over (or could not be played): on to the song, or back to it ready to play.
  // heard: they played to the end. When they could not be played at all, nothing offers to play them again.
  const toSong = (play, heard) => {
    inIntro = false; audio.src = src;
    if (backTo > 0){ const at = backTo; backTo = 0; audio.addEventListener("loadedmetadata", () => { try { audio.currentTime = at; } catch (e) {} }, { once: true }); }
    stopped(); paint();
    if (heard && intro.onDone) intro.onDone();
    if (!heard) { audio.playIntro = null; if (intro.onBroken) intro.onBroken(); }
    if (play) audio.play().catch(() => {});
  };
  audio.addEventListener("pause", () => { wanted = false; stopped(); });
  audio.addEventListener("ended", () => { stopped(); if (inIntro) toSong(then === "song", true); });
  audio.addEventListener("error", () => { if (inIntro) toSong(wanted && then === "song", false); else time.textContent = "The song couldn't load. Reload the page."; });
  btn.addEventListener("click", () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
  // Hear the few words again, on their own.
  // Hear the few words again, on their own. The song is left where it was.
  if (intro) audio.playIntro = () => { if (inIntro) return; backTo = audio.currentTime || 0; audio.pause(); inIntro = true; then = "stop"; audio.src = intro.src; audio.play().catch(() => {}); };
  return audio;
}
