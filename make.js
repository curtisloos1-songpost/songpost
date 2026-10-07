(function(){
"use strict";
const CHIPS = {
  occasion: ["A favorite memory","Our story","A theme or feeling","Birthday","Anniversary","Thank you","Just because","Mother's Day","Father's Day","Valentine's Day","Christmas",
    "Wedding","Proposal","New baby","Graduation","Congratulations","Good luck","Retirement","Work anniversary","Boss's Day","Get well","Miss you","An apology",
    "A song in their memory","A song about a pet","A prayer or blessing","Another occasion"],
  tone: ["Heartfelt","Funny","Nostalgic","Grateful","Romantic","Playful","Proud","Uplifting","Tender","Bittersweet"],
  genre: ["Acoustic folk","Country","Pop","R&B","Rock","Gospel","Jazz","Hip-hop","Tejano","Lullaby"],
  voice: ["No preference","A man's voice","A woman's voice","A duet"],
  tempo: ["Let the song decide","Slow","Medium","Upbeat"],
  instruments: ["Acoustic guitar","Piano","Electric guitar","Fiddle","Steel guitar","Strings","Horns","Accordion","Organ","Harmonica","808s","Synths","Hand claps","Upright bass"],
  language: ["English","Spanish","French","German","Portuguese","Italian","Japanese"]
};
// How many of each are shown before "More". The rest are one tap away.
const SHOW = { occasion: 6, tone: 5, genre: 5, language: 7, instruments: 6 }; // every language is shown: people were missing the ones under "More"
// soundBy: who chose the tone and style ("" not yet, "suggested" from the story, "you" the customer).
// suggestNote: the line that explains the suggestion. suggestedFor: the story it was made from.
const blank = () => ({recipient:"",relationship:"",occasion:"A favorite memory",sender:"",a1:"",a2:"",a3:"",a4:"",mention:"",leaveOut:"",sayName:"",email:"",
  tone:"Heartfelt",genre:"Acoustic folk",voice:"No preference",tempo:"Let the song decide",language:"English",inspiration:"",title:"",lyrics:"",style:"",note:"",
  soundBy:"",suggestNote:"",suggestedFor:"",occasionOther:"",english:"",groupUsed:"",instruments:"",arrangement:""});
// A song about a subject (young love, growing old) rather than about the person's own story.
const THEME = "A theme or feeling";
// "Another occasion" lets the customer type any day at all. occasion() is what the song is really for.
const OTHER = "Another occasion";
const occasion = () => (draft.occasion === OTHER ? (draft.occasionOther || "").trim() || "Just because" : draft.occasion);
const DRAFT_KEY = "songpost-draft-v5", ORDER_KEY = "songpost-order-v2", MINE_KEY = "songpost-mine-v1", SONGS_KEY = "songpost-songs-v1", GROUP_KEY = "songpost-group-v1";

let draft = blank();   // what the sender has typed
let ref = null;        // { id, key } of the song being made, kept on this device
let view = null;       // the server's view of that song
let site = { priceGoldCents: 2499, pricePlatinumCents: 3999, previewSeconds: 30, takesPerOrder: 2, premium: false, testCheckout: false, messaging: false, texting: false, scheduling: false, redoDays: 7, lyricsEstimateSeconds: 20, heardChoices: [] };
// A song made together. grp is { id, key } for the invitation started on this device; grpView is the server's
// view of it: who has added their memories so far. shownFrom is who a finished song is signed from.
let grp = null, grpView = null, groupTimer = null, shownFrom = "";
const others = () => (grpView ? grpView.parts.filter(p => p.answers && p.answers.length) : []);
// Once lyrics are written, the song is signed from the people whose memories those lyrics hold.
const usedIds = () => (draft.groupUsed ? draft.groupUsed.split(",") : []);
const signers = () => (draft.lyrics.trim() ? others().filter(p => usedIds().indexOf(String(p.id)) >= 0) : others());
const signedFrom = () => shownFrom || (signers().length ? fromLine([draft.sender.trim() || "you"].concat(signers().map(p => p.name))) : draft.sender);
// A mobile number is only taken while texts can be sent, or while nothing is being sent at all.
const emailOnly = () => site.messaging && !site.texting;
const contactOk = v => { const k = contactKind(v); return k === "email" || (k === "phone" && !emailOnly()); };
let step = -1, tier = "song", pollTimer = null, doneTimer = null, heardTimer = null, busy = false, previewSrc = "";
// Today's date where the customer is, as YYYY-MM-DD.
const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

const calmMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
const load = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
const save = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
let saveTimer = null;
function saveDraft(){ clearTimeout(saveTimer); saveTimer = setTimeout(() => save(DRAFT_KEY, draft), 400); }
const call = (path, opts) => api(path, Object.assign({ key: ref && ref.key }, opts || {}));
// The six moments we count, to see where visitors drop off.
const tracked = {};
function track(kind){
  if (tracked[kind]) return; tracked[kind] = true;
  try { if (sessionStorage.getItem("sp-" + kind)) return; sessionStorage.setItem("sp-" + kind, "1"); } catch (e) {}
  api("/api/track", { method: "POST", body: { kind } }).catch(() => {});
}

function updateRecord(){
  const mine = Object.assign({}, draft, { occasion: occasion(), sender: signedFrom() });
  if (step !== -1){ setRecord($("#make-record"), mine); return; }
  // On the opening page there are two records, one for each kind of song: about them, or about a theme or a feeling.
  const both = { lead: "a song about", sender: "", genre: "", nameSize: 40 };
  setRecord($("#make-record"), Object.assign({}, both, { recipient: "them", title: "their story", aria: "A song about them: their story." }));
  setRecord($("#theme-record"), Object.assign({}, both, { recipient: "a theme", title: "or a feeling", aria: "A song about a theme or a feeling." }));
}

/* ---------- choices ---------- */
// Style and tone can each be one choice or a blend of two, stored as "Country and Pop".
const BLENDS = { genre: true, tone: true };
// Choices where none, one or several can be picked, up to a limit, stored as "Piano, Fiddle".
const MANY = { instruments: 3 };
function listOf(field){ return String(draft[field] || "").split(MANY[field] ? "," : " and ").map(s => s.trim()).filter(Boolean); }
const SHAPE_WORD = { heart: "a heart", star: "a star", sun: "a sun", burst: "a burst" };
function paintChips(){
  $("#shape-note").textContent = "On their page, " + SHAPE_WORD[shapeFor(draft.tone)] + " opens around the record when the song starts.";
  $$(".chips[data-field]").forEach(box => {
    const field = box.dataset.field, sel = BLENDS[field] || MANY[field] ? listOf(field) : [draft[field]];
    $$(".chip:not(.more)", box).forEach(b => b.setAttribute("aria-pressed", String(sel.indexOf(b.textContent) >= 0)));
    // a choice that lives under "More" opens the list, so it is never hidden while selected
    if (box.classList.contains("collapsed") && $$(".chip.extra", box).some(b => sel.indexOf(b.textContent) >= 0)){
      box.classList.remove("collapsed"); const m = $(".chip.more", box); if (m) m.remove();
    }
  });
}
function pickChip(field, opt){
  if (MANY[field]){
    let sel = listOf(field);
    if (sel.indexOf(opt) >= 0) sel = sel.filter(x => x !== opt); else { sel.push(opt); if (sel.length > MANY[field]) sel.shift(); }
    draft[field] = sel.join(", ");
  } else if (BLENDS[field]){
    let sel = listOf(field);
    if (sel.indexOf(opt) >= 0){ if (sel.length > 1) sel = sel.filter(x => x !== opt); }
    else { sel.push(opt); if (sel.length > 2) sel.shift(); }
    draft[field] = sel.join(" and ");
  } else draft[field] = opt;
  if (field === "tone" || field === "genre" || field === "tempo") draft.soundBy = "you"; // their choice now stands; a new suggestion won't replace it
  paintChips(); saveDraft(); updateRecord();
  if (field === "occasion") applyOccasion();
}
function questions(){ return questionsFor(draft.occasion); }
function applyOccasion(){
  $("#occasion-other").hidden = draft.occasion !== OTHER;
  $("#theme-note").hidden = draft.occasion !== THEME;
  $("#mention-field").hidden = draft.occasion === THEME; // a theme song already asks for the pictures to put in it
  if (draft.occasion !== OTHER) $("#occ-fix").hidden = true;
  const q = questions();
  $("#details-h").textContent = q[0];
  q[1].forEach((pair, i) => {
    $("#q" + (i + 1) + "-label").textContent = pair[0];
    $('[data-bind="a' + (i + 1) + '"]').placeholder = pair[1];
  });
}
function storyParts(){
  return questions()[1].map((pair, i) => [pair[0], String(draft["a" + (i + 1)] || "").trim()]).filter(p => p[1]);
}
function buildChips(){
  $$(".chips[data-field]").forEach(box => {
    const field = box.dataset.field, limit = SHOW[field] || 99;
    CHIPS[field].forEach((opt, i) => {
      const b = el("button", "chip" + (i >= limit ? " extra" : ""), opt); b.type = "button";
      b.addEventListener("click", () => pickChip(field, opt));
      box.append(b);
    });
    if (CHIPS[field].length > limit){
      box.classList.add("collapsed");
      const more = el("button", "chip more", "More"); more.type = "button";
      more.addEventListener("click", () => { box.classList.remove("collapsed"); more.remove(); });
      box.append(more);
    }
  });
}
function syncInputs(){
  $$("[data-bind]").forEach(e => { e.value = draft[e.dataset.bind] || ""; });
  $("#suggest-note").textContent = draft.suggestNote || "";
  // for a song in another language: what it says in English, so the sender can check it
  const eng = $("#english-lines"); eng.textContent = ""; $("#english-box").hidden = !draft.english;
  if (draft.english) lyricsInto(eng, draft.english);
  paintChips(); applyOccasion(); updateRecord();
}
$$("[data-bind]").forEach(e => e.addEventListener("input", () => {
  draft[e.dataset.bind] = e.value; saveDraft();
  const st = e.closest(".step"); if (st) $$(".err", st).forEach(er => { er.textContent = ""; }); // a fixed field clears its warning
  if (e.dataset.bind === "email") $("#contact-box").classList.remove("needs");
  if (e.dataset.bind === "occasionOther") $("#occ-fix").hidden = true; // a correction on offer no longer fits what is typed
  if (["recipient","sender","title","occasionOther"].indexOf(e.dataset.bind) >= 0) updateRecord();
}));

/* ---------- hearing a name, and speaking an answer ---------- */
// "Hear it said": the device reads the name aloud, from the sounds-like spelling when one was given.
// It is the phone's or computer's own voice, so it checks the spelling, not the singer.
if ("speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function"){
  $("#hear-row").hidden = false;
  $("#hear-btn").addEventListener("click", () => {
    const text = (draft.sayName || draft.recipient || "").trim();
    const st = $("#hear-btn").closest(".step"), err = st && $(".err", st);
    if (!text){ if (err) err.textContent = "Type their name first, then tap Hear it said."; return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text); u.rate = 0.85; u.lang = "en-US";
      speechSynthesis.speak(u);
    } catch (e) { if (err) err.textContent = "This device couldn't say it aloud."; }
  });
}
// "Speak your answer": where the browser can turn speech into text, each story question gets a button for it.
// Where it can't, the keyboard's own microphone still works, and the tip above the questions says so.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let stopListening = () => {}; // called when the customer moves to another step
if (typeof Recognition === "function"){
  $("#speak-tip").textContent = "You can type, or tap Speak your answer.";
  let active = null; // { rec, btn } while listening
  const stop = () => { if (!active) return; const a = active; active = null; a.btn.textContent = "Speak your answer"; a.btn.setAttribute("aria-pressed", "false"); try { a.rec.stop(); } catch (e) {} };
  stopListening = stop;
  $$('textarea[data-bind^="a"]').forEach(area => {
    const label = area.closest(".field"); label.classList.add("has-after");
    const row = el("div", "after-field"), btn = el("button", "btn small ico ico-mic", "Speak your answer"), said = el("span", "hint");
    btn.type = "button"; btn.setAttribute("aria-pressed", "false"); said.setAttribute("role", "status");
    row.append(btn, said); label.after(row);
    btn.addEventListener("click", () => {
      if (active && active.btn === btn){ stop(); return; }
      stop(); said.textContent = "";
      let rec;
      try {
        rec = new Recognition(); rec.lang = navigator.language || "en-US"; rec.interimResults = false; rec.continuous = false;
        rec.onresult = ev => {
          let text = ""; for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) text += ev.results[i][0].transcript;
          text = text.trim(); if (!text) return;
          const max = area.maxLength > 0 ? area.maxLength : 600;
          area.value = (area.value.trim() ? area.value.trim() + " " : "") + text.charAt(0).toUpperCase() + text.slice(1);
          if (area.value.length > max) area.value = area.value.slice(0, max);
          area.dispatchEvent(new Event("input", { bubbles: true })); // saves it, just as typing would
        };
        rec.onerror = ev => { said.textContent = ev && ev.error === "no-speech" ? "Didn't catch that. Tap and try again." : "Speaking isn't available here. Use the microphone on your keyboard instead."; };
        rec.onend = () => { if (active && active.rec === rec) stop(); };
        rec.start();
      } catch (e) { said.textContent = "Speaking isn't available here. Use the microphone on your keyboard instead."; return; }
      active = { rec, btn }; btn.textContent = "Listening. Tap to stop"; btn.setAttribute("aria-pressed", "true");
    });
  });
}

