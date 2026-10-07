(function(){
"use strict";
const root = document.getElementById("gift");
const id = location.pathname.split("/").filter(Boolean).pop();
const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The sender looking at their own gift page must not be taken for the person the song is for.
// They arrive with ?sender=1 from the "See their page" button, or on the device the song was made on.
let fromSender = new URLSearchParams(location.search).has("sender");
try { if ((JSON.parse(localStorage.getItem("songpost-mine-v1") || "[]") || []).indexOf(id) >= 0) fromSender = true; } catch (e) {}


api("/api/gift/" + encodeURIComponent(id)).then(g => {
  root.textContent = "";
  const metal = g.tier === "platinum" ? "platinum" : "gold";
  // Someone who goes on to make a song from here is counted as coming from this gift. The sender's own visit is not.
  const makeHref = fromSender ? "/" : "/?from=" + encodeURIComponent(id);

  /* ---------- how it arrives: an envelope with their name on it, closed with a seal ---------- */
  const arrive = el("div", "arrive");
  arrive.append(el("p", "for", "A song for you, from " + g.sender));
  const env = el("div", "env"); env.dataset.metal = metal;
  const front = el("div", "env-front");
  const nm = el("span", "env-name", g.recipient); nm.dir = "auto";
  nm.style.fontSize = Math.max(1.05, Math.min(2.3, 15 / Math.max(g.recipient.length, 5))).toFixed(2) + "rem"; // a long name is written smaller
  front.append(el("span", "env-for", "for"), nm);
  const flap = el("div", "env-flap"); flap.append(el("i"));
  const seal = el("button", "seal"); seal.type = "button"; seal.setAttribute("aria-label", "Open your song");
  // The seal is the Songpost record: gold or platinum, like the one inside. When the envelope opens it turns and lifts away.
  seal.innerHTML = '<svg class="seal-rec" viewBox="0 0 200 200" aria-hidden="true" focusable="false"><defs><radialGradient id="seal-shine" cx="34%" cy="28%" r="82%">'
    + '<stop offset="0" stop-color="#fff" stop-opacity=".8"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></radialGradient></defs>'
    + '<circle cx="100" cy="100" r="96" fill="var(--disc)"/><circle cx="100" cy="100" r="96" fill="url(#seal-shine)"/>'
    + '<circle cx="100" cy="100" r="96" fill="none" stroke="var(--disc-edge)" stroke-width="4"/>'
    + '<circle cx="100" cy="100" r="83" fill="none" stroke="var(--groove)" stroke-width="2"/><circle cx="100" cy="100" r="72" fill="none" stroke="var(--groove)" stroke-width="2"/>'
    + '<circle cx="100" cy="100" r="58" fill="#fff" stroke="var(--disc-edge)" stroke-width="2"/>'
    + '<path d="M0,-30C-25,-75 -100,-55 -100,-5C-100,45 -40,75 0,110C40,75 100,45 100,-5C100,-55 25,-75 0,-30Z" transform="translate(100 100) scale(.42) translate(0 -18)" fill="#0E2A33"/></svg>';
  env.append(el("div", "env-back"), front, flap, seal);
  const hint = el("p", "env-hint", "Tap the seal to open it. Your song starts playing.");
  arrive.append(env, hint);
  if (fromSender) arrive.append(el("p", "status-line preview-note", "You're looking at " + g.recipient + "'s page as the sender. Opening it here isn't counted as their first listen."));
  root.append(arrive);

  /* ---------- what is inside ---------- */
  const inside = el("div", "inside"); inside.hidden = true; root.append(inside);
  inside.append(el("p", "for", "A song for"));
  const h1 = el("h1", null, g.recipient); h1.dir = "auto"; inside.append(h1);
  inside.append(el("p", "by", "from " + g.sender));
  if (g.fromAll) inside.append(el("p", "from-all", "From " + g.fromAll)); // a song made together: everyone it is from

  const rec = el("div", "record"); rec.dataset.metal = metal; setRecord(rec, g);
  const shape = shapeFor(g.tone);
  const stage = el("div", "rec-stage sealed shape-" + shape); stage.innerHTML = shapeSVG(shape); stage.append(rec);
  // Platinum: the photo the sender chose. The record is presented first, on its own. As the singing starts the record
  // gives way and the photo appears in its place, like a print developing. Two dots under it switch between the two,
  // and a tap on the photo shows it larger. The photo is always shown whole.
  const stageRow = el("div", "g-stage");
  let photoAt = () => {}, photoReady = false;
  if (g.photoUrl){
    const fig = el("button", "g-photo"), im = el("img"); fig.type = "button"; fig.setAttribute("aria-label", "See the photo from " + g.sender + " larger"); fig.tabIndex = -1;
    im.alt = "A photo from " + g.sender;
    const dots = el("div", "g-dots"), dRec = el("button"), dPic = el("button");
    dRec.type = dPic.type = "button"; dRec.setAttribute("aria-label", "Show the record"); dPic.setAttribute("aria-label", "Show the photo from " + g.sender);
    dots.append(dRec, dPic); dots.hidden = true;
    let shown = false, auto = true, due = false;
    const show = on => {
      shown = on; stageRow.classList.toggle("show-photo", on); fig.tabIndex = on ? 0 : -1;
      dRec.setAttribute("aria-pressed", String(!on)); dPic.setAttribute("aria-pressed", String(on));
    };
    im.addEventListener("load", () => { photoReady = true; stageRow.classList.add("has-photo"); dots.hidden = false; show(false); if (due && auto){ auto = false; show(true); } });
    im.addEventListener("error", () => { fig.remove(); dots.remove(); stageRow.classList.remove("has-photo", "show-photo"); photoAt = () => {}; });
    im.src = g.photoUrl; // fetched now, while the envelope is still closed, so it is ready for its moment
    dRec.addEventListener("click", () => { auto = false; show(false); });
    dPic.addEventListener("click", () => { auto = false; show(true); });
    rec.addEventListener("click", () => { if (photoReady){ auto = false; show(true); } });
    // Called with the song's time. The photo arrives just as the first line is sung; the sender's spoken words, when
    // there are some, are heard over the record. The record always has at least four seconds to itself, and the photo
    // never waits more than ten. With no timings it arrives five seconds in.
    photoAt = (t, first) => { if (!auto) return; if (t >= (Number.isFinite(first) ? Math.min(10, Math.max(4, first - 0.4)) : 5)){ due = true; if (photoReady){ auto = false; show(true); } } };
    fig.append(im); stageRow.append(fig);
    const big = el("dialog", "photo-big"), bigIm = el("img"); bigIm.alt = im.alt; big.append(bigIm); document.body.append(big);
    fig.addEventListener("click", () => { if (!shown || !big.showModal) return; bigIm.src = g.photoUrl; big.showModal(); });
    big.addEventListener("click", () => big.close());
    stageRow.dots = dots;
  }
  stageRow.prepend(stage); inside.append(stageRow);
  if (stageRow.dots) inside.append(stageRow.dots);

  const plate = el("div", "plate"); plate.dataset.metal = metal;
  plate.append(el("span", "p1", "Presented to " + g.recipient), el("span", "p2", longDate(g.paidAt)));
  inside.append(plate);

  const sheet = el("div", "sheet"); inside.append(sheet);
  const titleLine = el("p", "g-title", g.title || ""); titleLine.hidden = !g.title; sheet.append(titleLine);
  const ly = el("div", "g-lyrics");
  // The words as they are sung: the line being sung, with the one before and the one after. Shown when the song came
  // with its timings. All the words are still there to read, a tap away; without timings they are simply shown.
  const kara = el("div", "kara"); kara.hidden = true; kara.setAttribute("aria-hidden", "true"); // read in full below by a screen reader
  const karaLines = el("div", "kara-lines"); kara.append(karaLines);
  const allWords = el("details", "g-all plain"); allWords.open = true;
  const allSum = el("summary"); allSum.append(el("span", null, "All the words")); allWords.append(allSum, ly);
  let sungAt = null, sungNow = -2;
  const placeLine = () => {
    const items = karaLines.children; if (!items.length || kara.hidden) return;
    const at = items[Math.max(0, sungNow)];
    karaLines.style.transform = "translateY(" + Math.round(kara.clientHeight / 2 - at.offsetTop - at.offsetHeight / 2) + "px)";
  };
  const showLine = i => {
    if (i === sungNow) return; sungNow = i;
    Array.from(karaLines.children).forEach((p, k) => { p.classList.toggle("on", k === i); p.classList.toggle("near", Math.abs(k - Math.max(0, i)) === 1 || (i < 0 && k === 0)); });
    placeLine();
  };
  const follow = t => {
    if (!sungAt) return;
    let i = -1; while (i + 1 < sungAt.length && sungAt[i + 1] <= t + 0.3) i++; // a touch early, so the line is up as it starts
    showLine(i);
  };
  window.addEventListener("resize", placeLine);

  // Platinum: every recording is kept, and the listener can switch between them.
  const box = el("div");
  let audio = null, heard = false;
  const played = () => {
    if (heard || fromSender) return;
    heard = true; api("/api/gift/" + encodeURIComponent(id) + "/played", { method: "POST" }).catch(() => {});
  };
  const saveLink = el("a", "share s-save", "Save"); saveLink.setAttribute("download", ""); saveLink.setAttribute("aria-label", "Save the song");
  // Platinum: the lyric sheet, made to print and frame. It follows the take being played.
  const sheetLink = el("a", "share s-sheet", "Lyric sheet"); sheetLink.target = "_blank"; sheetLink.rel = "noopener"; sheetLink.setAttribute("aria-label", "Lyric sheet to print and frame");
  // The sender's own voice, heard once before the song. It can be heard again from a small button under the player.
  const again = el("button", "btn quiet small voice-again", "Hear " + g.sender + "'s message again"); again.type = "button"; again.hidden = true;
  again.addEventListener("click", () => { if (audio && audio.playIntro) audio.playIntro(); });
  let voiceOk = !!g.voiceUrl; // false once the recording turns out not to play
  // Each take carries its own words, which differ when the lyrics were changed between takes.
  let cur = { title: g.title, lyrics: g.lyrics, n: null }; // what is on the page now, for the email
  function useTake(url, title, lyrics, n, first, starts){
    if (audio) audio.pause();
    cur = { title: title || "", lyrics: lyrics || "", n: n };
    const intro = voiceOk ? { src: g.voiceUrl, label: "A message from " + g.sender, auto: !!first, onDone: () => { again.hidden = false; }, onBroken: () => { voiceOk = false; again.hidden = true; } } : null;
    audio = mountAudio(box, url, "Play the song", rec, played, intro);
    saveLink.href = url + (url.indexOf("?") >= 0 ? "&" : "?") + "download=1";
    if (g.sheetUrl) sheetLink.href = g.sheetUrl + (n != null ? "?take=" + n : "");
    titleLine.textContent = title || ""; titleLine.hidden = !title;
    ly.textContent = ""; lyricsInto(ly, lyrics);
    const lines = String(lyrics || "").split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^\[.+\]$/.test(l));
    const timed = Array.isArray(starts) && starts.length === lines.length && lines.length > 1;
    sungAt = timed ? starts : null; sungNow = -2;
    karaLines.textContent = ""; kara.hidden = !timed;
    allWords.classList.toggle("plain", !timed); allWords.open = !timed;
    if (timed){ lines.forEach(t => { const p = el("p", "kl", t); p.dir = "auto"; karaLines.append(p); }); showLine(-1); }
    const firstLine = timed ? starts[0] : NaN;
    audio.onSongTime = t => { if (timed) follow(t); photoAt(t, firstLine); };
  }
  if (g.takes && g.takes.length > 1){
    const takes = el("div", "takes");
    g.takes.forEach((t, i) => {
      const b = el("button", "chip", "Take " + (i + 1)); b.type = "button";
      b.setAttribute("aria-pressed", String(t.chosen));
      b.addEventListener("click", () => {
        Array.from(takes.children).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
        useTake(t.url, t.title || g.title, t.lyrics || g.lyrics, t.n, false, t.lineStarts); again.hidden = !voiceOk; audio.play().catch(() => {});
      });
      takes.append(b);
    });
    sheet.append(takes);
  }
  sheet.append(box, kara);
  if (g.voiceUrl) sheet.append(again);
  useTake(g.audioUrl, g.title, g.lyrics, null, true, g.lineStarts);

  /* The words by email, to keep. With a mail service connected we send it to the address they type.
     Without one, their own mail app opens with the email already written, for them to send to themselves. */
  const giftLink = location.origin + "/g/" + encodeURIComponent(id);
  const mailBtn = el("button", "share s-mail", "Email"); mailBtn.type = "button"; mailBtn.setAttribute("aria-label", "Email this to myself"); mailBtn.setAttribute("aria-expanded", "false");
  const mailBox = el("div", "mail-me"); mailBox.hidden = true;
  const mailSaid = el("p", "status-line"); mailSaid.setAttribute("role", "status");
  const copyBtn = el("button", "btn quiet small", "Copy the link instead"); copyBtn.type = "button";
  copyBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(giftLink); mailSaid.textContent = "Link copied. Paste it into an email to yourself."; }
    catch (e) { mailSaid.textContent = "Copy this link: " + giftLink; }
  });
  // The email their own mail app opens with. A phone takes the words too; a computer's mail app can refuse a long one, so there it carries the links.
  function mailtoHref(){
    const head = [cur.title ? '"' + cur.title + '"' : "Your song", "A song for " + g.recipient + ", from " + (g.fromAll || g.sender), "", "Listen to it here: " + giftLink];
    if (g.sheetUrl) head.push("Lyric sheet to print and frame: " + location.origin + g.sheetUrl + (cur.n != null ? "?take=" + cur.n : ""));
    const words = String(cur.lyrics || "").split(/\r?\n/).map(l => l.trim()).filter(l => !/^\[.+\]$/.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    const subject = cur.title ? 'The words to "' + cur.title + '"' : "The words to my song";
    const make = body => "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body.join("\r\n"));
    const full = make(head.concat(["", words]));
    const phone = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    return phone || full.length <= 1900 ? full : make(head.concat(["", "The words are on the page."]));
  }
  if (g.canEmail){
    const f = el("form", "mail-row"); f.noValidate = true;
    const addr = el("input"); addr.type = "email"; addr.autocomplete = "email"; addr.inputMode = "email"; addr.maxLength = 200;
    addr.placeholder = "Your email address"; addr.setAttribute("aria-label", "Your email address");
    const go = el("button", "btn small primary", "Send it to me"); go.type = "submit";
    f.append(addr, go);
    f.addEventListener("submit", async e => {
      e.preventDefault();
      if (contactKind(addr.value) !== "email"){ mailSaid.textContent = "Type your email address first."; addr.focus(); return; }
      go.disabled = true; mailSaid.textContent = "Sending.";
      try {
        await api("/api/gift/" + encodeURIComponent(id) + "/email", { method: "POST", body: { email: addr.value.trim(), take: cur.n } });
        mailSaid.textContent = "Sent to " + addr.value.trim() + ". It can take a minute. If you don't see it, look in your junk folder.";
        f.hidden = true;
      } catch (err) { mailSaid.textContent = err.message; go.disabled = false; }
    });
    mailBox.append(f, mailSaid, el("p", "status-line", "You get the words and the link to this page. We use your address for this one email only."));
    mailBtn.addEventListener("click", () => {
      mailBox.hidden = !mailBox.hidden; mailBtn.setAttribute("aria-expanded", String(!mailBox.hidden));
      if (!mailBox.hidden){ f.hidden = false; go.disabled = false; addr.focus(); }
    });
  } else {
    mailBox.append(mailSaid, copyBtn);
    mailBtn.addEventListener("click", () => {
      const a = el("a"); a.href = mailtoHref(); a.hidden = true; document.body.append(a); a.click(); a.remove(); // a plain link, so the phone hands it to its mail app
      mailBox.hidden = false; mailBtn.setAttribute("aria-expanded", "true");
      mailSaid.textContent = "Your mail app should open with the email written. Put in your own address and send it. Nothing opened?";
      if (!fromSender) api("/api/gift/" + encodeURIComponent(id) + "/emailed", { method: "POST" }).catch(() => {});
    });
  }

  // One tap to tell the sender how it felt. No typing. Each reaction can be sent once from this device.
  if (!fromSender && Array.isArray(g.tapChoices) && g.tapChoices.length){
    const TAP_KEY = "songpost-taps-v1";
    let sentAll = {}; try { sentAll = JSON.parse(localStorage.getItem(TAP_KEY) || "{}") || {}; } catch (e) {}
    const mine = Array.isArray(sentAll[id]) ? sentAll[id] : [];
    const wrap = el("div", "taps"), row = el("div", "taps-row"); row.setAttribute("role", "group");
    const say = el("p", "taps-say", mine.length ? g.sender + " will see it" : "Tell " + g.sender + " how it felt"); say.setAttribute("role", "status");
    row.setAttribute("aria-label", "Send " + g.sender + " a reaction");
    g.tapChoices.forEach(e => {
      const b = el("button", "tap", e); b.type = "button"; b.setAttribute("aria-label", "Send " + g.sender + " " + e); b.setAttribute("aria-pressed", String(mine.indexOf(e) >= 0));
      b.addEventListener("click", async () => {
        if (b.getAttribute("aria-pressed") === "true") return;
        b.setAttribute("aria-pressed", "true"); burst(b, [e], 7); say.textContent = g.sender + " will see it";
        try {
          await api("/api/gift/" + encodeURIComponent(id) + "/tap", { method: "POST", body: { emoji: e } });
          mine.push(e); sentAll[id] = mine; try { localStorage.setItem(TAP_KEY, JSON.stringify(sentAll)); } catch (x) {}
        } catch (err) { b.setAttribute("aria-pressed", "false"); say.textContent = err.message; }
      });
      row.append(b);
    });
    wrap.append(say, row); sheet.append(wrap);
  }
  const keep = el("div", "keep"), acts = el("div", "g-acts");
  acts.append(saveLink);
  if (g.sheetUrl) acts.append(sheetLink);
  acts.append(mailBtn);
  keep.append(acts, el("p", "status-line", "Save the song to keep it. This page may not stay online."), mailBox);
  sheet.append(keep);

  // The note, signed: in the sender's own hand when they signed it, else with their name.
  if (g.note || g.signature){
    const note = el("div", "g-note");
    if (g.note) note.append(el("p", null, g.note));
    if (g.signature){
      const s = el("div", "g-sig");
      if (Array.isArray(g.signature)) s.innerHTML = sigSVG(g.signature);                  // an older signature, drawn by hand
      else s.append(el("span", "sigt sigf-" + g.signature.font, g.signature.text));      // typed, in the handwriting they chose
      note.append(s);
    }
    else note.append(el("p", "sig", g.sender));
    sheet.append(note);
  }
  // The sender's own words: one or two of the answers they gave, chosen by them.
  if (g.words && g.words.length){
    const card = el("div", "g-words");
    card.append(el("h3", null, g.together ? "What we were told about you" : "What " + g.sender + " told us about you"));
    g.words.forEach(w => {
      const item = el("div", "gw");
      const a = el("p", "gw-a", w.a); a.dir = "auto";
      item.append(el("p", "gw-q", w.q), a); card.append(item);
    });
    sheet.append(card);
  }
  sheet.append(allWords);
  window.addEventListener("beforeprint", () => { allWords.open = true; }); // the printed page always carries the words

  // A few words back to the sender.
  const reply = el("div", "reply");
  reply.append(el("h3", null, "Tell " + g.sender + " what you thought"));
  const words = el("textarea"); words.maxLength = 600; words.setAttribute("aria-label", "Your message to " + g.sender);
  const share = el("label", "check"); const cb = el("input"); cb.type = "checkbox";
  share.append(cb, document.createTextNode(" Songpost may share my words and first name with others"));
  // The sender has allowed the photo on this page to be shown with these words. It needs this person's yes too.
  const share2 = el("label", "check"); const cb2 = el("input"); cb2.type = "checkbox"; cb2.disabled = true;
  share2.append(cb2, document.createTextNode(" Songpost may also show the photo on this page with my words"));
  share2.hidden = !(g.photoAsk && g.photoUrl);
  cb.addEventListener("change", () => { cb2.disabled = !cb.checked; if (!cb.checked) cb2.checked = false; });
  const sendBtn = el("button", "btn primary", "Send to " + g.sender); sendBtn.type = "button";
  const sent = el("p", "status-line"); sent.setAttribute("role", "status");
  sendBtn.addEventListener("click", async () => {
    if (!words.value.trim()){ sent.textContent = "Write a few words first."; return; }
    sendBtn.disabled = true;
    try {
      await api("/api/gift/" + encodeURIComponent(id) + "/reply", { method: "POST", body: { body: words.value, shareOk: cb.checked, photoOk: cb.checked && cb2.checked } });
      sent.textContent = g.together ? (g.replyIsSent ? "Sent. " : "Saved. ") + "Everyone who made the song will see it."
        : g.replyIsSent ? "Sent to " + g.sender + "." : "Saved for " + g.sender + ". They'll see it on their page for this song.";
      words.readOnly = true; share.hidden = true; share2.hidden = true; rrow.hidden = true;
      // The moment after saying thank you is the one time we ask: is there someone they would like to do this for?
      if (!fromSender){
        pass.textContent = "";
        pass.append(el("span", null, "Is there someone you'd like to surprise the same way? "));
        const go = el("a", "btn", "Make a song for someone"); go.href = makeHref; pass.append(go);
        reply.after(pass);
      }
    } catch (e) { sent.textContent = e.message; sendBtn.disabled = false; }
  });
  const rrow = el("div", "row"); rrow.append(sendBtn);
  reply.append(words, share, share2, rrow, sent); sheet.append(reply);

  /* ---------- a video back to the sender ----------
     The person the song is for can record themselves for the sender: as they open it, or afterwards.
     The camera is only ever turned on by their own tap. Nothing leaves this device until they press send. */
  const canFilm = !fromSender && g.reactionsLeft > 0 && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof window.MediaRecorder === "function";
  const MAX_FILM = 90; // seconds
  let film = null;  // while the camera is on: { stream, state: "live" | "rec" | "stopping", rec, chunks, started, timer }
  let clip = null;  // a finished recording waiting to be sent: { blob, url, secs }
  let armed = false; // the camera was turned on before opening, so recording starts with the seal
  const pill = el("div", "film-pill"); pill.hidden = true;
  const pillView = el("video"); pillView.muted = true; pillView.autoplay = true; pillView.playsInline = true; pillView.setAttribute("playsinline", ""); pillView.setAttribute("aria-label", "You, on camera");
  const pillSay = el("span", "film-say"); pillSay.setAttribute("role", "status");
  const pillGo = el("button", "btn small primary", "Start recording"); pillGo.type = "button";
  const pillStop = el("button", "btn small", "Cancel"); pillStop.type = "button";
  pill.append(pillView, pillSay, pillGo, pillStop);
  const react = el("div", "react");
  const reactBtn = el("button", "btn", "Record a video for " + g.sender); reactBtn.type = "button";
  const review = el("div", "react-review"); review.hidden = true;
  const reviewVid = el("video"); reviewVid.controls = true; reviewVid.playsInline = true; reviewVid.setAttribute("playsinline", "");
  const shareV = el("label", "check"), cbV = el("input"); cbV.type = "checkbox";
  shareV.append(cbV, document.createTextNode(" Songpost may show this video to others, after looking at it first"));
  const sendV = el("button", "btn primary", "Send it to " + g.sender); sendV.type = "button";
  const againV = el("button", "btn", "Record again"); againV.type = "button";
  const dropV = el("button", "btn quiet", "Delete it"); dropV.type = "button";
  const reactNote = el("p", "status-line"); reactNote.setAttribute("role", "status");
  const vrow = el("div", "row"); vrow.append(sendV, againV, dropV);
  review.append(reviewVid, shareV, vrow);
  react.append(el("h3", null, "Show " + g.sender + " your reaction"),
    el("p", "status-line", "Record a short video, up to a minute and a half. Only " + g.sender + " sees it, unless you tick the box. Nothing is sent until you press send."),
    reactBtn, review, reactNote);

  function stopCamera(){
    if (!film) return;
    clearInterval(film.timer); film.stream.getTracks().forEach(t => t.stop());
    pillView.srcObject = null; pill.hidden = true; film = null; armed = false;
    cameraOff();
  }
  let cameraOff = () => {}; // puts the line under the envelope back, if it was cancelled before opening
  async function camera(){ // true once the camera is on and showing
    if (film) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: true });
      film = { stream, state: "live" }; pillView.srcObject = stream; pill.hidden = false;
      pillGo.hidden = false; pillStop.textContent = "Cancel"; pillSay.textContent = "You're on camera.";
      return true;
    } catch (e) { return false; }
  }
  function startFilm(){
    if (!film || film.state !== "live") return;
    // MP4 where the browser can make one (it plays everywhere), else WebM.
    const type = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp8,opus", "video/webm"].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } }) || "";
    let rec;
    try { rec = new MediaRecorder(film.stream, Object.assign({ videoBitsPerSecond: 900000, audioBitsPerSecond: 64000 }, type ? { mimeType: type } : {})); }
    catch (e) { try { rec = new MediaRecorder(film.stream); } catch (x) { stopCamera(); reactNote.textContent = "This device couldn't record a video."; return; } }
    const f = film; f.rec = rec; f.chunks = []; f.started = Date.now(); f.state = "rec";
    rec.ondataavailable = e => { if (e.data && e.data.size) f.chunks.push(e.data); };
    rec.onstop = () => {
      const secs = Math.max(1, Math.round((Date.now() - f.started) / 1000));
      const blob = new Blob(f.chunks, { type: (rec.mimeType || type || "video/webm").split(";")[0] });
      stopCamera(); showClip(blob, secs);
    };
    rec.start(1000);
    pillGo.hidden = true; pillStop.textContent = "Stop"; pillSay.textContent = "Recording 0:00";
    f.timer = setInterval(() => {
      const s = Math.floor((Date.now() - f.started) / 1000);
      pillSay.textContent = "Recording " + mmss(s);
      if (s >= MAX_FILM) stopFilm();
    }, 500);
  }
  function stopFilm(){
    if (film && film.state === "rec"){ clearInterval(film.timer); film.state = "stopping"; try { film.rec.stop(); } catch (e) { stopCamera(); } }
    else if (film && film.state === "live") stopCamera();
  }
  function dropClip(){ if (clip) URL.revokeObjectURL(clip.url); clip = null; reviewVid.removeAttribute("src"); try { reviewVid.load(); } catch (e) {} review.hidden = true; }
  function showClip(blob, secs){
    dropClip();
    if (!blob.size){ reactNote.textContent = "Nothing was recorded. Try again."; reactBtn.hidden = false; return; }
    clip = { blob, url: URL.createObjectURL(blob), secs };
    reviewVid.src = clip.url; review.hidden = false; reactBtn.hidden = true; sendV.disabled = false; cbV.checked = false;
    reactNote.textContent = "Watch it back. It hasn't been sent.";
    if (!inside.hidden) react.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" }); // they pressed stop: show them where it went
  }
  reviewVid.addEventListener("play", () => { if (audio) audio.pause(); }); // not both at once
  pillGo.addEventListener("click", startFilm);
  pillStop.addEventListener("click", stopFilm);
  reactBtn.addEventListener("click", async () => {
    reactNote.textContent = "";
    if (!(await camera())) reactNote.textContent = "We couldn't use your camera. Check that this page is allowed to use the camera and microphone.";
  });
  againV.addEventListener("click", async () => {
    dropClip(); reactNote.textContent = ""; reactBtn.hidden = false;
    if (!(await camera())) reactNote.textContent = "We couldn't use your camera. Check that this page is allowed to use the camera and microphone.";
  });
  dropV.addEventListener("click", () => { dropClip(); reactBtn.hidden = false; reactNote.textContent = "Deleted. It was never sent."; });
  sendV.addEventListener("click", async () => {
    if (!clip) return;
    if (clip.blob.size > 28 * 1024 * 1024){ reactNote.textContent = "That video is too long to send. Record a shorter one."; return; }
    sendV.disabled = true; reactNote.textContent = "Sending. Keep this page open.";
    try {
      let res;
      try { res = await fetch("/api/gift/" + encodeURIComponent(id) + "/reaction?share=" + (cbV.checked ? "1" : "0") + "&secs=" + clip.secs,
        { method: "POST", headers: { "content-type": "application/octet-stream" }, body: clip.blob }); }
      catch (e) { throw new Error("You seem to be offline. Check your connection and try again."); }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Something went wrong. Try again.");
      dropClip(); g.reactionsLeft -= 1; reactBtn.hidden = g.reactionsLeft <= 0; reactBtn.textContent = "Record another";
      reactNote.textContent = "Sent to " + g.sender + ". They'll see it on their own page for this song.";
    } catch (e) { reactNote.textContent = e.message; sendV.disabled = false; }
  });
  window.addEventListener("pagehide", stopCamera);
  if (canFilm){
    document.body.append(pill);
    // Before opening: one quiet line under the envelope. Tapping it turns the camera on, and recording starts with the seal.
    const arm = el("button", "btn quiet small arm", "Let " + g.sender + " see your reaction"); arm.type = "button";
    const armNote = el("p", "status-line arm-note"); armNote.setAttribute("role", "status");
    arm.addEventListener("click", async e => {
      e.stopPropagation();
      if (await camera()){
        armed = true; arm.hidden = true; pillGo.hidden = true; pillSay.textContent = "Starts when you open it.";
        armNote.textContent = "You're on camera. Open it when you're ready. Nothing is sent unless you choose to send it.";
      } else armNote.textContent = "We couldn't use your camera. You can still open your song.";
    });
    cameraOff = () => { arm.hidden = false; armNote.textContent = ""; };
    arrive.append(arm, armNote);
  }
  if (canFilm) sheet.append(react);

  const pass = el("p", "pass"); pass.append(document.createTextNode("Kindness travels. "));
  const more = el("a", "btn quiet", "Make a song for someone"); more.href = makeHref;
  pass.append(more); sheet.append(pass);

  // Anyone can flag a song for review.
  const rep = el("div", "report");
  const repBtn = el("button", "btn quiet small", "Report a problem with this song"); repBtn.type = "button";
  repBtn.addEventListener("click", () => {
    rep.textContent = "";
    const why = el("textarea"); why.maxLength = 600; why.setAttribute("aria-label", "What is wrong with this song"); why.placeholder = "What is wrong with this song?";
    why.style.cssText = "display:block;width:100%;min-height:70px;margin:0 0 8px;padding:12px 14px;border:1.5px solid transparent;border-radius:14px;background:var(--tint);font:inherit;color:inherit";
    const go = el("button", "btn small", "Send report"); go.type = "button";
    const said = el("p", "status-line");
    go.addEventListener("click", async () => {
      if (!why.value.trim()){ said.textContent = "Tell us what is wrong first."; return; }
      go.disabled = true;
      try { await api("/api/gift/" + encodeURIComponent(id) + "/report", { method: "POST", body: { body: why.value } }); rep.textContent = "Thank you. We review every report."; }
      catch (e) { said.textContent = e.message; go.disabled = false; }
    });
    rep.append(why, go, said);
  });
  rep.append(repBtn); sheet.append(rep);

  // The one big moment: the seal turns and lifts away, the envelope opens, the record turns, and the sender's voice or the song begins.
  let opened = false;
  function open(){
    if (opened) return; opened = true;
    audio.play().catch(() => {}); // straight away, while the tap still counts as the listener asking for sound
    if (armed && film && film.state === "live") startFilm();
    const show = () => {
      arrive.remove(); inside.hidden = false;
      fitLabel(rec); // now it is on the page, the writing can be measured
      inside.classList.add("reveal"); plate.classList.add("reveal"); sheet.classList.add("reveal");
      requestAnimationFrame(() => requestAnimationFrame(() => { stage.classList.remove("sealed"); placeLine(); }));
      window.scrollTo(0, 0);
      h1.tabIndex = -1; try { h1.focus({ preventScroll: true }); } catch (e) {} // someone using a keyboard or a screen reader lands on what opened
    };
    if (calm){ show(); return; }
    env.classList.add("open"); hint.classList.add("gone");
    setTimeout(() => arrive.classList.add("away"), 900);
    setTimeout(show, 1350);
  }
  seal.addEventListener("click", open);
  env.addEventListener("click", open);
}).catch(e => {
  root.textContent = "";
  root.append(el("h1", null, "This song isn't here."));
  root.append(el("p", "for", e && /removed/i.test(e.message) ? "It has been removed." : "The link may be mistyped, or the song hasn't been unlocked yet."));
});
})();
