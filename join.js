// The page an invited person opens to add their memories to a song made together.
(function(){
"use strict";
const root = document.getElementById("join"), heading = document.querySelector(".legal-body h1");
const id = location.pathname.split("/").filter(Boolean).pop();
const here = "/api/join/" + encodeURIComponent(id);
// What this device added is found again by its token, so the person can change it, and later hear the song.
const TOKEN_KEY = "songpost-part-" + id;
let token = ""; try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch (e) {}
const ask = () => api(here, { headers: token ? { "x-part-token": token } : {} });
let timer = null;
const title = t => { heading.textContent = t; document.title = t + " - Songpost"; };
const watch = () => { clearInterval(timer); timer = setInterval(async () => { try { render(await ask()); } catch (e) {} }, 30000); };

function passItOn(){
  const p = el("p", "pass"); p.append(document.createTextNode("Kindness travels. "));
  const a = el("a", "btn quiet", "Make a song of your own"); a.href = "/?join=" + encodeURIComponent(id);
  p.append(a); return p;
}

function render(v, editing){
  clearInterval(timer);
  root.textContent = "";
  const who = v.organizer || "The organizer", them = v.recipient || "them";

  // The song is unlocked: the people who helped make it can hear it, and see what came back.
  if (v.ready){
    title("The song for " + them + " is ready");
    root.append(el("p", "lede", who + " has finished the song you helped make" + (v.ready.title ? ": “" + v.ready.title + "”." : ".")));
    const row = el("div", "row"), a = el("a", "btn primary", "Listen to the song"); a.href = v.ready.url; row.append(a); root.append(row);
    root.append(el("p", "status-line", who + " is the one giving it to " + them + ", so please leave the sending to them."));
    // Remember that this song is partly ours, so playing it here is never taken for their first listen.
    try { const mine = (JSON.parse(localStorage.getItem("songpost-mine-v1") || "[]") || []).filter(x => x !== v.ready.id); mine.push(v.ready.id); localStorage.setItem("songpost-mine-v1", JSON.stringify(mine.slice(-50))); } catch (e) {}
    const box = el("div", "after-pay");
    box.append(el("p", "status-line", v.ready.firstPlayedAt ? them + " first played it on " + longDate(v.ready.firstPlayedAt) + "."
      : them + " hasn't played it yet. This page shows when they do, and anything they write back."));
    if (v.ready.replies.length) box.append(el("h3", null, them + " wrote back"));
    v.ready.replies.forEach(r => box.append(el("blockquote", "reply-in", r.body), el("p", "status-line", longDate(r.at))));
    root.append(box, passItOn());
    watch(); return;
  }

  // Already added, and not changing it.
  if (v.mine && !editing){
    title("Thank you, " + v.mine.name);
    root.append(el("p", "lede", v.closed ? who + " is finishing the song for " + them + ". When it's ready, you can hear it on this page."
      : "Your memories are in. " + who + " will finish the song for " + them + ", and when it's ready you can hear it on this page."));
    root.append(el("p", "status-line", "Keep this link, and open it on this same phone or computer to hear the song."));
    if (!v.closed){
      const row = el("div", "row"), b = el("button", "btn", "Change what I wrote"); b.type = "button";
      b.addEventListener("click", () => render(v, true)); row.append(b); root.append(row);
    }
    root.append(passItOn());
    watch(); return;
  }

  if (v.closed || v.full){
    title(v.closed ? "This song is already finished" : "This song is full");
    root.append(el("p", "lede", v.closed ? who + " has recorded the song for " + them + ", so nothing more can be added."
      : "The song for " + them + " already has as many people as it can hold."));
    root.append(passItOn());
    return;
  }

  // The form.
  title("Add your memories to " + them + "'s song");
  root.append(el("p", "lede", who + " is making a song for " + them + " and would love your memories in it."));
  root.append(el("p", "lead-in", "Answer as many as you like. A sentence each is plenty. " + who + " sees what you write, and the song is written from everyone's answers together."));
  // A new invitation starts empty: nothing is answered for the person. Only what they wrote themselves comes back when they return.
  const mine = v.mine || { name: "", relationship: "", answers: [], contact: "" };
  const field = (label, hint, input) => { const l = el("label", "field", label); if (hint) l.append(el("span", "hint", hint)); l.append(input); return l; };
  const name = el("input"); name.maxLength = 24; name.autocomplete = "given-name"; name.value = mine.name;
  const rel = el("input"); rel.maxLength = 40; rel.autocomplete = "off"; rel.placeholder = "mom, dad, best friend"; rel.value = mine.relationship;
  root.append(field("Your first name", "The song is signed from everyone who adds to it.", name), field(them + " is my", null, rel));
  const areas = questionsFor(v.occasion)[1].map(pair => {
    const t = el("textarea", "short"); t.maxLength = 400; t.placeholder = pair[1];
    const old = mine.answers.find(a => a.q === pair[0]); if (old) t.value = old.a;
    root.append(field(pair[0], null, t));
    return [pair[0], t];
  });
  const mail = el("input", "plain boxed"); mail.type = "text"; mail.inputMode = "email"; mail.autocomplete = "email"; mail.autocapitalize = "off"; mail.spellcheck = false; mail.maxLength = 120;
  mail.placeholder = "you@example.com"; mail.value = mine.contact;
  if (v.emailOn) root.append(field("Your email, if you'd like to hear when the song is ready", "Optional. It is used for this song and nothing else.", mail));
  const row = el("div", "row"), send = el("button", "btn primary", v.mine ? "Save my changes" : "Add my memories"); send.type = "button"; row.append(send);
  if (v.mine){ const back = el("button", "btn quiet", "Leave it as it was"); back.type = "button"; back.addEventListener("click", () => render(v)); row.append(back); }
  const err = el("p", "err"); err.setAttribute("role", "alert");
  const agree = el("p", "agree"); agree.append("By adding your memories, you agree to the ");
  const a1 = el("a", null, "terms"); a1.href = "/terms"; const a2 = el("a", null, "content rules"); a2.href = "/content";
  agree.append(a1, " and the ", a2, ".");
  root.append(row, err, agree);
  send.addEventListener("click", async () => {
    err.textContent = "";
    if (!name.value.trim()){ err.textContent = "Add your first name, so the song can be signed from you."; name.focus(); return; }
    const answers = areas.map(p => ({ q: p[0], a: p[1].value.trim() })).filter(p => p.a);
    if (answers.map(p => p.a).join(" ").length < 8){ err.textContent = "Answer at least one question, in a sentence or two."; return; }
    send.disabled = true;
    try {
      const out = await api(here, { method: "POST", headers: token ? { "x-part-token": token } : {},
        body: { name: name.value, relationship: rel.value, answers, contact: v.emailOn ? mail.value.trim() : "" } });
      token = out.token; try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
      render(await ask()); window.scrollTo(0, 0);
    } catch (e) { err.textContent = e.message; send.disabled = false; }
  });
}

ask().then(v => render(v)).catch(e => {
  title("This invitation isn't here");
  root.textContent = "";
  root.append(el("p", "lede", (e && e.message) || "Check the link, or ask for it again."));
});
})();