/* ---------- moving through the steps ---------- */
function go(n){
  if (n !== 4) stopProgress();
  stopListening();
  if (n !== 5){ clearInterval(doneTimer); clearInterval(heardTimer); }
  const was = step; step = n;
  if ((was === -1) !== (n === -1)) updateRecord(); // the opening page shows the two kinds of song; the steps show this one
  $("#view-make").dataset.step = String(n);
  $$(".step").forEach(s => { s.hidden = Number(s.dataset.step) !== n; });
  $("#restart-confirm").hidden = true;
  $("#hero").hidden = n !== -1;
  $("#form-sheet").hidden = n === -1;
  $("#progress").hidden = n > 4;
  $("#step-label").textContent = "Step " + (Math.max(n, 0) + 1) + " of 5";
  $("#bar-fill").style.width = ((Math.max(n, 0) + 1) * 20) + "%";
  $$(".err").forEach(e => { e.textContent = ""; });
  $("#tg-err").textContent = "";
  $("#contact-box").classList.remove("needs");
  if (n === 2) $("#keep-btn").hidden = !draft.lyrics.trim();
  if (n === 3) $("#record-btn").textContent = ref ? "Record with these lyrics" : "Record my song";
  if (n !== 4){ if (previewAudio) previewAudio.pause(); $("#make-record").classList.remove("spinning"); }
  if (n > 0) $("#progress").scrollIntoView({ block: "start" }); else window.scrollTo(0, 0);
  // While the story and lyrics steps are open, keep looking for what the others have added.
  clearInterval(groupTimer);
  if (grp && n >= 1 && n <= 3){ renderTogether(); groupTimer = setInterval(syncGroup, 20000); }
}
function validate(n){
  if (n === 0){
    if (!draft.recipient.trim()) return "Add their name so the song can use it.";
    if (draft.occasion === OTHER && !(draft.occasionOther || "").trim()) return "Type the occasion, or pick one from the list.";
    if (!draft.sender.trim()) return "Add your name so they know who it's from.";
  }
  // a theme can be said in two words; a story needs a sentence
  if (n === 1 && others().length) return ""; // others have added their memories, so the organizer's own are optional
  if (n === 1 && draft.occasion === THEME && storyParts().map(p => p[1]).join(" ").length < 8) return "Tell us the theme, in a few words.";
  if (n === 1 && draft.occasion !== THEME && storyParts().map(p => p[1]).join(" ").length < 20) return "Answer at least one question, in a sentence or two.";
  return "";
}
$$("[data-next]").forEach(b => b.addEventListener("click", async () => {
  const msg = validate(step);
  if (msg){ $(".err", b.closest(".step")).textContent = msg; return; }
  if (step === 0 && draft.occasion === OTHER){ // an occasion they typed: check its spelling before moving on
    if (busy) return; busy = true; b.disabled = true;
    const label = b.textContent; b.textContent = "Checking the spelling…";
    const fine = await occasionSpelling();
    b.textContent = label; b.disabled = false; busy = false;
    if (!fine) return;
  }
  go(step + 1);
}));

/* ---------- the spelling of an occasion the customer typed ---------- */
// It is printed on the record and the gift page. Capital letters are put right for them; a spelling
// correction is only offered, and the customer chooses. If the check can't be done, they simply carry on.
let occChecked = ""; // the text that has been checked, or that they chose to keep
async function occasionSpelling(){
  const typed = (draft.occasionOther || "").trim();
  if (!typed || typed === occChecked) return true;
  let out = null;
  try { out = await Promise.race([api("/api/spell", { method: "POST", body: { text: typed } }), new Promise(r => setTimeout(() => r(null), 9000))]); } catch (e) {}
  if ((draft.occasionOther || "").trim() !== typed) return false; // they changed it while we were checking
  const better = out && typeof out.text === "string" ? out.text.trim() : "";
  if (!better || better === typed){ occChecked = typed; return true; }
  if (better.toLowerCase() === typed.toLowerCase()){ setOccasion(better); return true; } // only the capital letters differ
  $("#occ-better").textContent = better; $("#occ-fix").hidden = false;
  $("#occ-use").onclick = () => { setOccasion(better); go(1); };
  $("#occ-keep").onclick = () => { occChecked = typed; $("#occ-fix").hidden = true; go(1); };
  return false;
}
function setOccasion(text){
  draft.occasionOther = text; occChecked = text; saveDraft();
  $('[data-bind="occasionOther"]').value = text; $("#occ-fix").hidden = true; updateRecord();
}
$$("[data-back]").forEach(b => b.addEventListener("click", () => go(step - 1)));

/* ---------- a suggested sound ---------- */
// After the story, Claude suggests the tone and style that fit it. They arrive already selected on the next
// step, where the customer can change them. No suggestion (a slow or failed request) just leaves the usual defaults.
async function suggestSound(){
  const story = JSON.stringify([draft.recipient, draft.relationship, occasion(), storyParts(), others().map(p => p.id), mention()]);
  if (draft.soundBy === "you" || story === draft.suggestedFor) return;
  let out = null;
  try { out = await Promise.race([api("/api/suggest", { method: "POST", body: { brief: brief() } }), new Promise(r => setTimeout(() => r(null), 9000))]); } catch (e) {}
  if (!out || !out.tone || !out.genre || draft.soundBy === "you") return;
  draft.tone = out.tone; draft.genre = out.genre; draft.soundBy = "suggested"; draft.suggestedFor = story;
  if (out.tempo && CHIPS.tempo.indexOf(out.tempo) >= 0) draft.tempo = out.tempo;
  draft.suggestNote = "Suggested for your " + (draft.occasion === THEME ? "theme" : "story") + ": " + out.tone + ", " + out.genre + (out.tempo ? ", " + out.tempo.toLowerCase() + " tempo" : "") + ". "
    + (out.why ? out.why + " " : "") + "Change anything you like.";
  $("#suggest-note").textContent = draft.suggestNote;
  saveDraft(); paintChips(); updateRecord();
}
// The small true details, and what to keep out. Neither is one of the four answers: they are not shown on the gift page.
const mention = () => (draft.occasion === THEME ? "" : String(draft.mention || "").trim());
const leaveOut = () => String(draft.leaveOut || "").trim();
// A story of one short answer makes a song of general feelings. Said once, gently; the customer can carry on as they are.
let nudged = false;
const thinStory = () => draft.occasion !== THEME && !others().length && storyParts().length < 2
  && (storyParts().map(p => p[1]).join(" ") + " " + mention()).trim().length < 90;
$("#story-next").addEventListener("click", async e => {
  const b = e.currentTarget, msg = validate(1), nudge = $("#story-nudge");
  if (msg){ $(".err", b.closest(".step")).textContent = msg; return; }
  if (thinStory() && !nudged){
    nudged = true; nudge.hidden = false; b.textContent = "Continue as it is";
    nudge.textContent = "One more detail makes this song theirs. Answer another question, or add a place, a name or something they always say. The song can only use what you tell us.";
    return;
  }
  nudge.hidden = true;
  if (busy) return; busy = true; b.disabled = true;
  b.textContent = "Reading your story\u2026";
  await syncGroup();
  await suggestSound();
  b.textContent = "Continue"; b.disabled = false; busy = false;
  go(2);
});
$("#back-from-lyrics").addEventListener("click", () => go(ref ? 4 : 2));
$("#keep-btn").addEventListener("click", () => go(3));
// Two ways in from the opening page: a song about the person (their story, a memory, an occasion), or one about a theme or feeling.
const hasStory = () => storyParts().length > 0;
$("#begin-btn").addEventListener("click", () => {
  if (draft.occasion === THEME && !hasStory()){ draft.occasion = "A favorite memory"; saveDraft(); syncInputs(); } // they looked at a theme song, then chose this instead
  track("started"); go(0);
});
// The two records on the opening page do the same as the two buttons.
$("#theme-record").closest(".rec-stage").prepend($("#pick-person .rings").cloneNode(true));
$("#pick-person").addEventListener("click", () => { if (step === -1) $("#begin-btn").click(); });
$("#pick-theme").addEventListener("click", () => { if (step === -1) $("#theme-btn").click(); });
$("#theme-btn").addEventListener("click", () => {
  if (draft.occasion !== THEME){ draft.occasion = THEME; saveDraft(); syncInputs(); }
  track("started"); go(0);
});

/* ---------- progress bars ---------- */
let progTimer = null, progBox = null;
function leftText(rem, over, verb){
  if (over) return "Taking a little longer than usual. Still " + verb + ".";
  if (rem >= 90) return "About " + Math.round(rem / 60) + " minutes left";
  if (rem >= 45) return "About a minute left";
  if (rem >= 3) return "About " + Math.max(5, Math.round(rem / 5) * 5) + " seconds left";
  return "Almost done";
}
// Neither service reports live progress, so each bar runs on the usual time.
function startProgress(estimate, elapsed, box, verb){
  stopProgress();
  progBox = box || $("#listen-wait .rec-progress"); verb = verb || "recording";
  const est = Math.max(3, Number(estimate) || 75), t0 = Date.now() - (Number(elapsed) || 0) * 1000;
  const fill = $(".rp-bar i", progBox), text = $(".rp-text", progBox);
  progBox.hidden = false;
  const tick = () => {
    const t = (Date.now() - t0) / 1000, over = t > est;
    const p = over ? 0.92 + 0.06 * (1 - Math.exp(-(t - est) / est)) : 0.92 * t / est;
    fill.style.width = (p * 100).toFixed(1) + "%";
    const msg = (verb === "writing" && !over ? "Writing the lyrics. " : "") + leftText(est - t, over, verb);
    if (text.textContent !== msg) text.textContent = msg;
  };
  tick(); progTimer = setInterval(tick, 500);
}
function stopProgress(){
  clearInterval(progTimer); progTimer = null;
  if (progBox && progBox.dataset.temp) progBox.hidden = true;
  progBox = null;
}

