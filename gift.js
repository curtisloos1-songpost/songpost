(function(){
"use strict";
const root = document.getElementById("gift");
const id = location.pathname.split("/").filter(Boolean).pop();
const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The sender looking at their own gift page must not be taken for the person the song is for.
// They arrive with ?sender=1 from the "See their page" button, or on the device the song was made on.
let fromSender = new URLSearchParams(location.search).has("sender");
try { if ((JSON.parse(localStorage.getItem("songpost-mine-v1") || "[]") || []).indexOf(id) >= 0) fromSender = true; } catch (e) {}

const HEART = '<svg viewBox="-110 -80 220 200" aria-hidden="true" focusable="false"><path d="M0,-30C-25,-75 -100,-55 -100,-5C-100,45 -40,75 0,110C40,75 100,45 100,-5C100,-55 25,-75 0,-30Z"/></svg>';

api("/api/gift/" + encodeURIComponent(id)).then(g => {
  root.textContent = "";
  const metal = g.tier === "platinum" ? "platinum" : "gold";
  // Someone who goes on to make a song from here is counted as coming from this gift. The sender's own visit is not.
  const makeHref = fromSender ? "/" : "/?from=" + encodeURIComponent(id);

  /* ---------- how it arrives: an envelope with their name on it, closed with a seal ---------- */
  const arrive = el("div", "arrive");
  arrive.append(el("p", "for", "Commissioned for you by " + g.sender));
  const env = el("div", "env"); env.dataset.metal = metal;
  const front = el("div", "env-front");
  const nm = el("span", "env-name", g.recipient); nm.dir = "auto";
  nm.style.fontSize = Math.max(1.05, Math.min(2.3, 15 / Math.max(g.recipient.length, 5))).toFixed(2) + "rem"; // a long name is written smaller
  front.append(el("span", "env-for", "for"), nm);
  const flap = el("div", "env-flap"); flap.append(el("i"));
  const seal = el("button", "seal"); seal.type = "button"; seal.setAttribute("aria-label", "Break the seal to open your song");
  seal.innerHTML = '<i class="seal-l"></i><i class="seal-r"></i><i class="seal-c"></i>' + HEART;
  env.append(el("div", "env-back"), front, flap, seal);
  const hint = el("p", "env-hint", "Break the seal to open it. Your song starts playing.");
  arrive.append(env, hint);
  if (fromSender) arrive.append(el("p", "status-line preview-note", "You're looking at " + g.recipient + "'s page as the sender. Opening it here isn't counted as their first listen."));
  root.append(arrive);

  /* ---------- what is inside ---------- */
  const inside = el("div", "inside"); inside.hidden = true; root.append(inside);
  inside.append(el("p", "for", "A song commissioned for"));
  const h1 = el("h1", null, g.recipient); h1.dir = "auto"; inside.append(h1);
  inside.append(el("p", "by", "by " + g.sender));
  if (g.fromAll) inside.append(el("p", "from-all", "From " + g.fromAll)); // a song made together: everyone it is from

  const rec = el("div", "record"); rec.dataset.metal = metal; setRecord(rec, g);
  const shape = shapeFor(g.tone);
  const stage = el("div", "rec-stage sealed shape-" + shape); stage.innerHTML = shapeSVG(shape); stage.append(rec); inside.append(stage);

  const plate = el("div", "plate"); plate.dataset.metal = metal;
  plate.append(el("span", "p1", "Presented to " + g.recipient), el("span", "p2", longDate(g.paidAt)));
  inside.append(plate);

  const sheet = el("div", "sheet"); inside.append(sheet);
  // Platinum: the photo the sender chose, above the title.
  if (g.photoUrl){
    const fig = el("div", "g-photo"), im = el("img"); im.src = g.photoUrl; im.alt = "A photo from " + g.sender;
    im.addEventListener("error", () => fig.remove());
    fig.append(im); sheet.append(fig);
  }
  const titleLine = el("p", "g-title", g.title || ""); titleLine.hidden = !g.title; sheet.append(titleLine);
  const ly = el("div", "g-lyrics");

  // Platinum: every recording is kept, and the listener can switch between them.
  const box = el("div");
  let audio = null, heard = false;
  const played = () => {
    if (heard || fromSender) return;
    heard = true; api("/api/gift/" + encodeURIComponent(id) + "/played", { method: "POST" }).catch(() => {});
  };
  const saveLink = el("a", "btn small", "Save the song"); saveLink.setAttribute("download", "");
  // Platinum: the lyric sheet, made to print and frame. It follows the take being played.
  const sheetLink = el("a", "btn small", "Lyric sheet to print and frame"); sheetLink.target = "_blank"; sheetLink.rel = "noopener";
  // The sender's own voice, heard once before the song. It can be heard again from a small button under the player.
  const again = el("button", "btn quiet small voice-again", "Hear " + g.sender + "'s message again"); again.type = "button"; again.hidden = true;
  again.addEventListener("click", () => { if (audio && audio.playIntro) audio.playIntro(); });
  let voiceOk = !!g.voiceUrl; // false once the recording turns out not to play
  // Each take carries its own words, which differ when the lyrics were changed between takes.
  let cur = { title: g.title, lyrics: g.lyrics, n: null }; // what is on the page now, for the email
  function useTake(url, title, lyrics, n, first){
    if (audio) audio.pause();
    cur = { title: title || "", lyrics: lyrics || "", n: n };
    const intro = voiceOk ? { src: g.voiceUrl, label: "A message from " + g.sender, auto: !!first, onDone: () => { again.hidden = false; }, onBroken: () => { voiceOk = false; again.hidden = true; } } : null;
    audio = mountAudio(box, url, "Play the song", rec, played, intro);
    saveLink.href = url + (url.indexOf("?") >= 0 ? "&" : "?") + "download=1";
    if (g.sheetUrl) sheetLink.href = g.sheetUrl + (n != null ? "?take=" + n : "");
    titleLine.textContent = title || ""; titleLine.hidden = !title;
    ly.textContent = ""; lyricsInto(ly, lyrics);
  }
  if (g.takes && g.takes.length > 1){
    const takes = el("div", "takes");
    g.takes.forEach((t, i) => {
      const b = el("button", "chip", "Take " + (i + 1)); b.type = "button";
      b.setAttribute("aria-pressed", String(t.chosen));
      b.addEventListener("click", () => {
        Array.from(takes.children).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
        useTake(t.url, t.title || g.title, t.lyrics || g.lyrics, t.n); again.hidden = !voiceOk; audio.play().catch(() => {});
      });
      takes.append(b);
    });
    sheet.append(takes);
  }
  sheet.append(box);
  if (g.voiceUrl) sheet.append(again);
  useTake(g.audioUrl, g.title, g.lyrics, null, true);

  /* The words by email, to keep. With a mail service connected we send it to the address they type.
     Without one, their own mail app opens with the email already written, for them to send to themselves. */
  const giftLink = location.origin + "/g/" + encodeURIComponent(id);
  const mailBtn = el("button", "btn small", "Email this to myself"); mailBtn.type = "button"; mailBtn.setAttribute("aria-expanded", "false");
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

  const keep = el("div", "keep");
  keep.append(saveLink);
  if (g.sheetUrl) keep.append(sheetLink);
  keep.append(mailBtn);
  keep.append(el("p", "status-line", "Save the song if you want to keep it. This page may not stay online."));
  keep.append(mailBox);
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
  sheet.append(ly);

  // A few words back to the sender.
  const reply = el("div", "reply");
  reply.append(el("h3", null, "Tell " + g.sender + " what you thought"));
  const words = el("textarea"); words.maxLength = 600; words.setAttribute("aria-label", "Your message to " + g.sender);
  const share = el("label", "check"); const cb = el("input"); cb.type = "checkbox";
  share.append(cb, document.createTextNode(" Songpost may share my words and first name with others"));
  const sendBtn = el("button", "btn primary", "Send to " + g.sender); sendBtn.type = "button";
  const sent = el("p", "status-line"); sent.setAttribute("role", "status");
  sendBtn.addEventListener("click", async () => {
    if (!words.value.trim()){ sent.textContent = "Write a few words first."; return; }
    sendBtn.disabled = true;
    try {
      await api("/api/gift/" + encodeURIComponent(id) + "/reply", { method: "POST", body: { body: words.value, shareOk: cb.checked } });
      sent.textContent = g.together ? (g.replyIsSent ? "Sent. " : "Saved. ") + "Everyone who made the song will see it."
        : g.replyIsSent ? "Sent to " + g.sender + "." : "Saved for " + g.sender + ". They'll see it on their page for this song.";
      words.readOnly = true; share.hidden = true; rrow.hidden = true;
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
  reply.append(words, share, rrow, sent); sheet.append(reply);

  const pass = el("p", "pass"); pass.append(document.createTextNode("Kindness travels. "));
  const more = el("a", "btn quiet", "Make a song for someone"); more.href = makeHref;
  pass.append(more); sheet.append(pass);

  // Anyone can flag a song for review.
  const rep = el("div", "report");
  const repBtn = el("button", "btn quiet small", "Report a problem with this song"); repBtn.type = "button";
  repBtn.addEventListener("click", () => {
    rep.textContent = "";
    const why = el("textarea"); why.maxLength = 600; why.setAttribute("aria-label", "What is wrong with this song"); why.placeholder = "What is wrong with this song?";
    why.style.cssText = "display:block;width:100%;min-height:70px;margin:0 0 8px;padding:8px 10px;border:1px solid var(--rule);border-radius:3px;background:transparent;font:inherit;color:inherit";
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

  // The one big moment: the seal breaks, the envelope opens, the record turns, and the sender's voice or the song begins.
  let opened = false;
  function open(){
    if (opened) return; opened = true;
    audio.play().catch(() => {}); // straight away, while the tap still counts as the listener asking for sound
    const show = () => {
      arrive.remove(); inside.hidden = false;
      fitLabel(rec); // now it is on the page, the writing can be measured
      inside.classList.add("reveal"); plate.classList.add("reveal"); sheet.classList.add("reveal");
      requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.remove("sealed")));
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
