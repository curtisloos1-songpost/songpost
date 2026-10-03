(function(){
"use strict";
const root = document.getElementById("gift");
const id = location.pathname.split("/").filter(Boolean).pop();

// The sender looking at their own gift page must not be taken for the person the song is for.
// They arrive with ?sender=1 from the "See their page" button, or on the device the song was made on.
let fromSender = new URLSearchParams(location.search).has("sender");
try { if ((JSON.parse(localStorage.getItem("songpost-mine-v1") || "[]") || []).indexOf(id) >= 0) fromSender = true; } catch (e) {}

api("/api/gift/" + encodeURIComponent(id)).then(g => {
  root.textContent = "";
  const metal = g.tier === "platinum" ? "platinum" : "gold";
  root.append(el("p", "for", "For " + g.recipient));
  root.append(el("h1", null, g.sender + " made you a song."));

  const rec = el("div", "record"); rec.dataset.metal = metal; rec.innerHTML = recordSVG(g);
  const shape = shapeFor(g.tone);
  const stage = el("div", "rec-stage sealed shape-" + shape); stage.innerHTML = shapeSVG(shape); stage.append(rec); root.append(stage);
  const openRow = el("div", "open-row");
  const openBtn = el("button", "btn light big", "Play your song"); openBtn.type = "button";
  openRow.append(openBtn); root.append(openRow);
  if (fromSender) root.append(el("p", "status-line preview-note", "You're looking at " + g.recipient + "'s page as the sender. Playing it here isn't counted as their first listen."));

  const plate = el("div", "plate"); plate.dataset.metal = metal; plate.hidden = true;
  plate.append(el("span", "p1", "Presented to " + g.recipient), el("span", "p2", longDate(g.paidAt)));
  root.append(plate);

  const sheet = el("div", "sheet"); sheet.hidden = true; root.append(sheet);
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
  // Each take carries its own words, which differ when the lyrics were changed between takes.
  function useTake(url, title, lyrics){
    if (audio) audio.pause();
    audio = mountAudio(box, url, "Play the song", rec, played);
    saveLink.href = url + (url.indexOf("?") >= 0 ? "&" : "?") + "download=1";
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
        useTake(t.url, t.title || g.title, t.lyrics || g.lyrics); audio.play().catch(() => {});
      });
      takes.append(b);
    });
    sheet.append(takes);
  }
  sheet.append(box);
  useTake(g.audioUrl, g.title, g.lyrics);

  const keep = el("div", "keep");
  keep.append(saveLink);
  if (metal === "platinum"){
    const printBtn = el("button", "btn small", "Print the lyrics"); printBtn.type = "button";
    printBtn.addEventListener("click", () => window.print());
    keep.append(printBtn);
  }
  keep.append(el("p", "status-line", "Save the song if you want to keep it. This page may not stay online."));
  sheet.append(keep);

  if (g.note){
    const note = el("div", "g-note"); note.append(el("p", null, g.note), el("p", "sig", g.sender)); sheet.append(note);
  }
  sheet.append(ly);

  // A few words back to the sender.
  const reply = el("div", "reply");
  reply.append(el("h3", null, "Tell " + g.sender + " what you thought"));
  const words = el("textarea"); words.maxLength = 600; words.setAttribute("aria-label", "Your message to " + g.sender);
  const share = el("label", "check"); const cb = el("input"); cb.type = "checkbox";
  share.append(cb, document.createTextNode(" Songpost may share my words with others"));
  const sendBtn = el("button", "btn primary", "Send to " + g.sender); sendBtn.type = "button";
  const sent = el("p", "status-line"); sent.setAttribute("role", "status");
  sendBtn.addEventListener("click", async () => {
    if (!words.value.trim()){ sent.textContent = "Write a few words first."; return; }
    sendBtn.disabled = true;
    try {
      await api("/api/gift/" + encodeURIComponent(id) + "/reply", { method: "POST", body: { body: words.value, shareOk: cb.checked } });
      sent.textContent = "Sent to " + g.sender + "."; words.readOnly = true;
    } catch (e) { sent.textContent = e.message; sendBtn.disabled = false; }
  });
  const rrow = el("div", "row"); rrow.append(sendBtn);
  reply.append(words, share, rrow, sent); sheet.append(reply);

  const pass = el("p", "pass"); pass.append(document.createTextNode("Kindness travels. "));
  const again = el("a", "btn quiet", "Make a song for someone"); again.href = "/";
  pass.append(again); sheet.append(pass);

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

  // The one big moment: the shape opens, the record turns, the song starts, the words appear.
  openBtn.addEventListener("click", () => {
    stage.classList.remove("sealed");
    openRow.hidden = true;
    plate.hidden = false; plate.classList.add("reveal");
    sheet.hidden = false; sheet.classList.add("reveal");
    audio.play().catch(() => {});
  });
}).catch(e => {
  root.textContent = "";
  root.append(el("h1", null, "This song isn't here."));
  root.append(el("p", "for", e && /removed/i.test(e.message) ? "It has been removed." : "The link may be mistyped, or the song hasn't been unlocked yet."));
});
})();