/* ---------- lyrics ---------- */
const brief = () => ({ recipient: draft.recipient, sender: draft.sender, relationship: draft.relationship, occasion: occasion(),
  tone: draft.tone, genre: draft.genre, voice: draft.voice, tempo: draft.tempo, language: draft.language, sayName: draft.sayName, inspiration: draft.inspiration, instruments: draft.instruments,
  contact: draft.email, answers: storyParts().map(p => ({ q: p[0], a: p[1] })), mention: mention(), avoid: leaveOut(), group: grp ? { id: grp.id, key: grp.key } : undefined });
// The same, for recording: only the people whose memories the lyrics in hand were written from are signed on the song.
const recordBrief = () => { const b = brief(); if (b.group) b.group.used = usedIds().map(Number); return b; };
async function writeLyrics(again){
  if (busy) return; busy = true;
  await syncGroup();
  const btn = again ? $("#again-btn") : $("#write-btn");
  const err = again ? $("#record-err") : $("#write-err");
  err.textContent = ""; btn.disabled = true; $("#keep-btn").hidden = true;
  startProgress(site.lyricsEstimateSeconds || 20, 0, again ? $("#again-progress") : $("#write-progress"), "writing");
  $("#make-record").classList.add("spinning");
  let ok = false;
  try {
    const out = await api("/api/lyrics", { method: "POST", body: { brief: brief(), again: again ? draft.title : undefined } });
    draft.title = out.title; draft.lyrics = out.lyrics; draft.style = out.style; draft.arrangement = out.arrangement || ""; draft.english = out.english || "";
    draft.groupUsed = (out.usedParts || []).join(","); // whose memories these lyrics were written from
    saveDraft(); syncInputs(); renderTogether(); track("lyrics"); ok = true;
  } catch (e) { err.textContent = e.message; }
  busy = false; btn.disabled = false;
  if (step !== 4) stopProgress();
  $("#make-record").classList.remove("spinning");
  if (ok && !again) go(3); else if (!again) $("#keep-btn").hidden = !draft.lyrics.trim();
}
$("#write-btn").addEventListener("click", () => writeLyrics(false));
$("#again-btn").addEventListener("click", () => writeLyrics(true));

/* ---------- recording and the preview ---------- */
$("#record-btn").addEventListener("click", async () => {
  if (busy) return;
  const err = $("#record-err"), btn = $("#record-btn");
  if (draft.lyrics.trim().length < 40){ err.textContent = "The song needs lyrics before it can be recorded."; return; }
  if (!contactOk(draft.email)){
    // Say so right at the field, and take them to it, so it can't be missed.
    const box = $("#contact-box"), field = $('[data-bind="email"]', box);
    err.textContent = "";
    $("#contact-err").textContent = emailOnly()
      ? (draft.email.trim() ? "That doesn't look like an email address. Check it and try again." : "Add your email address so we can send you the link to your song.")
      : draft.email.trim() ? "That doesn't look like an email or a mobile number. Check it and try again." : "Add your email or mobile number so we can send you the link to your song.";
    box.classList.add("needs");
    box.scrollIntoView({ block: "center", behavior: "smooth" });
    field.focus({ preventScroll: true });
    return;
  }
  busy = true; btn.disabled = true; err.textContent = ""; $("#contact-err").textContent = ""; $("#contact-box").classList.remove("needs");
  $("#again-status").textContent = "Checking the words, then starting the recording.";
  try {
    if (!ref){
      const src = readSource();
      ref = await api("/api/orders", { method: "POST", body: { brief: recordBrief(), title: draft.title, lyrics: draft.lyrics, style: draft.style, arrangement: draft.arrangement,
        source: { from: src.from, join: src.join, ref: src.ref, heard: src.heard } } });
      save(ORDER_KEY, ref);
      view = await call("/api/orders/" + ref.id);
      syncGroup(); // recording closes the invitation
    } else {
      view = await call("/api/orders/" + ref.id + "/retake", { method: "POST", body: { title: draft.title, lyrics: draft.lyrics, style: draft.style, arrangement: draft.arrangement } });
    }
    go(4); renderListen(); poll();
  } catch (e) { err.textContent = e.message; }
  $("#again-status").textContent = "";
  busy = false; btn.disabled = false;
});
function poll(){
  clearInterval(pollTimer);
  if (!view || view.status !== "generating") return;
  pollTimer = setInterval(async () => {
    try { view = await call("/api/orders/" + ref.id); } catch (e) { return; }
    if (view.status !== "generating"){ clearInterval(pollTimer); if (step === 4) renderListen(); }
  }, 4000);
}
let previewAudio = null;
function renderListen(){
  const rec = $("#make-record"), st = view.status, name = view.recipient || "their";
  $("#listen-wait").hidden = st !== "generating";
  $("#listen-fail").hidden = st !== "failed";
  $("#listen-ready").hidden = st !== "ready";
  rec.classList.toggle("spinning", st === "generating");
  if (st === "generating"){ $("#listen-h").textContent = "Recording your song"; if (previewAudio) previewAudio.pause(); startProgress(view.estimateSeconds, view.elapsedSeconds); return; }
  stopProgress();
  if (st === "failed"){
    $("#listen-h").textContent = "The recording didn't finish";
    $("#listen-fail-msg").textContent = view.error || "Something went wrong while recording.";
    return;
  }
  $("#listen-h").textContent = "Have a listen";
  const take = view.takes[view.chosen] || {}, pv = take.previewSection;
  $("#listen-lede").textContent = pv && pv.hasName
    ? "Here are " + view.previewSeconds + " seconds from the part where " + name + "'s name is sung."
    : pv ? "Here are " + view.previewSeconds + " seconds of " + name + "'s song, starting at the " + String(pv.name).toLowerCase() + "."
    : "Here are the first " + view.previewSeconds + " seconds of " + name + "'s song.";
  const hearing = $("#hearing"); hearing.textContent = ""; hearing.hidden = !pv;
  if (pv){
    hearing.append(el("p", "h-sec", "You're hearing the " + String(pv.name).toLowerCase()));
    pv.lines.forEach(l => hearing.append(el("p", "h-line", l)));
    if (view.sayName) hearing.append(el("p", "h-say", "Their name is sung the way you spelled it: " + view.sayName));
  }
  const chips = $("#take-chips");
  chips.hidden = view.takes.length < 2; chips.textContent = "";
  view.takes.forEach(t => {
    const b = el("button", "chip", "Take " + (t.n + 1)); b.type = "button";
    b.setAttribute("aria-pressed", String(t.n === view.chosen));
    b.addEventListener("click", async () => {
      if (t.n === view.chosen) return;
      try { view = await call("/api/orders/" + ref.id + "/choose", { method: "POST", body: { take: t.n } }); renderListen(); }
      catch (e) { $("#pay-err").textContent = e.message; }
    });
    chips.append(b);
  });
  const src = "/api/orders/" + view.id + "/preview/" + view.chosen;
  if (src !== previewSrc){ if (previewAudio) previewAudio.pause(); previewSrc = src; previewAudio = mountAudio($("#preview-player"), src, "Play the preview", rec, () => track("preview")); }
  draft.title = view.title; draft.lyrics = view.lyrics; draft.style = view.style || draft.style;
  if (typeof view.arrangement === "string") draft.arrangement = view.arrangement;
  saveDraft();
  $$('[data-bind="title"],[data-bind="lyrics"],[data-bind="style"],[data-bind="arrangement"]').forEach(e => { e.value = draft[e.dataset.bind]; });
  const left = view.takesLeft;
  $("#retake-btn").hidden = left <= 0; $("#edit-lyrics-btn").hidden = left <= 0;
  $("#take-note").textContent = view.error ? view.error : left <= 0 ? "You've used all your takes for this song." : "";
  $("#email-note").textContent = site.messaging && view.contactKind
    ? "We've " + (view.contactKind === "phone" ? "texted" : "emailed") + " you a link to this song, so you can come back to it." : "";
  $("#test-note").hidden = !site.testCheckout;
  paintTier();
}
const TIER = { song: ["Gold", "gold", "priceGoldCents"], keepsake: ["Platinum", "platinum", "pricePlatinumCents"] };
function paintTier(){
  $$(".tier").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.tier === tier));
    $(".t-top", b).lastElementChild.textContent = money(site[TIER[b.dataset.tier][2]]);
  });
  // What Platinum adds. The recording on the premium model is only promised while there is one to give.
  $("#plat-sub").textContent = "Everything in Gold, plus " + (site.premium ? "a second recording on our premium studio model, " : "")
    + "your photo on their page, a lyric sheet designed to print and frame, and " + (site.premium ? "every take for you to choose from." : "a second take to choose between.");
  $("#pay-btn").textContent = "Unlock the " + TIER[tier][0] + " record for " + money(site[TIER[tier][2]]);
  $("#make-record").dataset.metal = TIER[tier][1]; // the record turns the metal they choose
}
$$(".tier").forEach(b => b.addEventListener("click", () => { tier = b.dataset.tier; paintTier(); }));
async function retake(){
  if (busy) return; busy = true;
  try { view = await call("/api/orders/" + ref.id + "/retake", { method: "POST", body: {} }); renderListen(); poll(); }
  catch (e) { (view.status === "failed" ? $("#listen-fail-msg") : $("#pay-err")).textContent = e.message; }
  busy = false;
}
$("#retake-btn").addEventListener("click", retake);
$("#retry-btn").addEventListener("click", retake);
$("#edit-lyrics-btn").addEventListener("click", () => go(3));
$("#fail-edit").addEventListener("click", () => go(3));

/* ---------- paying ---------- */
$("#pay-btn").addEventListener("click", async () => {
  if (busy) return; busy = true;
  const btn = $("#pay-btn"), err = $("#pay-err");
  btn.disabled = true; err.textContent = ""; track("clickpay");
  try {
    const out = await call("/api/orders/" + ref.id + "/checkout", { method: "POST", body: { note: draft.note, tier: TIER[tier][1] } });
    window.location.href = out.url; return;
  } catch (e) { err.textContent = e.message; }
  busy = false; btn.disabled = false;
});

/* ---------- starting over ---------- */
function startOver(full){
  clearInterval(pollTimer); clearInterval(doneTimer); if (previewAudio) previewAudio.pause();
  ref = null; view = null; tier = "song"; previewSrc = ""; previewAudio = null; save(ORDER_KEY, null);
  clearGroup();
  $("#preview-player").textContent = ""; $("#make-record").dataset.metal = "gold";
  const sender = draft.sender, email = draft.email; draft = blank();
  if (!full){ draft.sender = sender; draft.email = email; } // "make another song" keeps who you are; "start over" clears it all
  save(DRAFT_KEY, draft); syncInputs();
  history.replaceState(null, "", "/");
  go(0);
}
$("#start-over").addEventListener("click", () => startOver(false));
$("#make-another").addEventListener("click", () => startOver(false));
$("#restart-btn").addEventListener("click", () => { $("#restart-confirm").hidden = false; });
$("#restart-no").addEventListener("click", () => { $("#restart-confirm").hidden = true; });
$("#restart-yes").addEventListener("click", () => startOver(true));

