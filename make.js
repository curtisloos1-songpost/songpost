(function(){
"use strict";
const CHIPS = {
  occasion: ["A favorite memory","Our story","Birthday","Anniversary","Thank you","Just because","Wedding","New baby","Graduation","Get well","Miss you"],
  tone: ["Heartfelt","Funny","Nostalgic","Grateful","Romantic","Playful","Proud","Uplifting","Tender","Bittersweet"],
  genre: ["Acoustic folk","Country","Pop","R&B","Rock","Gospel","Jazz","Hip-hop","Tejano","Lullaby"],
  voice: ["No preference","A man's voice","A woman's voice","A duet"],
  language: ["English","Spanish","French","German","Portuguese","Italian","Japanese"]
};
// How many of each are shown before "More". The rest are one tap away.
const SHOW = { occasion: 6, tone: 5, genre: 5, language: 2 };
const blank = () => ({recipient:"",relationship:"",occasion:"A favorite memory",sender:"",a1:"",a2:"",a3:"",a4:"",sayName:"",email:"",
  tone:"Heartfelt",genre:"Acoustic folk",voice:"No preference",language:"English",inspiration:"",title:"",lyrics:"",style:"",note:""});
const DRAFT_KEY = "songpost-draft-v5", ORDER_KEY = "songpost-order-v2", MINE_KEY = "songpost-mine-v1";

let draft = blank();   // what the sender has typed
let ref = null;        // { id, key } of the song being made, kept on this device
let view = null;       // the server's view of that song
let site = { priceGoldCents: 2499, pricePlatinumCents: 3999, previewSeconds: 30, takesPerOrder: 2, testCheckout: false, messaging: false, scheduling: false, redoDays: 7, lyricsEstimateSeconds: 20 };
let step = -1, tier = "song", pollTimer = null, doneTimer = null, busy = false, previewSrc = "";
// Today's date where the customer is, as YYYY-MM-DD.
const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

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

function updateRecord(){ $("#make-record").innerHTML = recordSVG(draft); }

/* ---------- choices ---------- */
// Style and tone can each be one choice or a blend of two, stored as "Country and Pop".
const BLENDS = { genre: true, tone: true };
function listOf(field){ return String(draft[field] || "").split(" and ").map(s => s.trim()).filter(Boolean); }
const SHAPE_WORD = { heart: "a heart", star: "a star", sun: "a sun", burst: "a burst" };
function paintChips(){
  $("#shape-note").textContent = "On their page, " + SHAPE_WORD[shapeFor(draft.tone)] + " opens around the record when the song starts.";
  $$(".chips[data-field]").forEach(box => {
    const field = box.dataset.field, sel = BLENDS[field] ? listOf(field) : [draft[field]];
    $$(".chip:not(.more)", box).forEach(b => b.setAttribute("aria-pressed", String(sel.indexOf(b.textContent) >= 0)));
    // a choice that lives under "More" opens the list, so it is never hidden while selected
    if (box.classList.contains("collapsed") && $$(".chip.extra", box).some(b => sel.indexOf(b.textContent) >= 0)){
      box.classList.remove("collapsed"); const m = $(".chip.more", box); if (m) m.remove();
    }
  });
}
function pickChip(field, opt){
  if (BLENDS[field]){
    let sel = listOf(field);
    if (sel.indexOf(opt) >= 0){ if (sel.length > 1) sel = sel.filter(x => x !== opt); }
    else { sel.push(opt); if (sel.length > 2) sel.shift(); }
    draft[field] = sel.join(" and ");
  } else draft[field] = opt;
  paintChips(); saveDraft(); updateRecord();
  if (field === "occasion") applyOccasion();
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
  "": ["What should the song say?", [
    ["What do you love most about them?", "He shows up for everyone, every time"],
    ["A moment with them you'll never forget", "The road trip when the truck broke down"],
    ["Something they always say or do", "He ends every call with \"be good\""],
    ["What do you want them to know?", "That I noticed all of it"]]]
};
function questions(){ return QUESTIONS[draft.occasion] || QUESTIONS[""]; }
function applyOccasion(){
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
  paintChips(); applyOccasion(); updateRecord();
}
$$("[data-bind]").forEach(e => e.addEventListener("input", () => {
  draft[e.dataset.bind] = e.value; saveDraft();
  const st = e.closest(".step"), er = st && $(".err", st); if (er) er.textContent = ""; // a fixed field clears its warning
  if (["recipient","sender","title"].indexOf(e.dataset.bind) >= 0) updateRecord();
}));

/* ---------- moving through the steps ---------- */
function go(n){
  if (n !== 4) stopProgress();
  if (n !== 5) clearInterval(doneTimer);
  step = n;
  $("#view-make").dataset.step = String(n);
  $$(".step").forEach(s => { s.hidden = Number(s.dataset.step) !== n; });
  $("#restart-confirm").hidden = true;
  $("#hero").hidden = n !== -1;
  $("#form-sheet").hidden = n === -1;
  $("#progress").hidden = n > 4;
  $("#step-label").textContent = "Step " + (Math.max(n, 0) + 1) + " of 5";
  $("#bar-fill").style.width = ((Math.max(n, 0) + 1) * 20) + "%";
  $$(".err").forEach(e => { e.textContent = ""; });
  if (n === 2) $("#keep-btn").hidden = !draft.lyrics.trim();
  if (n === 3) $("#record-btn").textContent = ref ? "Record with these lyrics" : "Record my song";
  if (n !== 4){ if (previewAudio) previewAudio.pause(); $("#make-record").classList.remove("spinning"); }
  if (n > 0) $("#progress").scrollIntoView({ block: "start" }); else window.scrollTo(0, 0);
}
function validate(n){
  if (n === 0){
    if (!draft.recipient.trim()) return "Add their name so the song can use it.";
    if (!draft.sender.trim()) return "Add your name so they know who it's from.";
  }
  if (n === 1 && storyParts().map(p => p[1]).join(" ").length < 20) return "Answer at least one question, in a sentence or two.";
  return "";
}
$$("[data-next]").forEach(b => b.addEventListener("click", () => {
  const msg = validate(step);
  if (msg){ $(".err", b.closest(".step")).textContent = msg; return; }
  go(step + 1);
}));
$$("[data-back]").forEach(b => b.addEventListener("click", () => go(step - 1)));
$("#back-from-lyrics").addEventListener("click", () => go(ref ? 4 : 2));
$("#keep-btn").addEventListener("click", () => go(3));
$("#begin-btn").addEventListener("click", () => { track("started"); go(0); });

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
const brief = () => ({ recipient: draft.recipient, sender: draft.sender, relationship: draft.relationship, occasion: draft.occasion,
  tone: draft.tone, genre: draft.genre, voice: draft.voice, language: draft.language, sayName: draft.sayName, inspiration: draft.inspiration,
  contact: draft.email, answers: storyParts().map(p => ({ q: p[0], a: p[1] })) });
async function writeLyrics(again){
  if (busy) return; busy = true;
  const btn = again ? $("#again-btn") : $("#write-btn");
  const err = again ? $("#record-err") : $("#write-err");
  err.textContent = ""; btn.disabled = true; $("#keep-btn").hidden = true;
  startProgress(site.lyricsEstimateSeconds || 20, 0, again ? $("#again-progress") : $("#write-progress"), "writing");
  $("#make-record").classList.add("spinning");
  let ok = false;
  try {
    const out = await api("/api/lyrics", { method: "POST", body: { brief: brief(), again: again ? draft.title : undefined } });
    draft.title = out.title; draft.lyrics = out.lyrics; draft.style = out.style;
    saveDraft(); syncInputs(); track("lyrics"); ok = true;
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
  if (!contactKind(draft.email)){ err.textContent = draft.email.trim() ? "That doesn't look like an email or a mobile number. Check it and try again." : "Add your email or mobile number so we can send you the link to your song."; return; }
  busy = true; btn.disabled = true; err.textContent = "";
  $("#again-status").textContent = "Checking the words, then starting the recording.";
  try {
    if (!ref){
      ref = await api("/api/orders", { method: "POST", body: { brief: brief(), title: draft.title, lyrics: draft.lyrics, style: draft.style } });
      save(ORDER_KEY, ref);
      view = await call("/api/orders/" + ref.id);
    } else {
      view = await call("/api/orders/" + ref.id + "/retake", { method: "POST", body: { title: draft.title, lyrics: draft.lyrics } });
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
  draft.title = view.title; draft.lyrics = view.lyrics; saveDraft();
  $$('[data-bind="title"],[data-bind="lyrics"]').forEach(e => { e.value = draft[e.dataset.bind]; });
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
  const msg = (info.recipient ? info.recipient + ", " : "") + "I made you a song. Press play: " + url;
  draft.recipient = info.recipient || draft.recipient; draft.sender = info.sender || draft.sender; draft.title = info.title || draft.title;
  updateRecord(); $("#make-record").dataset.metal = info.tier === "platinum" ? "platinum" : "gold";
  const plate = $("#done-plate"); plate.dataset.metal = info.tier === "platinum" ? "platinum" : "gold";
  $("#done-p1").textContent = "Presented to " + name;
  $("#done-p2").textContent = longDate(info.paidAt || Date.now());
  $("#done-p").textContent = "Send " + name + " this link. It opens a page with the song, your note, and the lyrics.";
  $("#gift-link").value = url;
  $("#sms-link").href = "sms:?&body=" + encodeURIComponent(msg);
  $("#mail-link").href = "mailto:?subject=" + encodeURIComponent("I made you a song") + "&body=" + encodeURIComponent(msg);
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
}

/* ---------- after paying: the Platinum second take, and the one free redo ---------- */
function renderExtras(finished){
  const box = $("#extra-box"), note = $("#extra-note"), redo = $("#redo-box"), second = $("#second-btn");
  box.hidden = true; redo.hidden = true; second.hidden = true; note.textContent = ""; $("#redo-err").textContent = "";
  if (!(ref && view && view.id === ref.id && view.paid)) return; // needs this device's key to the song
  const name = view.recipient || "them", platinum = view.tier === "platinum";
  if (view.status === "generating"){
    box.hidden = false;
    note.textContent = view.kind === "redo"
      ? "Recording your song again. The link stays the same, and the new recording takes the place of the old one when it's done."
      : "Recording the second take that comes with your Platinum record. It appears on " + name + "'s page when it's done.";
    startProgress(view.estimateSeconds, view.elapsedSeconds, $("#extra-progress"), "recording");
    $("#make-record").classList.add("spinning");
    pollDone(); return;
  }
  stopProgress(); $("#make-record").classList.remove("spinning");
  const lines = [];
  if (finished && view.error) lines.push(view.error + (finished === "redo" ? " Your free redo has not been used." : ""));
  if (finished === "redo" && !view.error) lines.push("Your new recording is ready, on the same link.");
  if (finished === "second" && !view.secondTakeMissing) lines.push("Both takes are now on " + name + "'s page.");
  if (view.secondTakeMissing){ lines.push("Your Platinum record comes with a second take, and it hasn't been recorded yet."); second.hidden = false; }
  const used = view.redo && view.redo.used;
  if (used) lines.push("You've used the free redo for this song.");
  note.textContent = lines.join(" ");
  if (used){ const a = el("a", null, "redo and refund policy"); a.href = "/refunds"; note.append(" If it still isn't right, see the ", a, "."); }
  box.hidden = !lines.length;
  if (view.redo && view.redo.available){
    redo.hidden = false;
    $("#redo-lede").textContent = "Free until " + longDate(view.redo.until) + ". The new recording takes the place of the current one on the same link"
      + (platinum ? ", and your earlier takes stay on the page." : ".");
    $("#redo-title").value = view.title || ""; $("#redo-lyrics").value = view.lyrics || "";
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
async function loadVoices(){
  let list = [];
  try { const r = await fetch("/testimonials.json"); if (r.ok) list = await r.json(); } catch (e) {}
  list = (Array.isArray(list) ? list : []).filter(v => v && typeof v.quote === "string" && v.quote.trim());
  const box = $("#voices");
  list.slice(0, 3).forEach(v => {
    const fig = el("figure", "voice"); fig.append(el("blockquote", null, v.quote.trim()));
    if (typeof v.name === "string" && v.name.trim()) fig.append(el("figcaption", null, v.name.trim()));
    box.append(fig);
  });
  box.hidden = !box.children.length;
  if (list[0]){
    const f = $("#founder");
    $("blockquote", f).textContent = list[0].quote.trim(); $("figcaption", f).textContent = (list[0].name || "").trim();
    f.hidden = false;
  }
}

/* ---------- start ---------- */
async function resume(){
  try { view = await call("/api/orders/" + ref.id); }
  catch (e) { ref = null; save(ORDER_KEY, null); return go(-1); }
  if (view.paid) return showDone(view);
  draft.recipient = view.recipient; draft.sender = view.sender; draft.occasion = view.occasion; draft.genre = view.genre; draft.tone = view.tone || draft.tone;
  if (view.note && !draft.note) draft.note = view.note;
  syncInputs(); go(4); renderListen(); poll();
}
async function init(){
  const saved = load(DRAFT_KEY);
  if (saved && typeof saved === "object") for (const k in draft) if (typeof saved[k] === "string") draft[k] = saved[k];
  buildChips(); syncInputs(); go(-1);
  try { site = Object.assign(site, await api("/api/config")); } catch (e) {}
  $(".fine").textContent = "About five minutes. You hear it before you pay. Songs from " + money(site.priceGoldCents) + ".";
  loadVoices();
  const q = new URLSearchParams(location.search), oid = q.get("order"), key = q.get("key"), sid = q.get("session_id");
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
    try { view = await call("/api/orders/" + ref.id); } catch (e) { ref = null; save(ORDER_KEY, null); return; }
    if (view.paid){ ref = null; view = null; save(ORDER_KEY, null); return; } // a finished song: start fresh
    return resume();
  }
}
init();
})();