/* ---------- ready to send ---------- */
function setHow(how){
  $$("#send-how .chip").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.how === how)));
  $("#send-self").hidden = how !== "self"; $("#send-date").hidden = how !== "date";
}
$$("#send-how .chip").forEach(b => b.addEventListener("click", () => setHow(b.dataset.how)));
function showDone(info){
  clearInterval(pollTimer); if (previewAudio) previewAudio.pause();
  const name = info.recipient || "them", url = info.giftUrl;
  const msg = (info.recipient ? info.recipient + ", " : "") + (info.together ? "we" : "I") + " had a song written for you. Open it here: " + url;
  // A song made together is signed from everyone; the organizer's own name stays theirs for the next song.
  shownFrom = info.together ? info.sender || "" : "";
  draft.recipient = info.recipient || draft.recipient; if (!info.together) draft.sender = info.sender || draft.sender; draft.title = info.title || draft.title;
  $("#tg-done").textContent = info.together ? "Everyone who added their memories can hear it too, on the page where they added them, on the same phone or computer they used. They'll also see what " + name + " writes back." : "";
  updateRecord(); $("#make-record").dataset.metal = info.tier === "platinum" ? "platinum" : "gold";
  const plate = $("#done-plate"); plate.dataset.metal = info.tier === "platinum" ? "platinum" : "gold";
  $("#done-p1").textContent = "Presented to " + name;
  $("#done-p2").textContent = longDate(info.paidAt || Date.now());
  $("#done-p").textContent = "Send " + name + " this link. It opens an envelope with their name on it, and inside are the song, your note, and the lyrics.";
  $("#gift-link").value = url;
  $("#sms-link").href = "sms:?&body=" + encodeURIComponent(msg);
  $("#wa-link").href = "https://wa.me/?text=" + encodeURIComponent(msg); // opens WhatsApp with the message ready, to send to anyone
  $("#qr-link").href = "/g/" + encodeURIComponent(info.id) + "/qr"; // a card to print, with a QR code that opens the song
  $("#x-link").href = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(msg);         // a public post on X, with the message ready
  $("#fb-link").href = "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(url); // a public post on Facebook, with the link
  $("#mail-link").href = "mailto:?subject=" + encodeURIComponent((info.together ? "We" : "I") + " had a song written for you") + "&body=" + encodeURIComponent(msg);
  const share = $("#share-btn"); share.hidden = !navigator.share;
  share.onclick = () => navigator.share({ text: msg }).catch(() => {});
  $("#copy-link").onclick = async e => {
    const b = e.currentTarget;
    try { await navigator.clipboard.writeText(url); b.textContent = "Copied"; }
    catch (x) { $("#gift-link").select(); b.textContent = "Select and copy"; }
    setTimeout(() => { b.textContent = "Copy link"; }, 1800);
  };
  const see = $("#see-gift"); see.href = url + "?sender=1"; see.textContent = "See " + name + "'s page";
  // Remember on this device that the song is ours, so opening the plain link here isn't taken for their first play either.
  if (info.id){ const mine = (load(MINE_KEY) || []).filter(x => x !== info.id); mine.push(info.id); save(MINE_KEY, mine.slice(-50)); }
  // Keep the way back to this song on this device, so it can be reopened from the opening page.
  if (ref && ref.id === info.id){
    const songs = (load(SONGS_KEY) || []).filter(s => s && s.id !== info.id);
    songs.push({ id: ref.id, key: ref.key, recipient: info.recipient || "", title: info.title || "" }); save(SONGS_KEY, songs.slice(-30));
  }
  $("#order-ref").textContent = info.id ? "Order reference: " + info.id + ". Quote it if you ever need help with this song." : "";
  $("#played-note").textContent = site.messaging && info.contactKind
    ? "We'll " + (info.contactKind === "phone" ? "text" : "email") + " you the moment " + name + " plays it." : "";
  // Scheduling needs this device's key to the song, and a message service that can really send it.
  const canSchedule = !!(ref && ref.id === info.id) && site.scheduling;
  $('#send-how [data-how="date"]').hidden = !canSchedule;
  $("#to-date").min = localToday();
  if (info.schedule && info.schedule.date){ $("#to-date").value = info.schedule.date; $("#to-email").value = info.schedule.to || ""; }
  $("#schedule-err").textContent = "";
  $("#schedule-note").textContent = info.schedule && info.schedule.date ? scheduledText(info.schedule) : "";
  setHow(info.schedule && info.schedule.date && canSchedule ? "date" : "self");
  save(DRAFT_KEY, Object.assign(blank(), { sender: draft.sender, email: draft.email }));
  go(5);
  renderExtras();
  renderHeard();
  renderAsk();
  renderRemind();
  clearInterval(heardTimer);
  heardTimer = setInterval(async () => { // look again every half minute for a first play or a reply
    if (step !== 5 || !ref){ clearInterval(heardTimer); return; }
    if (view && view.status === "generating") return;
    try { view = await call("/api/orders/" + ref.id); renderHeard(); } catch (e) {}
  }, 30000);
}

/* ---------- what happened on their page: the first play, and anything they wrote back ---------- */
function renderHeard(){
  const box = $("#heard-box"), note = $("#heard-note"), list = $("#replies"), tapBox = $("#heard-taps");
  const mine = !!(ref && view && view.id === ref.id && view.paid);
  box.hidden = !mine; if (!mine) return;
  const name = view.recipient || "They", replies = view.replies || [], taps = view.taps || [], vids = view.reactions || [];
  const any = !!view.firstPlayedAt || replies.length || taps.length || vids.length;
  // Once something has come back, it leads the page: it is what the sender came to see.
  box.classList.toggle("love", !!any);
  const home = any ? $("#done-plate").parentElement : $("#heard-q");
  if (any){ if (box.previousElementSibling !== home) home.after(box); } else if (box.nextElementSibling !== home) home.before(box);
  $("#done-h").textContent = replies.length ? name + " wrote back." : vids.length ? name + " sent you a video." : taps.length ? name + " sent you " + tapCounts(taps).map(t => t[0]).slice(0, 3).join(" ") : any ? name + " played it." : "It's ready to send.";
  note.textContent = view.firstPlayedAt ? "First played " + longDate(view.firstPlayedAt)
    : any ? "" : name + " hasn't played it yet. This page shows when they do, and anything they send back.";
  const tsig = taps.length;
  if (tapBox.dataset.sig !== String(tsig)){
    tapBox.dataset.sig = String(tsig); tapBox.textContent = ""; tapBox.hidden = !taps.length;
    tapCounts(taps).forEach(t => { const c = el("span", "love-tap", t[0]); if (t[1] > 1) c.append(el("b", null, String(t[1]))); tapBox.append(c); });
  }
  const sig = replies.length + "|" + vids.map(v => v.id).join(",");
  if (list.dataset.sig !== sig){
    list.dataset.sig = sig; list.textContent = "";
    replies.forEach(r => list.append(el("blockquote", "reply-in", r.body), el("p", "status-line", longDate(r.at))));
    vids.forEach(v => {
      const vid = el("video", "reply-vid"); vid.controls = true; vid.preload = "metadata"; vid.playsInline = true; vid.setAttribute("playsinline", ""); vid.src = v.url;
      list.append(vid, el("p", "status-line", longDate(v.at) + ". Only you can see this."));
    });
  }
  // Kindness travelling on: songs since started from this one's page, or by the people who helped make it.
  const n = view.passedOn || 0;
  $("#passed-note").textContent = n ? "Kindness travels: " + (n === 1 ? "one new song has" : n + " new songs have") + " been started because of this one." : "";
  // Anything new since this device last looked gets its moment, then counts as seen.
  const news = newsOf(view);
  if (news){ markSeen(view.id, view); peeked[view.id] = Object.assign(peeked[view.id] || {}, { firstPlayedAt: view.firstPlayedAt, taps, replies: replies.length, videos: vids.length }); setTimeout(() => burst(box, news.taps.length ? news.taps : ["❤️"], 10), 350); }
  else if (!seenOf(view.id)) markSeen(view.id, view);
}

/* ---------- one question after unlocking: how they heard about us ---------- */
function renderAsk(){
  const box = $("#heard-q"), chips = $("#heard-chips"), thanks = $("#heard-thanks");
  const mine = !!(ref && view && view.id === ref.id && view.paid);
  box.hidden = !mine || !!view.heard || !!readSource().heard || !site.heardChoices.length;
  if (box.hidden) return;
  chips.textContent = ""; chips.hidden = false; thanks.textContent = "";
  site.heardChoices.forEach(choice => {
    const b = el("button", "chip", choice); b.type = "button";
    b.addEventListener("click", async () => {
      writeSource({ heard: choice }); // asked once on this device; later songs carry the same answer
      chips.hidden = true; thanks.textContent = "Thank you. That helps us reach more people.";
      try { await call("/api/orders/" + ref.id + "/heard", { method: "POST", body: { answer: choice } }); view.heard = choice; } catch (e) {}
    });
    chips.append(b);
  });
}

/* ---------- a reminder for next time ---------- */
function renderRemind(){
  const box = $("#remind-box"), mine = !!(ref && view && view.id === ref.id && view.paid);
  box.hidden = !mine || !site.scheduling;
  if (box.hidden) return;
  const r = view.reminder;
  $("#remind-sum").textContent = r ? "Your reminder is set" : "Want a reminder next time?";
  $("#rm-email-field").hidden = view.contactKind === "email" || !!r;
  $("#rm-date").value = r && r.monthDay ? "2024-" + r.monthDay : ""; // only the month and day are kept
  $("#rm-holidays").checked = !!(r && r.holidays);
  $("#rm-save").textContent = r ? "Save changes" : "Remind me";
  $("#rm-off").hidden = !r;
  $("#rm-err").textContent = "";
  $("#rm-note").textContent = r ? "We'll email " + r.email + " a week before"
    + (r.monthDay ? " " + new Date("2024-" + r.monthDay + "T12:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" }) + " each year" : "")
    + (r.monthDay && r.holidays ? ", and" : "") + (r.holidays ? " each of the four holidays" : "") + "." : "";
}
$("#rm-save").addEventListener("click", async () => {
  const err = $("#rm-err"); err.textContent = "";
  const date = $("#rm-date").value, holidays = $("#rm-holidays").checked, email = $("#rm-email").value.trim();
  if (!date && !holidays){ err.textContent = "Pick a date, or tick the holidays, so there is something to remind you about."; return; }
  if (!$("#rm-email-field").hidden && contactKind(email) !== "email"){ err.textContent = "Add your email address so we know where to send the reminder."; return; }
  try { const out = await call("/api/orders/" + ref.id + "/reminder", { method: "POST", body: { date, holidays, email } }); view.reminder = out.reminder; renderRemind(); }
  catch (e) { err.textContent = e.message; }
});
$("#rm-off").addEventListener("click", async () => {
  try { await call("/api/orders/" + ref.id + "/reminder", { method: "POST", body: { off: true } }); view.reminder = null; renderRemind(); $("#rm-note").textContent = "Reminder stopped."; }
  catch (e) { $("#rm-err").textContent = e.message; }
});

/* ---------- making a song together ---------- */
// The organizer invites others from the story step. Each of them adds their own memories on their own phone,
// and the list here fills in as they do. The lyrics are written from everyone's answers.
function clearGroup(){ grp = null; grpView = null; shownFrom = ""; clearInterval(groupTimer); save(GROUP_KEY, null); renderTogether(); }
const groupBasics = () => ({ organizer: draft.sender, recipient: draft.recipient, relationship: draft.relationship, occasion: occasion() });
const groupCall = (path, body) => api("/api/groups/" + grp.id + path, { method: "POST", headers: { "x-group-key": grp.key }, body });
async function syncGroup(){
  if (!grp) return;
  try { grpView = await groupCall("/sync", groupBasics()); }
  catch (e) { if (/not found/i.test(e.message)) clearGroup(); return; } // the invitation is gone; offline just keeps the last view
  renderTogether(); updateRecord();
}
function renderTogether(){
  $("#tg-off").hidden = !!grp; $("#tg-on").hidden = !grp;
  const used = $("#tg-used"); used.textContent = "";
  if (!grp) return;
  const url = (grpView && grpView.joinUrl) || location.origin + "/join/" + grp.id, closed = !!(grpView && grpView.closed);
  const them = draft.recipient.trim() || "someone special";
  const msg = "I'm making a song for " + them + " on Songpost, and I'd love your memories in it. It takes two minutes: " + url;
  $("#tg-share").hidden = closed; $("#tg-check").hidden = closed;
  $("#tg-link").value = url;
  $("#tg-sms").href = "sms:?&body=" + encodeURIComponent(msg);
  $("#tg-wa").href = "https://wa.me/?text=" + encodeURIComponent(msg);
  $("#tg-mail").href = "mailto:?subject=" + encodeURIComponent("Add your memories to a song for " + them) + "&body=" + encodeURIComponent(msg);
  const native = $("#tg-native"); native.hidden = !navigator.share; native.onclick = () => navigator.share({ text: msg }).catch(() => {});
  const list = $("#tg-list"), parts = grpView ? grpView.parts : []; list.textContent = "";
  parts.forEach(p => {
    const d = el("details", "tg-part"), sum = el("summary", null, p.name + " added " + (p.answers.length === 1 ? "one memory" : p.answers.length + " memories"));
    d.append(sum);
    p.answers.forEach(a => d.append(el("p", "tg-q", a.q), el("p", "tg-a", a.a)));
    if (!closed){
      const rm = el("button", "btn quiet small", "Leave " + p.name + "'s memories out"); rm.type = "button";
      rm.addEventListener("click", async () => { try { grpView = await groupCall("/remove", { part: p.id }); renderTogether(); updateRecord(); } catch (e) { $("#tg-err").textContent = e.message; } });
      d.append(rm);
    }
    list.append(d);
  });
  const names = others().map(p => p.name);
  $("#tg-note").textContent = closed ? "The song has been recorded, so the invitation is closed."
    : names.length ? "The song will be signed from " + listNames([draft.sender.trim() || "you"].concat(names)) + "."
    : "Nobody has added anything yet. This list fills in as they do.";
  // On the lyrics step: whose memories the lyrics hold, and whether anyone has added theirs since.
  if (names.length && draft.lyrics.trim()){
    const had = usedIds();
    const inSong = others().filter(p => had.indexOf(String(p.id)) >= 0).map(p => p.name), late = others().filter(p => had.indexOf(String(p.id)) < 0).map(p => p.name);
    used.textContent = (inSong.length ? "These lyrics include memories from " + listNames(inSong) + ". " : "")
      + (late.length ? listNames(late) + (late.length === 1 ? " has" : " have") + " added memories since these lyrics were written. Tap Write different lyrics to include them. Until then, the song isn't signed from them." : "");
  }
}
$("#tg-start").addEventListener("click", async e => {
  const b = e.currentTarget, err = $("#tg-err"); err.textContent = ""; b.disabled = true;
  try {
    const out = await api("/api/groups", { method: "POST", body: groupBasics() });
    grp = { id: out.id, key: out.key }; grpView = out; save(GROUP_KEY, grp);
    renderTogether(); clearInterval(groupTimer); groupTimer = setInterval(syncGroup, 20000);
  } catch (x) { err.textContent = x.message; }
  b.disabled = false;
});
$("#tg-check").addEventListener("click", syncGroup);
$("#tg-copy").addEventListener("click", async e => {
  const b = e.currentTarget;
  try { await navigator.clipboard.writeText($("#tg-link").value); b.textContent = "Copied"; }
  catch (x) { $("#tg-link").select(); b.textContent = "Select and copy"; }
  setTimeout(() => { b.textContent = "Copy link"; }, 1800);
});

/* ---------- your songs: every song sent from this device, by person, and what came back ---------- */
// Nothing here needs an account. The device remembers each song and its private key; one request asks the site how
// they are all doing. What has been seen is remembered too, so something new can be shown as new, once.
const SEEN_KEY = "songpost-seen-v1";
let peeked = {};                 // id -> what the site last said about that song
const cheered = {};              // songs whose news has already had its small celebration on this visit
const ICON = {
  sealed: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 8l8.5 6 8.5-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  played: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 8.4v7.2l6-3.6z" fill="currentColor"/></svg>',
  words: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.6a7.6 7.6 0 0 1-11 6.8L4 20l1.6-4.6A7.6 7.6 0 1 1 20 11.6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6.5" width="12" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M15 10.5l5.5-3v9l-5.5-3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  go: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5.5l6.5 6.5L9 18.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
const shortDate = ms => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const seenOf = id => (load(SEEN_KEY) || {})[id] || null;
const countsOf = p => ({ played: !!p.firstPlayedAt, replies: Array.isArray(p.replies) ? p.replies.length : p.replies || 0, taps: (p.taps || []).length, videos: Array.isArray(p.reactions) ? p.reactions.length : p.videos || 0 });
function markSeen(id, p){ const all = load(SEEN_KEY) || {}; all[id] = countsOf(p); save(SEEN_KEY, all); }
// What is new on a song since this device last looked: { played, replies, taps: [emoji], videos }, or null.
function newsOf(p){
  const now = countsOf(p), was = seenOf(p.id) || { played: false, replies: 0, taps: 0, videos: 0 };
  const taps = (p.taps || []).slice(was.taps).map(t => t.emoji);
  const news = { played: now.played && !was.played, replies: Math.max(0, now.replies - was.replies), taps, videos: Math.max(0, now.videos - was.videos) };
  return news.played || news.replies || news.taps.length || news.videos ? news : null;
}
const newsLine = (name, n) => n.taps.length ? name + " sent you " + n.taps.slice(0, 4).join(" ") : n.replies ? name + " wrote back" : n.videos ? name + " sent you a video" : name + " played your song";
async function openSong(s){
  if (busy) return; busy = true;
  try { ref = { id: s.id, key: s.key }; view = await call("/api/orders/" + s.id); save(ORDER_KEY, ref); busy = false; showDone(view); window.scrollTo(0, 0); return; }
  catch (e) { ref = null; view = null; save(SONGS_KEY, (load(SONGS_KEY) || []).filter(x => x && x.id !== s.id)); renderYours(); } // the song is gone
  busy = false;
}
function drawYours(songs){
  const list = $("#yours-list"); list.textContent = "";
  const full = songs.map(s => Object.assign({}, s, peeked[s.id] || {}));
  const lastAt = p => Math.max(p.paidAt || 0, p.firstPlayedAt || 0, p.lastReply ? p.lastReply.at : 0, (p.taps || []).length ? p.taps[p.taps.length - 1].at : 0);
  // By person: everyone a song was sent to, the one with the latest news first.
  const people = [], byName = {};
  full.forEach((p, i) => { const k = (p.recipient || "").trim().toLowerCase() || "song-" + i; if (!byName[k]){ byName[k] = { name: p.recipient || "", songs: [] }; people.push(byName[k]); } byName[k].songs.push(p); });
  people.forEach(g => { g.songs.sort((a, b) => lastAt(b) - lastAt(a) || songs.indexOf(b) - songs.indexOf(a)); g.at = Math.max.apply(null, g.songs.map(lastAt)); });
  people.sort((a, b) => b.at - a.at || songs.findIndex(s => s.id === b.songs[0].id) - songs.findIndex(s => s.id === a.songs[0].id));
  let fresh = 0, firstNews = "";
  people.forEach(g => {
    const group = el("div", "person");
    if (g.songs.length > 1) group.append(el("p", "person-h", (g.name || "Your songs") + " • " + g.songs.length + " songs"));
    g.songs.forEach(p => {
      const card = el("button", "song-card"); card.type = "button"; card.dataset.id = p.id;
      const rec = el("div", "record"); rec.dataset.metal = p.tier === "platinum" ? "platinum" : "gold";
      const body = el("div", "sc-body");
      body.append(el("span", "sc-name", p.recipient ? "For " + p.recipient : "Your song"));
      if (p.title) body.append(el("span", "sc-title", p.title));
      const stat = el("div", "sc-stat");
      const bit = (icon, text, cls) => { const b = el("span", "sc-bit" + (cls ? " " + cls : "")); b.innerHTML = icon || ""; b.append(document.createTextNode(text)); stat.append(b); };
      if (peeked[p.id]){
        if (p.firstPlayedAt) bit(ICON.played, "Played " + shortDate(p.firstPlayedAt)); else bit(ICON.sealed, "Not opened yet", "quiet");
        tapCounts(p.taps).forEach(t => bit("", t[0] + (t[1] > 1 ? " " + t[1] : ""), "emo"));
        if (p.replies) bit(ICON.words, String(p.replies));
        if (p.videos) bit(ICON.video, String(p.videos));
      }
      body.append(stat);
      if (p.lastReply && p.lastReply.body) body.append(el("span", "sc-said", "“" + p.lastReply.body + "”"));
      const go = el("span", "sc-go"); go.innerHTML = ICON.go;
      card.append(rec, body, go);
      const news = peeked[p.id] ? newsOf(p) : null;
      if (news){
        fresh++; card.classList.add("fresh"); if (!firstNews) firstNews = newsLine(p.recipient || "They", news);
        card.setAttribute("aria-label", newsLine(p.recipient || "They", news) + ". Open this song.");
      }
      card.addEventListener("click", () => openSong({ id: p.id, key: p.key }));
      group.append(card);
      setRecord(rec, { recipient: p.recipient, sender: "", title: p.title, occasion: p.occasion });
      // News gets a small celebration, once a visit, as its card comes onto the screen.
      if (news && !cheered[p.id] && "IntersectionObserver" in window){
        const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && step === -1){ io.disconnect(); if (!cheered[p.id]){ cheered[p.id] = true; burst(card, news.taps.length ? news.taps : ["❤️"], 8); } } }, { threshold: 0.6 });
        io.observe(card);
      }
    });
    list.append(group);
  });
  // The whole picture in three small figures: sent, played, and how much came back.
  const known = full.filter(p => peeked[p.id]), back = known.reduce((n, p) => n + (p.taps || []).length + (p.replies || 0) + (p.videos || 0), 0);
  const sum = $("#yours-sum"); sum.textContent = "";
  if (known.length){
    const fig = (n, word) => { const f = el("span", "ys"); f.append(el("b", null, String(n)), document.createTextNode(" " + word)); sum.append(f); };
    fig(full.length, full.length === 1 ? "song sent" : "songs sent"); fig(known.filter(p => p.firstPlayedAt).length, "played"); fig(back, back === 1 ? "reaction back" : "reactions back");
  }
  $("#yours-news").textContent = fresh ? firstNews + (fresh > 1 ? ", and there is more" : "") + "." : "";
  $("#my-songs").classList.toggle("has-news", fresh > 0);
  // Who's next: a few people most songs are for, leaving out the ones already sung to from here.
  const used = full.map(p => (p.relationship || "").toLowerCase()), chips = $("#next-chips"); chips.textContent = "";
  ["Mom", "Dad", "Wife", "Husband", "Sister", "Brother", "Best friend", "Grandma", "Grandpa", "Daughter", "Son"].filter(w => !used.some(u => u.indexOf(w.toLowerCase()) >= 0)).slice(0, 4).concat(["Someone else"]).forEach(w => {
    const b = el("button", "chip", w); b.type = "button";
    b.addEventListener("click", () => { if (w !== "Someone else"){ draft.relationship = w.toLowerCase(); saveDraft(); syncInputs(); } $("#begin-btn").click(); });
    chips.append(b);
  });
}
async function renderYours(){
  const songs = (load(SONGS_KEY) || []).filter(s => s && s.id && s.key);
  $("#yours").hidden = !songs.length; $("#my-songs").hidden = !songs.length;
  if (!songs.length) return;
  drawYours(songs); // straight away from what this device remembers, then again with how each is doing
  try {
    const out = await api("/api/orders/peek", { method: "POST", body: { songs: songs.map(s => ({ id: s.id, key: s.key })) } });
    (out.songs || []).forEach(p => { peeked[p.id] = p; });
    const gone = (out.songs || []).filter(p => p.gone).map(p => p.id);
    if (gone.length) save(SONGS_KEY, (load(SONGS_KEY) || []).filter(s => s && gone.indexOf(s.id) < 0));
    const left = (load(SONGS_KEY) || []).filter(s => s && s.id && s.key);
    $("#yours").hidden = !left.length; $("#my-songs").hidden = !left.length;
    if (left.length) drawYours(left);
  } catch (e) { /* the list still shows, without the news */ }
}
// The heart at the top of the page: back to your songs from anywhere.
$("#my-songs").addEventListener("click", () => {
  if (step !== -1){ clearInterval(pollTimer); go(-1); }
  renderYours();
  requestAnimationFrame(() => { const y = $("#yours"); if (!y.hidden) y.scrollIntoView({ behavior: calmMotion ? "auto" : "smooth", block: "start" }); });
});

/* ---------- after paying: what comes with a Platinum record ---------- */
// The photo is made smaller here, in the browser, before it is sent: no more than 1600 pixels on its long side,
// saved as a JPEG. Drawing it afresh also leaves behind what a phone writes into a picture, such as where it was taken.
async function shrinkPhoto(file){
  let src, w, h;
  try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); w = src.width; h = src.height; }
  catch (e) {
    const link = URL.createObjectURL(file);
    try {
      src = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error("unreadable")); im.src = link; });
      w = src.naturalWidth; h = src.naturalHeight;
    } finally { setTimeout(() => URL.revokeObjectURL(link), 4000); }
  }
  if (!w || !h) throw new Error("unreadable");
  const k = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height);
  return new Promise((ok, no) => c.toBlob(b => (b ? ok(b) : no(new Error("unreadable"))), "image/jpeg", 0.86));
}
let photoBusy = false, touchFor = null;
// A line of the "Make it yours" list: ticked once the touch has been added.
function touchLine(box, sum, has, plain, done){ $(box).classList.toggle("has", !!has); $(sum).textContent = has ? done : plain; }
// The sender's own touches, on either record: their voice, their signature, their own words, and (Platinum) a photo.
function renderTouches(own, platinum){
  const box = $("#touch-box"); box.hidden = !own;
  if (!own) return;
  if (touchFor !== view.id){ // a different song from the one last shown: nothing typed, drawn or said about that one carries over
    touchFor = view.id; signDirty = false; signNow = null;
    ["#voice-note", "#voice-err", "#sign-note", "#sign-err", "#words-note", "#words-err", "#photo-note", "#photo-err"].forEach(s => { $(s).textContent = ""; });
    $$("details", box).forEach(d => { d.open = false; });
  }
  const name = view.recipient || "them";
  $("#touch-lede").textContent = "Add any of these before you send the link. " + name + " finds them when the envelope is opened.";
  // their voice
  touchLine("#voice-box", "#voice-sum", view.voiceUrl, "Say a few words in your own voice", "Your voice is on it");
  $("#voice-lede").textContent = "Up to " + VOICE_SECONDS + " seconds. " + name + " hears you just before the song starts.";
  if (!voiceBusy){
    const player = $("#voice-play");
    player.hidden = !view.voiceUrl; if (view.voiceUrl && player.getAttribute("src") !== view.voiceUrl) player.src = view.voiceUrl;
    $("#voice-rec").textContent = view.voiceUrl ? "Record it again" : "Record"; $("#voice-rec").hidden = false; $("#voice-stop").hidden = true;
    $("#voice-remove").hidden = !view.voiceUrl; $("#voice-bar").hidden = true;
  }
  // their signature
  touchLine("#sign-box", "#sign-sum", view.signature, "Sign it", "Signed");
  $("#sign-remove").hidden = !view.signature;
  if (!signDirty){
    const typed = view.signature && !Array.isArray(view.signature) ? view.signature : null; // an older signature was a drawing
    $("#sign-text").value = typed ? typed.text : ""; signFont = typed ? typed.font : "flowing"; paintSign();
  }
  // their own words
  const answers = view.answers || [], shown = view.wordsShown || [], words = $("#words-box");
  words.hidden = !answers.length;
  if (answers.length){
    touchLine("#words-box", "#words-sum", shown.length, "Show what you told us about " + name, "Your own words are on it");
    $("#words-lede").textContent = view.together ? "Choose one or two of your answers. They appear on a card on " + name + "'s page." : "Choose one or two of your answers. They appear on a card that says “What " + (view.sender || "you") + " told us about you”.";
    const list = $("#words-list"); list.textContent = "";
    answers.forEach((a, i) => {
      const lab = el("label", "check"), cb = el("input"); cb.type = "checkbox"; cb.checked = shown.indexOf(i) >= 0; cb.value = String(i);
      const say = el("span"); say.append(el("small", null, a.q), document.createTextNode(a.a));
      lab.append(cb, say); list.append(lab);
      cb.addEventListener("change", async () => {
        const picked = $$("input", list).filter(x => x.checked).map(x => Number(x.value));
        const err = $("#words-err"), note = $("#words-note"); err.textContent = ""; note.textContent = "";
        if (picked.length > 2){ cb.checked = false; err.textContent = "Choose one or two."; return; }
        $$("input", list).forEach(x => { x.disabled = true; });
        try { view = await call("/api/orders/" + ref.id + "/words", { method: "POST", body: { show: picked } }); note.textContent = picked.length ? "Saved. It's on " + name + "'s page." : "Saved. Nothing is shown."; renderTouches(true, platinum); $("#words-note").textContent = note.textContent; }
        catch (x) { cb.checked = !cb.checked; err.textContent = x.message; $$("input", list).forEach(y => { y.disabled = false; }); }
      });
    });
  }
  // a photo (Platinum)
  $("#photo-box").hidden = !platinum;
  if (platinum){
    const thumb = $("#photo-thumb");
    touchLine("#photo-box", "#photo-sum", view.photoUrl, "Add a photo", "Your photo is on it");
    thumb.hidden = !view.photoUrl; if (view.photoUrl && thumb.getAttribute("src") !== view.photoUrl) thumb.src = view.photoUrl;
    thumb.alt = view.photoUrl ? "The photo on " + name + "'s page" : "";
    $("#photo-lede").textContent = view.photoUrl ? "This photo is on " + name + "'s page and on the lyric sheet."
      : "It appears with the song on " + name + "'s page, and on the lyric sheet.";
    $("#photo-pick").textContent = view.photoUrl ? "Change the photo" : "Choose a photo";
    $("#photo-remove").hidden = !view.photoUrl;
    // May the photo be shown with what they write back? It takes the sender's yes, the recipient's, and then ours.
    $("#photo-share-row").hidden = !view.photoUrl; $("#photo-share").checked = !!view.photoShare;
    $("#photo-share-say").textContent = "Songpost may show this photo beside what " + name + " writes back, as a testimonial. Only if " + name + " agrees too, and only after we have looked at it.";
  }
}

/* ---------- the sender's voice: a few words, recorded here and heard before the song ---------- */
const VOICE_SECONDS = 10;
let voiceBusy = false, voiceRec = null, voiceStream = null, voiceTimer = null, voiceParts = [];
// Turns what the browser recorded into a small WAV file: one channel, 22,050 samples a second, at most ten seconds,
// brought up to a steady loudness. Every phone and computer can play a WAV, whatever recorded it.
async function toWav(blob){
  const AC = window.AudioContext || window.webkitAudioContext, OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AC || !OAC) throw new Error("unsupported");
  const bytes = await blob.arrayBuffer(), ctx = new AC();
  let heard;
  try { heard = await new Promise((ok, no) => { const p = ctx.decodeAudioData(bytes, ok, no); if (p && p.catch) p.catch(no); }); }
  finally { if (ctx.close) ctx.close().catch(() => {}); }
  const seconds = Math.min(VOICE_SECONDS, heard.duration);
  const render = rate => new Promise((ok, no) => {
    const off = new OAC(1, Math.max(1, Math.floor(seconds * rate)), rate), src = off.createBufferSource();
    src.buffer = heard; src.connect(off.destination); src.start(0);
    off.oncomplete = e => ok(e.renderedBuffer);
    const p = off.startRendering(); if (p && p.catch) p.catch(no);
  });
  let rate = 22050, out;
  try { out = await render(rate); } catch (e) { rate = 44100; out = await render(rate); } // older phones only work at the full rate
  let data = out.getChannelData(0);
  if (rate === 44100){ const half = new Float32Array(Math.floor(data.length / 2)); for (let i = 0; i < half.length; i++) half[i] = (data[2 * i] + data[2 * i + 1]) / 2; data = half; rate = 22050; }
  let peak = 0; for (let i = 0; i < data.length; i++){ const a = Math.abs(data[i]); if (a > peak) peak = a; }
  if (peak < 0.004) throw new Error("silent");
  const gain = Math.min(0.92 / peak, 8);
  const wav = new DataView(new ArrayBuffer(44 + data.length * 2)), put = (at, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(at + i, s.charCodeAt(i)); };
  put(0, "RIFF"); wav.setUint32(4, 36 + data.length * 2, true); put(8, "WAVE"); put(12, "fmt "); wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
  put(36, "data"); wav.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++){ const v = Math.max(-1, Math.min(1, data[i] * gain)); wav.setInt16(44 + i * 2, v < 0 ? v * 32768 : v * 32767, true); }
  return new Blob([wav.buffer], { type: "audio/wav" });
}
function voiceIdle(){
  voiceBusy = false; clearInterval(voiceTimer);
  if (voiceStream){ voiceStream.getTracks().forEach(t => t.stop()); voiceStream = null; }
  if (ref && view) renderTouches(view.id === ref.id && view.paid, view.tier === "platinum");
}
$("#voice-rec").addEventListener("click", async () => {
  if (voiceBusy || !ref) return;
  const note = $("#voice-note"), err = $("#voice-err"); note.textContent = ""; err.textContent = "";
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder){ err.textContent = "This browser can't record sound. Try the browser on your phone."; return; }
  voiceBusy = true;
  try { voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { voiceIdle(); err.textContent = "We couldn't use the microphone. Allow it for this site, then try again."; return; }
  try { voiceRec = new MediaRecorder(voiceStream); } catch (e) { voiceIdle(); err.textContent = "This browser can't record sound. Try the browser on your phone."; return; }
  voiceParts = [];
  voiceRec.ondataavailable = e => { if (e.data && e.data.size) voiceParts.push(e.data); };
  voiceRec.onstop = async () => {
    clearInterval(voiceTimer); if (voiceStream) voiceStream.getTracks().forEach(t => t.stop());
    $("#voice-stop").hidden = true; $("#voice-bar").hidden = true; note.textContent = "Saving your message.";
    try {
      let wav;
      try { wav = await toWav(new Blob(voiceParts, { type: voiceRec.mimeType || "audio/webm" })); }
      catch (x) { throw new Error(x && x.message === "silent" ? "We couldn't hear anything. Check your microphone and try again." : "That recording couldn't be used. Try again."); }
      let res;
      try { res = await fetch("/api/orders/" + encodeURIComponent(ref.id) + "/voice", { method: "POST", headers: { "content-type": "audio/wav", "x-order-key": ref.key }, body: wav }); }
      catch (x) { throw new Error("You seem to be offline. Check your connection and try again."); }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Something went wrong. Try again.");
      view = json; note.textContent = "Saved. Listen to it here, or record it again.";
    } catch (x) { note.textContent = ""; err.textContent = x.message; }
    voiceIdle();
  };
  $("#voice-rec").hidden = true; $("#voice-remove").hidden = true; $("#voice-play").hidden = true; $("#voice-stop").hidden = false;
  const bar = $("#voice-bar"), fill = $("i", bar); bar.hidden = false; fill.style.width = "0";
  const began = Date.now();
  try { voiceRec.start(); } catch (e) { voiceIdle(); note.textContent = ""; err.textContent = "This browser can't record sound. Try the browser on your phone."; return; }
  voiceTimer = setInterval(() => {
    const gone = (Date.now() - began) / 1000, left = Math.max(0, Math.ceil(VOICE_SECONDS - gone));
    fill.style.width = Math.min(100, gone / VOICE_SECONDS * 100) + "%";
    note.textContent = "Recording. " + left + (left === 1 ? " second left." : " seconds left.");
    if (gone >= VOICE_SECONDS && voiceRec.state !== "inactive") voiceRec.stop();
  }, 100);
});
$("#voice-stop").addEventListener("click", () => { if (voiceRec && voiceRec.state !== "inactive") voiceRec.stop(); });
$("#voice-remove").addEventListener("click", async () => {
  if (voiceBusy || !ref) return; voiceBusy = true; $("#voice-err").textContent = "";
  try { view = await call("/api/orders/" + ref.id + "/voice", { method: "DELETE" }); $("#voice-note").textContent = "Your message has been taken off."; }
  catch (x) { $("#voice-err").textContent = x.message; }
  voiceIdle();
});

/* ---------- the sender's signature: typed, and shown in a handwriting they choose ---------- */
const SIG_FONTS = [["flowing", "Flowing"], ["elegant", "Elegant"], ["formal", "Formal"], ["brush", "Brush"], ["friendly", "Friendly"], ["fine", "Fine"], ["classic", "Classic"], ["pen", "Pen"]];
let signFont = "flowing", signDirty = false, signNow = null;
// Each choice shows the sender's own words in that handwriting, so they pick by looking.
function paintSign(){
  const text = $("#sign-text").value.trim() || (view && view.sender) || "Your name";
  const box = $("#sign-fonts");
  if (!box.children.length) SIG_FONTS.forEach(f => {
    const b = el("button", "sign-font"); b.type = "button"; b.dataset.font = f[0]; b.setAttribute("aria-label", f[1] + " handwriting");
    b.append(el("span", "sigt sigf-" + f[0]));
    b.addEventListener("click", () => { signFont = f[0]; signDirty = true; paintSign(); });
    box.append(b);
  });
  $$(".sign-font", box).forEach(b => { b.setAttribute("aria-pressed", String(b.dataset.font === signFont)); b.firstChild.textContent = text; });
}
$("#sign-text").addEventListener("input", () => { signDirty = true; $("#sign-note").textContent = ""; $("#sign-err").textContent = ""; paintSign(); });
$("#sign-save").addEventListener("click", async () => {
  if (busy || !ref) return;
  const err = $("#sign-err"), note = $("#sign-note"), text = $("#sign-text").value.trim(); err.textContent = ""; note.textContent = "";
  if (!text){ err.textContent = "Type your signature first."; return; }
  busy = true;
  try { view = await call("/api/orders/" + ref.id + "/signature", { method: "POST", body: { text, font: signFont } }); signDirty = false; renderExtras(); $("#sign-note").textContent = "Saved. It appears under your note."; }
  catch (x) { err.textContent = x.message; }
  busy = false;
});
$("#sign-remove").addEventListener("click", async () => {
  if (busy || !ref) return; busy = true; $("#sign-err").textContent = "";
  try { view = await call("/api/orders/" + ref.id + "/signature", { method: "DELETE" }); signDirty = false; renderExtras(); $("#sign-note").textContent = "Your signature has been taken off."; }
  catch (x) { $("#sign-err").textContent = x.message; }
  busy = false;
});

function renderPlat(){
  const own = !!(ref && view && view.id === ref.id && view.paid), box = $("#plat-box");
  renderTouches(own, own && view.tier === "platinum");
  box.hidden = !(own && view.tier === "platinum");
  if (box.hidden) return;
  const name = view.recipient || "them";
  $("#sheet-link").href = view.sheetUrl ? view.sheetUrl + "?okey=" + encodeURIComponent(ref.key) : "#"; // with the key, so the design chosen there is kept $("#sheet-link").hidden = !view.sheetUrl; $("#sheet-lede").hidden = !view.sheetUrl;
  // Every take is kept, and the sender chooses the one that plays first.
  const lead = $("#lead-box"), chips = $("#lead-chips");
  lead.hidden = !(view.takes.length > 1 && view.status !== "generating");
  chips.textContent = ""; $("#lead-err").textContent = "";
  if (lead.hidden) return;
  $("#lead-lede").textContent = name + " gets one song. Listen to your takes here and choose the one they hear.";
  // A player for the take that is chosen now, so the sender can compare them without leaving this page.
  let hear = document.getElementById("lead-audio");
  if (!hear){
    hear = document.createElement("audio"); hear.id = "lead-audio"; hear.controls = true; hear.preload = "none";
    // the record beside it turns, and its lines ripple, while a take plays here too
    hear.addEventListener("play", () => $("#make-record").classList.add("spinning"));
    ["pause", "ended", "emptied"].forEach(ev => hear.addEventListener(ev, () => { if (!(view && view.status === "generating")) $("#make-record").classList.remove("spinning"); }));
    hear.style.cssText = "display:block;width:100%;margin-top:12px";
    hear.setAttribute("aria-label", "The take " + name + " will hear");
    lead.append(hear);
  }
  const hearSrc = "/media/" + encodeURIComponent(view.id) + "?take=" + view.chosen;
  if (hear.getAttribute("src") !== hearSrc){ hear.pause(); hear.setAttribute("src", hearSrc); }
  view.takes.forEach(t => {
    const b = el("button", "chip", "Take " + (t.n + 1) + (t.premium ? " (premium)" : "")); b.type = "button";
    b.setAttribute("aria-pressed", String(t.n === view.chosen));
    b.addEventListener("click", async () => {
      if (busy || t.n === view.chosen) return; busy = true;
      try { view = await call("/api/orders/" + ref.id + "/choose", { method: "POST", body: { take: t.n } }); renderExtras(); }
      catch (e) { $("#lead-err").textContent = e.message; }
      busy = false;
    });
    chips.append(b);
  });
}
$("#photo-pick").addEventListener("click", () => { if (!photoBusy) $("#photo-file").click(); });
$("#photo-file").addEventListener("change", async e => {
  const file = e.target.files && e.target.files[0]; e.target.value = "";
  if (!file || photoBusy || !ref) return;
  const note = $("#photo-note"), err = $("#photo-err"); err.textContent = ""; note.textContent = "Adding your photo.";
  photoBusy = true; $("#photo-pick").disabled = true;
  try {
    let blob;
    try { blob = await shrinkPhoto(file); } catch (x) { throw new Error("That picture couldn't be read. Try a JPEG or PNG."); }
    let res;
    try { res = await fetch("/api/orders/" + encodeURIComponent(ref.id) + "/photo", { method: "POST", headers: { "content-type": "image/jpeg", "x-order-key": ref.key }, body: blob }); }
    catch (x) { throw new Error("You seem to be offline. Check your connection and try again."); }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Something went wrong. Try again.");
    view = json; renderPlat(); $("#photo-note").textContent = "Your photo is on their page.";
  } catch (x) { note.textContent = ""; err.textContent = x.message; }
  photoBusy = false; $("#photo-pick").disabled = false;
});
$("#photo-share").addEventListener("change", async e => {
  if (!ref) return;
  const box = e.currentTarget, want = box.checked; $("#photo-err").textContent = "";
  try {
    view = await call("/api/orders/" + ref.id + "/photo-share", { method: "POST", body: { ok: want } }); renderPlat();
    $("#photo-note").textContent = want ? "Thank you. It is only shown if " + (view.recipient || "they") + " agrees as well." : "Understood. The photo will not be shown anywhere but their page.";
  } catch (x) { box.checked = !want; $("#photo-err").textContent = x.message; }
});
$("#photo-remove").addEventListener("click", async () => {
  if (photoBusy || !ref) return; photoBusy = true;
  $("#photo-err").textContent = "";
  try { view = await call("/api/orders/" + ref.id + "/photo", { method: "DELETE" }); renderPlat(); $("#photo-note").textContent = "The photo has been taken off their page."; }
  catch (x) { $("#photo-err").textContent = x.message; }
  photoBusy = false;
});

/* ---------- after paying: the Platinum recording that is still to come, and the one free redo ---------- */
function renderExtras(finished){
  const box = $("#extra-box"), note = $("#extra-note"), redo = $("#redo-box"), second = $("#second-btn");
  box.hidden = true; redo.hidden = true; second.hidden = true; note.textContent = ""; $("#redo-err").textContent = "";
  renderPlat();
  if (!(ref && view && view.id === ref.id && view.paid)) return; // needs this device's key to the song
  const name = view.recipient || "them", platinum = view.tier === "platinum";
  if (view.status === "generating"){
    box.hidden = false;
    note.textContent = view.kind === "redo"
      ? "Recording your song again. The link stays the same, and the new recording takes the place of the old one when it's done."
      : view.kind === "premium" ? "Recording your song on our premium studio model. It becomes the song on " + name + "'s page when it's done. Your other takes stay here, where only you can hear them."
      : "Recording the second take that comes with your Platinum record. When it's done you can listen to both here and choose which one " + name + " hears.";
    startProgress(view.estimateSeconds, view.elapsedSeconds, $("#extra-progress"), "recording");
    $("#make-record").classList.add("spinning");
    pollDone(); return;
  }
  stopProgress(); $("#make-record").classList.remove("spinning");
  const lines = [];
  if (finished && view.error) lines.push(view.error + (finished === "redo" ? " Your free redo has not been used." : ""));
  if (finished === "redo" && !view.error) lines.push("Your new recording is ready, on the same link.");
  if (finished === "second" && !view.owed) lines.push("Both takes are ready. Choose below which one " + name + " hears.");
  if (finished === "premium" && !view.owed && !view.error) lines.push("Your premium recording is ready, and it is now the song on " + name + "'s page.");
  if (view.owed){
    lines.push(view.owed === "premium" ? "Your Platinum record comes with a recording on our premium studio model, and it hasn't been recorded yet."
      : "Your Platinum record comes with a second take, and it hasn't been recorded yet.");
    second.hidden = false;
  }
  const used = view.redo && view.redo.used;
  if (used) lines.push("You've used the free redo for this song.");
  note.textContent = lines.join(" ");
  if (used){ const a = el("a", null, "redo and refund policy"); a.href = "/refunds"; note.append(" If it still isn't right, see the ", a, "."); }
  box.hidden = !lines.length;
  if (view.redo && view.redo.available){
    redo.hidden = false;
    $("#redo-lede").textContent = "Free until " + longDate(view.redo.until) + ". The new recording takes the place of the current one on the same link"
      + (platinum ? ", and your earlier takes stay on the page." : ".");
    if (!$("#redo-box").open || !$("#redo-lyrics").value){ $("#redo-title").value = view.title || ""; $("#redo-lyrics").value = view.lyrics || ""; }
  }
  draft.title = view.title || draft.title; updateRecord();
}
// While a recording runs after payment, ask the server every few seconds whether it is done.
function pollDone(){
  clearInterval(doneTimer);
  doneTimer = setInterval(async () => {
    if (step !== 5 || !ref){ clearInterval(doneTimer); return; }
    let v; try { v = await call("/api/orders/" + ref.id); } catch (e) { return; }
    const was = view && view.kind; view = v;
    if (v.status !== "generating"){ clearInterval(doneTimer); renderExtras(was || "take"); }
  }, 4000);
}
$("#redo-btn").addEventListener("click", async () => {
  if (busy) return; busy = true;
  const err = $("#redo-err"), btn = $("#redo-btn"); err.textContent = ""; btn.disabled = true;
  try {
    view = await call("/api/orders/" + ref.id + "/redo", { method: "POST", body: { title: $("#redo-title").value, lyrics: $("#redo-lyrics").value } });
    $("#redo-box").open = false; renderExtras();
  } catch (e) { err.textContent = e.message; }
  busy = false; btn.disabled = false;
});
$("#second-btn").addEventListener("click", async () => {
  if (busy) return; busy = true;
  try { view = await call("/api/orders/" + ref.id + "/second-take", { method: "POST", body: {} }); renderExtras(); }
  catch (e) { $("#extra-note").textContent = e.message; }
  busy = false;
});
function scheduledText(s){
  const when = new Date(s.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  if (s.failed) return "We couldn't deliver it to " + s.to + ". Check the address or number and pick a new date, or send the link yourself.";
  return s.sent ? "Sent to " + s.to + " on " + when + "." : "Scheduled. It goes to " + s.to + " on " + when + ".";
}
$("#schedule-btn").addEventListener("click", async () => {
  const to = $("#to-email").value.trim(), date = $("#to-date").value, err = $("#schedule-err"), note = $("#schedule-note");
  err.textContent = ""; note.textContent = "";
  if (!contactKind(to)){ err.textContent = "Add their email or mobile number so we know where to send it."; return; }
  if (!date){ err.textContent = "Pick the date to send it."; return; }
  if (date < localToday()){ err.textContent = "Pick today or a later date."; return; }
  try {
    const out = await call("/api/orders/" + ref.id + "/schedule", { method: "POST", body: { to, date } });
    note.textContent = scheduledText(out.schedule);
  } catch (e) { err.textContent = e.message; }
});

/* ---------- what people said ---------- */
/* ---------- example songs on the opening page ---------- */
// Chosen by the owner on the admin page. Each has a title, a line saying who made it and for whom, and a player.
async function loadSamples(){
  let list = [];
  try { const r = await fetch("/samples.json"); if (r.ok) list = await r.json(); } catch (e) {}
  list = (Array.isArray(list) ? list : []).filter(s => s && s.url);
  const box = $("#samples-list"), players = []; box.textContent = "";
  list.forEach(s => {
    const fig = el("figure", "sample"); fig.append(el("p", "s-title", s.title || ""));
    if (s.caption) fig.append(el("figcaption", null, s.caption));
    const holder = el("div"); fig.append(holder);
    if (s.note) fig.append(el("p", "s-note", s.note));
    box.append(fig);
    const audio = mountAudio(holder, s.url, "Play", null); players.push(audio);
    audio.addEventListener("play", () => players.forEach(a => { if (a !== audio) a.pause(); })); // one at a time
  });
  $("#samples").hidden = !list.length;
  $$("[data-next], #begin-btn, #theme-btn, .rec-pick").forEach(b => b.addEventListener("click", () => players.forEach(a => a.pause())));
}

async function loadVoices(){
  let list = [];
  try { const r = await fetch("/testimonials.json"); if (r.ok) list = await r.json(); } catch (e) {}
  list = (Array.isArray(list) ? list : []).filter(v => v && typeof v.quote === "string" && v.quote.trim());
  const box = $("#voices");
  list.slice(0, 3).forEach(v => {
    const fig = el("figure", "voice");
    if (typeof v.photo === "string" && v.photo.charAt(0) === "/"){ // a photo the buyer and the recipient both allowed, chosen by the owner
      const pic = el("img", "voice-pic"); pic.src = v.photo; pic.alt = ""; pic.loading = "lazy";
      pic.addEventListener("error", () => { pic.remove(); fig.classList.remove("has-pic"); });
      fig.classList.add("has-pic"); fig.append(pic);
    }
    fig.append(el("blockquote", null, v.quote.trim()));
    if (typeof v.name === "string" && v.name.trim()) fig.append(el("figcaption", null, v.name.trim()));
    box.append(fig);
  });
  box.hidden = !box.children.length;
  if (list[0]){
    const f = $("#founder");
    $("blockquote", f).textContent = list[0].quote.trim(); $("figcaption", f).textContent = (list[0].name || "").trim();
    if (typeof list[0].photo === "string" && list[0].photo.charAt(0) === "/"){
      const pic = el("img", "voice-pic"); pic.src = list[0].photo; pic.alt = ""; pic.addEventListener("error", () => pic.remove()); f.prepend(pic);
    }
    f.hidden = false;
  }
}

/* ---------- start ---------- */
async function resume(){
  try { view = await call("/api/orders/" + ref.id); }
  catch (e) { ref = null; save(ORDER_KEY, null); return go(-1); }
  if (view.paid) return showDone(view);
  draft.recipient = view.recipient; if (!view.together) draft.sender = view.sender; draft.occasion = view.occasion; draft.genre = view.genre; draft.tone = view.tone || draft.tone;
  shownFrom = view.together ? view.sender : "";
  if (CHIPS.occasion.indexOf(draft.occasion) < 0){ draft.occasionOther = draft.occasion; draft.occasion = OTHER; } // an occasion they typed themselves
  if (view.note && !draft.note) draft.note = view.note;
  syncInputs(); go(4); renderListen(); poll();
  syncGroup();
}
async function init(){
  const saved = load(DRAFT_KEY);
  if (saved && typeof saved === "object") for (const k in draft) if (typeof saved[k] === "string") draft[k] = saved[k];
  buildChips(); syncInputs(); renderYours(); go(-1);
  try { site = Object.assign(site, await api("/api/config")); } catch (e) {}
  $(".fine").textContent = "About five minutes. You hear it before you pay. Songs from " + money(site.priceGoldCents) + ".";
  if (emailOnly()){ // only email is connected, so a mobile number would get nothing
    $("#contact-label").textContent = "Your email address"; $('[data-bind="email"]').placeholder = "you@example.com";
    $("#contact-hint").textContent = "We send you a link to this song, so it's never lost, and your receipt. It's used for nothing else.";
    $("#to-label").textContent = "Their email address";
  }
  loadVoices(); loadSamples();
  const q = new URLSearchParams(location.search), oid = q.get("order"), key = q.get("key"), sid = q.get("session_id");
  // How this visitor arrived: from a gift page (?from=), from adding to a group song (?join=), by a partner's link (?ref=),
  // or from an occasion page (?occasion=). Remembered on this device, counted once per visit, then dropped from the address.
  const arrived = (kind, body) => { try { if (sessionStorage.getItem("sp-" + kind)) return; sessionStorage.setItem("sp-" + kind, "1"); } catch (e) {} api("/api/track", { method: "POST", body: Object.assign({ kind }, body) }).catch(() => {}); };
  const clipped = k => String(q.get(k) || "").trim().slice(0, 40);
  if (clipped("from")){ writeSource({ from: clipped("from"), join: undefined, at: Date.now() }); arrived("fromgift"); }
  else if (clipped("join")){ writeSource({ join: clipped("join"), from: undefined, at: Date.now() }); arrived("fromjoin"); }
  if (clipped("ref")){ writeSource({ ref: clipped("ref").toLowerCase(), at: Date.now() }); arrived("ref", { code: clipped("ref").toLowerCase() }); }
  const wanted = clipped("occasion");
  if (!oid && (q.has("from") || q.has("join") || q.has("ref") || q.has("occasion"))) history.replaceState(null, "", "/");
  grp = load(GROUP_KEY); if (!(grp && grp.id && grp.key)) grp = null;
  let stored = load(ORDER_KEY);
  if (oid && key){ stored = { id: oid, key }; save(ORDER_KEY, stored); } // arriving from the link we sent
  if (oid){
    history.replaceState(null, "", "/?order=" + encodeURIComponent(oid));
    if (stored && stored.id === oid) ref = stored;
    try {
      const c = await api("/api/orders/" + encodeURIComponent(oid) + "/confirm" + (sid ? "?session_id=" + encodeURIComponent(sid) : ""));
      if (c.paid){
        if (ref){ try { view = await call("/api/orders/" + ref.id); return showDone(view); } catch (e) {} }
        return showDone(c);
      }
    } catch (e) {}
    if (ref) return resume();
    return;
  }
  track("arrived");
  if (stored && stored.id && stored.key){
    ref = stored;
    try { view = await call("/api/orders/" + ref.id); } catch (e) { ref = null; view = null; save(ORDER_KEY, null); }
    if (view && view.paid){ ref = null; view = null; save(ORDER_KEY, null); } // a finished song: start fresh
    else if (view) return resume();
  }
  // An invitation whose song has already been recorded belongs to that song, not the next one.
  if (grp){ await syncGroup(); if (grpView && grpView.closed) clearGroup(); }
  // Arriving from an occasion page: that occasion is chosen, and the questions open straight away.
  if (wanted){
    // One of the listed occasions, however it was typed, selects that one. Anything else is "Another occasion", filled in.
    const listed = CHIPS.occasion.filter(c => c !== OTHER && c.toLowerCase() === wanted.toLowerCase())[0];
    if (listed) draft.occasion = listed; else { draft.occasion = OTHER; draft.occasionOther = wanted; }
    saveDraft(); syncInputs(); track("started"); go(0);
  }
}
init();

/* ---------- Songpost on the phone's home screen ---------- */
// The site can be kept on a phone like an app. Android offers to do it when asked; an iPhone has no such offer, so we say where to tap.
// The "Get the app" button at the top shows on phones. On Android one tap brings up the phone's own install box. An iPhone does not
// let a website install itself, so there the button opens three short steps, with the same symbols the person will see in their browser.
(function keepOnPhone(){
  const btn = $("#keep-app"), sheet = $("#app-how"), why = $("#app-how-why"), steps = $("#app-steps"), done = $("#app-how-done");
  const onHome = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  if (onHome) { track("appopen"); return; }
  if (!btn || !sheet || !steps) return;
  const ua = navigator.userAgent || "";
  const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1), android = /Android/.test(ua);
  // Inside another app's own browser (a link opened from Facebook, Instagram and the like) an iPhone has no "Add to Home Screen" at all.
  const inApp = apple && (/FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|LinkedInApp|GSA\//.test(ua) || !/Safari\//.test(ua));
  const draw = d => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>";
  const SHARE = draw('<path d="M12 15V3.5"/><path d="M8 7l4-4 4 4"/><path d="M8 10.5H6.5a1.5 1.5 0 0 0-1.5 1.5v7a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16"/>');
  const ADD = draw('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>');
  const MENU = draw('<circle cx="12" cy="5.5" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="12" cy="18.5" r=".9" fill="currentColor"/>');
  let offer = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); offer = e; btn.hidden = false; });
  window.addEventListener("appinstalled", () => { track("appinstall"); btn.hidden = true; if (sheet.open) sheet.close(); });
  if (apple || android) btn.hidden = false;
  const show = () => {
    const list = apple ? [
      "Tap the <b>Share</b> button " + SHARE + " in your browser. If you do not see it, tap the three dots first.",
      "Scroll down the list and tap <b>Add to Home Screen</b> " + ADD + ".",
      "Tap <b>Add</b>. Songpost is now on your home screen, with the gold record as its icon."
    ] : [
      "Tap the menu " + MENU + " at the top of your browser.",
      "Tap <b>Add to Home screen</b> or <b>Install app</b>.",
      "Tap <b>Install</b>. Songpost is now on your home screen, with the gold record as its icon."
    ];
    if (inApp) list.unshift("Open this page in <b>Safari</b> first: tap the three dots or the compass, then <b>Open in Safari</b> or <b>Open in browser</b>.");
    why.textContent = apple ? "An iPhone does not let a website download itself, so it takes a few taps. It is free and takes a few seconds."
      : "It is free and takes a few seconds.";
    steps.innerHTML = list.map(s => "<li><span>" + s + "</span></li>").join("");
    if (sheet.showModal) sheet.showModal(); else sheet.setAttribute("open", "");
  };
  btn.addEventListener("click", () => { if (offer) { const o = offer; offer = null; o.prompt(); return; } show(); });
  if (done) done.addEventListener("click", () => { if (sheet.close) sheet.close(); else sheet.removeAttribute("open"); });
  sheet.addEventListener("click", e => { if (e.target === sheet && sheet.close) sheet.close(); }); // a tap outside the sheet closes it
})();
})();
