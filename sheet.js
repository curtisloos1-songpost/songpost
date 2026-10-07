'use strict';
// The lyric sheet that comes with a Platinum record: one page, made to be printed and framed.
// The page sizes its own writing so that a song fits on a single sheet: smaller writing, then two columns, then a smaller
// photo, then three columns, and last of all no photo. If even that is not enough it says so (see the script at the end).
const { parseSections } = require('./sections');
const { strokesSvg } = require('./touches');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEART = 'M0,-30C-25,-75 -100,-55 -100,-5C-100,45 -40,75 0,110C40,75 100,45 100,-5C100,-55 25,-75 0,-30Z';

// The looks a lyric sheet can have: [what it is called in the address, what the person choosing sees].
const DESIGNS = [['classic', 'Classic'], ['seaglass', 'Sea glass'], ['gold', 'Gold record'], ['midnight', 'Midnight (uses more ink)'], ['liner', 'Liner notes'], ['pressing', 'Pressing']];
// The Songpost mark as it appears on the site: the gold record with its heart, and the name. It closes every sheet and card.
const MARK = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#D3A53A" stroke="#9A7218" stroke-width="1"/><circle cx="12" cy="12" r="6.2" fill="#FFFFFF"/><path d="${HEART}" transform="translate(12 12) scale(.036) translate(0 -24)" fill="#0E2A33"/></svg><span>Songpost</span>`;

const CSS = `
:root{--ink:#0E2A33;--soft:#52686E;--silver:#8B949F;--pale:#C8CED6;--w:8.5in;--h:11in;
  --serif:"Cormorant Garamond","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --sans:"Jost","Avenir Next","Century Gothic","Helvetica Neue",Arial,sans-serif}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:#E3EBED;color:var(--ink);font-family:var(--sans)}
.bar{max-width:820px;margin:0 auto;padding:16px 16px 4px;display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center}
.bar a{color:inherit;font-size:.92rem}
.bar .grow{flex:1}
.bar button,.bar select{font:inherit;font-size:.92rem;padding:9px 16px;border:1px solid var(--ink);border-radius:3px;background:transparent;color:var(--ink);cursor:pointer}
.bar button.go{background:var(--ink);color:#fff}
.bar label{font-size:.92rem;display:inline-flex;align-items:center;gap:6px}
.hint{max-width:820px;margin:0 auto;padding:6px 16px 14px;font-size:.86rem;color:var(--soft)}
.mail{max-width:820px;margin:0 auto;padding:8px 16px 4px;display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center}
.mail[hidden]{display:none}
.mail input{flex:1;min-width:13em;font:inherit;font-size:1rem;padding:9px 12px;border:1px solid var(--ink);border-radius:3px;background:#fff;color:var(--ink)}
.mail button{font:inherit;font-size:.92rem;padding:9px 16px;border:1px solid var(--ink);border-radius:3px;background:var(--ink);color:#fff;cursor:pointer}
.mail button.plain{background:transparent;color:var(--ink)}
.mail button[hidden],.mail input[hidden]{display:none}
.mail p{flex-basis:100%;margin:0;font-size:.86rem;color:var(--soft)}
.mail p:empty{display:none}
.frame{margin:0 auto 40px;overflow:hidden}
.paper{width:var(--w);height:var(--h);background:#fff;position:relative;transform-origin:top left;
  padding:.82in .9in .7in;display:flex;flex-direction:column;align-items:center;text-align:center;overflow:hidden;
  box-shadow:0 30px 60px -30px rgba(6,40,50,.5)}
.paper::before{content:"";position:absolute;inset:.36in;border:1.1pt solid var(--ink);pointer-events:none}
.paper::after{content:"";position:absolute;inset:.43in;border:.45pt solid var(--silver);pointer-events:none}
.disc{width:.56in;height:.56in;flex:none}
.kicker{font:500 8.5pt/1.3 var(--sans);letter-spacing:.24em;text-transform:uppercase;color:var(--soft);margin:.13in 0 0;max-width:100%;overflow-wrap:anywhere}
.title{font:italic 500 34pt/1.08 var(--serif);margin:.07in 0 0;max-width:100%;text-wrap:balance;overflow-wrap:anywhere}
.orn{display:flex;align-items:center;justify-content:center;gap:.12in;width:2.6in;margin:.15in 0 .16in;flex:none}
.orn i{flex:1;height:0;border-top:.5pt solid var(--silver)}
.orn svg{width:.11in;height:.11in;flex:none}
.pic{display:block;max-width:3.5in;max-height:2.25in;margin:0 0 .18in;padding:5pt;background:#fff;border:.5pt solid var(--silver);flex:none}
.pic[hidden]{display:none}
.pic.small{max-height:1.3in;max-width:2.4in;margin-bottom:.13in}
.ly{flex:1;min-height:0;width:100%;position:relative;overflow:hidden;font:500 13pt/1.42 var(--serif)}
.ly.two{column-count:2;column-gap:.42in}
.ly.three{column-count:3;column-gap:.3in}
.ly.loose .st{break-inside:auto}
.warn{max-width:820px;margin:0 auto;padding:0 16px 12px;font-size:.9rem;color:#8A2A1F}
.warn[hidden]{display:none}
.said{max-width:820px;margin:0 auto;padding:0 16px 10px;font-size:.86rem;color:var(--soft)}
.said:empty{display:none}
.st{margin:0 0 .92em;break-inside:avoid}
.st:last-child{margin-bottom:0}
.st p{margin:0;overflow-wrap:anywhere}
.orn.low{margin:.16in 0 .1in}
.sig{display:block;height:.5in;max-width:2.6in;margin:0 auto .04in;color:var(--ink);flex:none}
.sigt{margin:0 auto .04in;text-align:center;color:var(--ink);line-height:1.1;flex:none}
.sigf-flowing{font-family:"Mrs Saint Delafield",cursive;font-size:30pt;line-height:1}
.sigf-elegant{font-family:"Great Vibes",cursive;font-size:23pt}
.sigf-formal{font-family:"Allura",cursive;font-size:25pt}
.sigf-brush{font-family:"Alex Brush",cursive;font-size:24pt}
.sigf-friendly,.sigf-handwritten{font-family:"Dancing Script",cursive;font-weight:500;font-size:21pt}
.sigf-fine{font-family:"Sacramento",cursive;font-size:25pt}
.sigf-classic{font-family:"Pinyon Script",cursive;font-size:23pt}
.sigf-pen{font-family:"Homemade Apple",cursive;font-size:14pt;line-height:1.5}
.from{font:italic 500 15pt/1.2 var(--serif);margin:0;max-width:100%;overflow-wrap:anywhere}
/* ---------- designs. Every one is Songpost: sea glass, deep ink and white, the gold or platinum of the record,
   the same two typefaces, and the same mark at the foot. What changes is how the sheet is dressed. ---------- */
.paper{isolation:isolate;color:var(--ink)}
.paper::after{border:.6pt solid #6CBCCB}
.grooves{display:none;position:absolute;z-index:-1;pointer-events:none}
.qr-mini{display:flex;flex-direction:column;align-items:center;gap:.04in;margin:.12in 0 0;flex:none}
.qr-mini[hidden]{display:none}
.qr-mini svg{width:.96in;height:.96in;display:block}
.qr-mini span{font:500 6.5pt/1 var(--sans);letter-spacing:.14em;color:var(--soft)}
.orn svg path{fill:var(--silver)}
/* Sea glass: a white sheet on a sea-glass mat, as if it were already mounted */
.paper[data-design="seaglass"]{background:#6CBCCB;padding:1.04in 1.12in .9in}
.paper[data-design="seaglass"]::before{z-index:-1;inset:.52in;background:#fff;border:0;box-shadow:0 0 0 .75pt rgba(14,42,51,.28),0 3pt 10pt rgba(6,40,50,.18)}
.paper[data-design="seaglass"]::after{z-index:-1;inset:.64in;border:.5pt solid #A9D6DE}
/* Gold record: the gold of the record in the rules and the ornaments, on white */
.paper[data-design="gold"]{--silver:#B8902F}
.paper[data-design="gold"]::before{border-color:#B8902F;border-width:1.5pt}
.paper[data-design="gold"]::after{border-color:#D9BE7A}
.paper[data-design="gold"] .disc stop:nth-child(1){stop-color:#FFF6D8}
.paper[data-design="gold"] .disc stop:nth-child(2){stop-color:#D3A53A}
.paper[data-design="gold"] .disc stop:nth-child(3){stop-color:#9A7218}
.paper[data-design="gold"] .disc circle{stroke:#9A7218}
/* Midnight: the deep ink of the Songpost name, ruled in sea glass. Striking in a frame; it uses a lot of ink */
.paper[data-design="midnight"]{background:#0E2A33;--ink:#FFFFFF;--soft:#BFD9DE;--silver:#6CBCCB}
.paper[data-design="midnight"]::before{border-color:#6CBCCB}
.paper[data-design="midnight"]::after{border-color:rgba(108,188,203,.5)}
.paper[data-design="midnight"] .pic{background:#0E2A33;border-color:#6CBCCB}
/* Liner notes: set like the inside of a record sleeve. Everything hangs from the left, off one sea-glass rule */
.paper[data-design="liner"]{align-items:flex-start;text-align:left;padding:.92in .95in .78in 1.08in}
.paper[data-design="liner"]::before{inset:.62in auto .62in .62in;width:0;border:0;border-left:3pt solid #6CBCCB}
.paper[data-design="liner"]::after{display:none}
.paper[data-design="liner"] .disc{position:absolute;right:.82in;top:.8in;width:.98in;height:.98in}
.paper[data-design="liner"] .kicker{margin-top:0;max-width:calc(100% - 1.3in)}
.paper[data-design="liner"] .title{max-width:calc(100% - 1.3in);text-wrap:wrap}
.paper[data-design="liner"] .orn{width:100%;justify-content:flex-start}
.paper[data-design="liner"] .orn svg,.paper[data-design="liner"] .orn i:last-child{display:none}
.paper[data-design="liner"] .orn i{flex:none;width:1.25in;border-top:1pt solid var(--ink)}
.paper[data-design="liner"] .sig,.paper[data-design="liner"] .sigt{margin-left:0;margin-right:0;text-align:left}
.paper[data-design="liner"] .qr-mini{align-items:flex-start}
/* Pressing: the grooves of the record itself run off the corner of the sheet, in pale sea glass, behind the words */
.paper[data-design="pressing"]::before,.paper[data-design="pressing"]::after{display:none}
.paper[data-design="pressing"] .disc{display:none}
.paper[data-design="pressing"] .kicker{margin-top:.2in}
.paper[data-design="pressing"] .grooves{display:block;width:9.4in;height:9.4in;right:-3.5in;bottom:-3.5in}
.date{font:500 8pt/1.3 var(--sans);letter-spacing:.22em;text-transform:uppercase;color:var(--soft);margin:.06in 0 0}
.mark{display:inline-flex;align-items:center;gap:.06in;font:600 11.5pt/1 var(--serif);letter-spacing:.01em;color:var(--ink);margin:.14in 0 0;flex:none}
.mark svg{width:.16in;height:.16in;flex:none}
@media print{
  body{background:#fff}
  .bar,.hint,.warn,.mail,.said{display:none !important}
  .frame{width:auto !important;height:auto !important;margin:0;overflow:visible}
  .paper{transform:none !important;box-shadow:none}
}
`;

// The script: fits the writing to the sheet, scales the sheet to the screen, and runs the buttons.
// It only reads layout sizes that a screen scale doesn't change (offset and scroll sizes).
const JS = `
(function(){
  var paper = document.querySelector('.paper'), frame = document.querySelector('.frame'), ly = document.querySelector('.ly');
  var title = document.querySelector('.title'), pic = document.querySelector('.pic'), size = document.getElementById('page-size'), warn = document.querySelector('.warn');
  var lines = ly.querySelectorAll('p').length + ly.querySelectorAll('.st').length;
  function over(){ return ly.scrollHeight > ly.clientHeight + 1 || ly.scrollWidth > ly.clientWidth + 1; }
  function settle(){
    // what is left over goes above and below, so a short song sits in the middle of the sheet
    var used = 0, kids = ly.querySelectorAll('.st');
    for (var i = 0; i < kids.length; i++) used = Math.max(used, kids[i].offsetTop + kids[i].offsetHeight);
    var spare = ly.clientHeight - used;
    ly.style.paddingTop = spare > 8 ? Math.floor(spare * 0.42) + 'px' : '';
    if (over()) ly.style.paddingTop = '';
  }
  // Tries one way of setting the words, from its largest size down to its smallest. True when they fit.
  function tryFit(cls, from, to){
    ly.className = 'ly ' + cls;
    for (var s = from; s >= to; s -= 0.25){ ly.style.fontSize = s + 'pt'; if (!over()) return true; }
    return false;
  }
  var wantPic = true; // the sender's own choice, from the tick box
  function fit(){
    ly.style.paddingTop = '';
    var ts = 34; title.style.fontSize = ts + 'pt';
    while (ts > 18 && title.offsetHeight > ts * (96 / 72) * 1.08 * 2.3){ ts -= 1; title.style.fontSize = ts + 'pt'; }
    var note = '';
    if (pic){ pic.hidden = !wantPic; pic.classList.remove('small'); }
    var done = (lines <= 34 && tryFit('one', 14.5, 10.5)) || tryFit('two', 12.5, 8.5);
    if (!done && pic && wantPic){ pic.classList.add('small'); done = tryFit('two', 12.5, 8) || tryFit('three', 10.5, 7.5); }
    if (!done && pic && wantPic){ pic.hidden = true; note = 'This is a long song, so the photo was left off to make room for the words.'; done = tryFit('two', 12.5, 8); }
    if (!done) done = tryFit('three', 10.5, 6.5) || tryFit('three loose', 8, 6);
    if (!done) note = 'This song is too long to fit on one page. The last lines are missing from the sheet.';
    warn.textContent = note; warn.hidden = !note;
    settle();
  }
  function scale(){
    var s = Math.min(1, (document.documentElement.clientWidth - 24) / paper.offsetWidth);
    paper.style.transform = s < 1 ? 'scale(' + s + ')' : '';
    frame.style.width = Math.ceil(paper.offsetWidth * s) + 'px'; frame.style.height = Math.ceil(paper.offsetHeight * s) + 'px';
  }
  function paperSize(a4){
    document.documentElement.style.setProperty('--w', a4 ? '210mm' : '8.5in');
    document.documentElement.style.setProperty('--h', a4 ? '297mm' : '11in');
    size.textContent = '@page{size:' + (a4 ? '210mm 297mm' : '8.5in 11in') + ';margin:0}';
    fit(); scale();
  }
  var when = document.querySelector('.date');
  if (when && when.dataset.ms){ try { when.textContent = new Date(Number(when.dataset.ms)).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }); } catch (e) {} }
  // The design. The sender's choice is kept, so it is the one their recipient opens to; anyone else is only choosing what they print.
  var design = document.getElementById('design'), dsaid = document.getElementById('design-said');
  design.addEventListener('change', function(){
    paper.dataset.design = design.value; fit(); scale(); dsaid.textContent = '';
    if (!M.saveApi) return;
    fetch(M.saveApi, { method: 'POST', headers: { 'content-type': 'application/json', 'x-order-key': M.saveKey }, body: JSON.stringify({ design: design.value }) })
      .then(function(r){ dsaid.textContent = r.ok ? 'Saved. This is the design ' + M.recipient + ' sees when they open the lyric sheet.' : 'That design could not be saved. It still prints from here.'; })
      .catch(function(){ dsaid.textContent = 'That design could not be saved. It still prints from here.'; });
  });
  // A small QR code at the foot of the sheet, so the framed words can still play the song.
  var qrBox = document.querySelector('.qr-mini'), qrTick = document.getElementById('show-qr');
  if (qrTick) qrTick.addEventListener('change', function(){ qrBox.hidden = !qrTick.checked; fit(); });
  var sel = document.getElementById('paper'), show = document.getElementById('show-pic');
  if (sel) sel.addEventListener('change', function(){ paperSize(sel.value === 'a4'); });
  if (show && pic) show.addEventListener('change', function(){ wantPic = show.checked; fit(); });
  document.getElementById('print').addEventListener('click', function(){ window.print(); });
  // The words by email. With a mail service connected we send it; without one, their own mail app opens with it written.
  var mail = document.querySelector('.mail'), mailBtn = document.getElementById('mail'), said = document.getElementById('mail-said');
  var addr = document.getElementById('mail-to'), go = document.getElementById('mail-go'), copy = document.getElementById('mail-copy');
  var M = __MAIL__;
  function mailto(){
    var st = ly.querySelectorAll('.st'), words = [];
    for (var i = 0; i < st.length; i++){ var ps = st[i].querySelectorAll('p'), l = []; for (var j = 0; j < ps.length; j++) l.push(ps[j].textContent); words.push(l.join('\\n')); }
    var head = ['"' + M.title + '"', 'A song for ' + M.recipient + ', from ' + M.from, '', 'Listen to it here: ' + M.gift, 'Lyric sheet to print and frame: ' + location.href];
    function make(body){ return 'mailto:?subject=' + encodeURIComponent('The words to "' + M.title + '"') + '&body=' + encodeURIComponent(body.join('\\r\\n')); }
    var full = make(head.concat(['', words.join('\\n\\n')]));
    var phone = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return phone || full.length <= 1900 ? full : make(head.concat(['', 'The words are on the page.']));
  }
  mailBtn.addEventListener('click', function(){
    if (M.api){ mail.hidden = !mail.hidden; if (!mail.hidden){ addr.hidden = false; go.hidden = false; go.disabled = false; addr.focus(); } return; }
    var a = document.createElement('a'); a.href = mailto(); a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove(); mail.hidden = false;
    said.textContent = 'Your mail app should open with the email written. Put in your own address and send it. Nothing opened?';
  });
  copy.addEventListener('click', function(){
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(function(){ said.textContent = 'Link copied. Paste it into an email to yourself.'; }, function(){ said.textContent = 'Copy this link: ' + location.href; });
    else said.textContent = 'Copy this link: ' + location.href;
  });
  function sendMail(){
    var to = addr.value.replace(/^\\s+|\\s+$/g, '');
    if (!/^\\S+@\\S+\\.\\S+$/.test(to)){ said.textContent = 'Type your email address first.'; addr.focus(); return; }
    go.disabled = true; said.textContent = 'Sending.';
    fetch(M.api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: to, take: M.take }) })
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.'); }); })
      .then(function(){ said.textContent = 'Sent to ' + to + '. It can take a minute. If you don\\'t see it, look in your junk folder.'; addr.hidden = true; go.hidden = true; })
      .catch(function(e){ said.textContent = e && e.message && !/fetch/i.test(e.message) ? e.message : 'You seem to be offline. Check your connection and try again.'; go.disabled = false; });
  }
  go.addEventListener('click', sendMail);
  addr.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); sendMail(); } });
  window.addEventListener('resize', scale);
  if (pic){ pic.addEventListener('load', fit); pic.addEventListener('error', function(){ wantPic = false; fit(); }); }
  fit(); scale();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ fit(); scale(); });
})();
`;

/*
  s: { title, recipient, from, paidAt, lyrics, photoUrl, backUrl, signature, giftUrl, mailApi, canEmail, take,
       design (one of DESIGNS), saveApi + saveKey (only for the sender: where their choice of design is kept), qr (what the QR code opens) }
  Section labels ([Verse 1], [Chorus]) are left off: on a framed sheet the song reads as a poem.
*/
// A signature on the sheet: typed, in the handwriting the sender chose, or the drawing of an older one.
function sigHtml(sig) {
  if (Array.isArray(sig)) return strokesSvg(sig, 'sig');
  if (sig && sig.text) return `<p class="sigt sigf-${esc(sig.font)}">${esc(sig.text)}</p>`;
  return '';
}
// What the email button needs, written into the page's script. "<" is escaped so nothing in a title can end the script early.
function mailData(s) {
  return JSON.stringify({ title: s.title || 'Your song', recipient: s.recipient || '', from: s.from || '', gift: s.giftUrl || '',
    api: s.canEmail ? s.mailApi : '', take: s.take == null ? null : s.take, saveApi: s.saveApi || '', saveKey: s.saveKey || '' }).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
}
function sheetHtml(s) {
  const stanzas = parseSections(s.lyrics).filter(x => x.lines.length)
    .map(x => `<div class="st">${x.lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>`).join('\n      ');
  const heart = `<svg viewBox="-110 -80 220 200" aria-hidden="true"><path d="${HEART}" fill="#8B949F"/></svg>`;
  const design = DESIGNS.some(d => d[0] === s.design) ? s.design : 'classic';
  const grooves = '<svg class="grooves" viewBox="-100 -100 200 200" aria-hidden="true">' +
      Array.from({ length: 34 }, (_, i) => `<circle r="${(99 - i * 2.05).toFixed(2)}" fill="none" stroke="#C9D9DE" stroke-width="${i % 7 === 0 ? '.42' : '.16'}"/>`).join('') +
      '<circle r="27" fill="#E3F1F4"/><circle r="27" fill="none" stroke="#A9D6DE" stroke-width=".35"/>' +
      `<path d="${HEART}" transform="scale(.075) translate(0 -24)" fill="#A9D6DE"/></svg>`;
  const fallbackDate = new Date(s.paidAt || Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.title || 'Lyric sheet')} - lyric sheet</title>
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&family=Jost:wght@400;500&family=Mrs+Saint+Delafield&family=Great+Vibes&family=Allura&family=Alex+Brush&family=Dancing+Script:wght@500&family=Sacramento&family=Pinyon+Script&family=Homemade+Apple&display=swap" rel="stylesheet">
<style>${CSS}</style>
<style id="page-size">@page{size:8.5in 11in;margin:0}</style>
</head>
<body>
<div class="bar">
  <a href="${esc(s.backUrl)}">Back to the song</a><span class="grow"></span>
  ${s.photoUrl ? '<label><input type="checkbox" id="show-pic" checked> Show the photo</label>' : ''}
  <label>Design <select id="design">${DESIGNS.map(d => `<option value="${d[0]}"${d[0] === design ? ' selected' : ''}>${d[1]}</option>`).join('')}</select></label>
  <label>Paper <select id="paper"><option value="letter">US Letter</option><option value="a4">A4</option></select></label>
  ${s.qr ? '<label><input type="checkbox" id="show-qr"> Add a QR code that plays the song</label>' : ''}
  <button type="button" id="mail">Email it to myself</button>
  <button class="go" type="button" id="print">Print or save as PDF</button>
</div>
<div class="mail" hidden>
  ${s.canEmail ? '<input type="email" id="mail-to" autocomplete="email" inputmode="email" maxlength="200" placeholder="Your email address" aria-label="Your email address"><button type="button" id="mail-go">Send it to me</button>' : '<input id="mail-to" hidden><button type="button" id="mail-go" hidden></button>'}
  <p id="mail-said" role="status"></p>
  ${s.canEmail ? '<p>You get the words and the links to the song and this sheet. We use your address for this one email only.</p><button type="button" id="mail-copy" hidden></button>' : '<button type="button" class="plain" id="mail-copy">Copy the link instead</button>'}
</div>
<p class="hint">To keep a copy, choose "Save as PDF" in the print window. For framing, print at 100% (no "fit to page") on heavy paper.</p>
<p class="said" id="design-said" role="status"></p>
<p class="warn" role="status" hidden></p>
<div class="frame">
  <div class="paper" data-design="${design}">
    ${grooves}
    <svg class="disc" viewBox="0 0 48 48" aria-hidden="true">
      <defs><radialGradient id="pl" cx="34%" cy="28%" r="80%"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".5" stop-color="#C8CED6"/><stop offset="1" stop-color="#8B949F"/></radialGradient></defs>
      <circle cx="24" cy="24" r="23.3" fill="url(#pl)" stroke="#8B949F" stroke-width=".7"/>
      <circle cx="24" cy="24" r="19.4" fill="none" stroke="rgba(40,52,64,.22)" stroke-width=".45"/>
      <circle cx="24" cy="24" r="16.2" fill="none" stroke="rgba(40,52,64,.22)" stroke-width=".45"/>
      <circle cx="24" cy="24" r="13" fill="none" stroke="rgba(40,52,64,.22)" stroke-width=".45"/>
      <circle cx="24" cy="24" r="9.6" fill="#FFFFFF" stroke="#8B949F" stroke-width=".5"/>
      <path d="${HEART}" transform="translate(24 24) scale(.052) translate(0 -24)" fill="#0E2A33"/>
    </svg>
    <p class="kicker">A song for ${esc(s.recipient)}</p>
    <h1 class="title">${esc(s.title || 'Your song')}</h1>
    <div class="orn"><i></i>${heart}<i></i></div>
    ${s.photoUrl ? `<img class="pic" src="${esc(s.photoUrl)}" alt="A photo from ${esc(s.from)}">` : ''}
    <div class="ly one">
      ${stanzas}
    </div>
    <div class="orn low"><i></i>${heart}<i></i></div>
    ${sigHtml(s.signature)}
    <p class="from">From ${esc(s.from)}</p>
    <p class="date" data-ms="${Number(s.paidAt) || ''}">${esc(fallbackDate)}</p>
    ${s.qr ? `<div class="qr-mini" hidden>${qrSvg(s.qr)}<span>Scan to hear it</span></div>` : ''}
    <p class="mark">${MARK}</p>
  </div>
</div>
<script>${JS.replace('__MAIL__', () => mailData(s))}</script>
</body>
</html>`;
}

/* ---------- the printable card: a QR code that opens the song, to tuck into a card or tie to a gift ---------- */
const qrcode = require('qrcode-generator');
// A QR code as one drawing: the dark squares, on white, with the quiet border a phone's camera needs around it.
// The Songpost heart sits at its centre, ringed in sea glass. The code is made with room to spare (it can lose a quarter of
// itself and still read), and the heart covers far less than that.
function qrSvg(text) {
  const q = qrcode(0, 'Q'); q.addData(String(text)); q.make();
  const n = q.getModuleCount(), m = 4, mid = m + n / 2, badge = n * 0.115; // the badge's radius, in squares
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!q.isDark(r, c)) continue;
    if (Math.hypot(c + 0.5 - n / 2, r + 0.5 - n / 2) < badge + 0.6) continue; // cleared for the heart
    d += `M${c + m} ${r + m}h1v1h-1z`;
  }
  return `<svg viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" role="img" aria-label="A QR code that opens the song"><rect width="100%" height="100%" fill="#fff"/>` +
    `<path d="${d}" fill="#0E2A33" shape-rendering="crispEdges"/>` +
    `<circle cx="${mid}" cy="${mid}" r="${badge.toFixed(2)}" fill="#fff" stroke="#6CBCCB" stroke-width="${(n * 0.012).toFixed(2)}"/>` +
    `<path d="${HEART}" transform="translate(${mid} ${mid}) scale(${(badge * 0.0064).toFixed(4)}) translate(0 -18)" fill="#0E2A33"/></svg>`;
}
const CARD_CSS = `
:root{--w:8.5in;--h:11in;--cw:5in;--ch:7in;
  --serif:"Cormorant Garamond","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --sans:"Jost","Avenir Next","Century Gothic","Helvetica Neue",Arial,sans-serif}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:#E3EBED;color:#0E2A33;font-family:var(--sans)}
.bar{max-width:820px;margin:0 auto;padding:16px 16px 4px;display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center}
.bar a{color:inherit;font-size:.92rem}
.bar .grow{flex:1}
.bar button,.bar select{font:inherit;font-size:.92rem;padding:9px 16px;border:1px solid #0E2A33;border-radius:3px;background:transparent;color:#0E2A33;cursor:pointer}
.bar button.go{background:#0E2A33;color:#fff}
.bar label{font-size:.92rem;display:inline-flex;align-items:center;gap:6px}
.hint{max-width:820px;margin:0 auto;padding:6px 16px 14px;font-size:.86rem;color:#52686E}
.frame{margin:0 auto 40px;overflow:hidden}
.paper{width:var(--w);height:var(--h);background:#fff;position:relative;transform-origin:top left;display:flex;align-items:center;justify-content:center;box-shadow:0 30px 60px -30px rgba(6,40,50,.5)}
.cut{position:relative;width:var(--cw);height:var(--ch)}
.cut > i{position:absolute;background:#8B949F}
.cut > i.h{width:.2in;height:.5pt}.cut > i.v{width:.5pt;height:.2in}
.cut > .tl.h{left:-.28in;top:0}.cut > .tl.v{left:0;top:-.28in}
.cut > .tr.h{right:-.28in;top:0}.cut > .tr.v{right:0;top:-.28in}
.cut > .bl.h{left:-.28in;bottom:0}.cut > .bl.v{left:0;bottom:-.28in}
.cut > .br.h{right:-.28in;bottom:0}.cut > .br.v{right:0;bottom:-.28in}
.card{width:100%;height:100%;font-size:calc(var(--cw) / 30);position:relative;background:#fff;overflow:hidden;
  display:flex;flex-direction:column;align-items:center;text-align:center;padding:2.7em 2.5em 2em}
.card::before{content:"";position:absolute;inset:1.1em;border:.09em solid #0E2A33;pointer-events:none}
.card::after{content:"";position:absolute;inset:1.4em;border:.045em solid #6CBCCB;pointer-events:none}
.c-disc{width:3.5em;height:3.5em;flex:none}
.c-for{font:italic 500 1.3em/1.2 var(--serif);color:#52686E;margin:.65em 0 0}
.c-name{font:italic 600 3.4em/1.05 var(--serif);margin:.02em 0 0;max-width:100%;overflow-wrap:anywhere}
.c-title{font:italic 500 1.2em/1.25 var(--serif);color:#52686E;margin:.45em 0 0;max-width:100%;overflow-wrap:anywhere}
.c-gap{flex:1;min-height:.5em}
.c-qr{width:12.8em;height:12.8em;flex:none}
.c-qr svg{display:block;width:100%;height:100%}
.c-scan{font:500 .8em/1.4 var(--sans);margin:.6em 0 0;max-width:18em}
.c-from{font:italic 500 1.4em/1.2 var(--serif);margin:0;max-width:100%;overflow-wrap:anywhere}
.c-url{font:400 .54em/1.3 var(--sans);color:#52686E;margin:.55em 0 0;max-width:100%;overflow-wrap:anywhere}
.c-mark{display:inline-flex;align-items:center;gap:.4em;font:600 1.05em/1 var(--serif);letter-spacing:.01em;color:#0E2A33;margin:.75em 0 0;flex:none}
.c-mark svg{width:1em;height:1em;flex:none}
/* the sea-glass card: the colour the brand is known by, with the code on a white panel */
.card.blue{background:#6CBCCB}
.card.blue::before{border-color:#FFFFFF}
.card.blue::after{border-color:rgba(255,255,255,.65)}
.card.blue .c-for,.card.blue .c-title,.card.blue .c-url{color:#0E2A33;opacity:.82}
.card.blue .c-qr{padding:.4em;background:#fff;border-radius:.4em;box-shadow:0 .3em .9em -.4em rgba(6,40,50,.55)}
/* the small square tag: the name, the code, and who it is from */
.card.tag{padding:2.3em 2.2em 1.9em}
.card.tag .c-disc,.card.tag .c-title,.card.tag .c-url{display:none}
.card.tag .c-for{margin-top:0;font-size:1.15em}
.card.tag .c-name{font-size:2.5em}
.card.tag .c-qr{width:11.2em;height:11.2em}
.card.tag .c-scan{font-size:.74em;margin-top:.45em}
.card.tag .c-from{font-size:1.2em}
.card.tag .c-mark{margin-top:.5em;font-size:.95em}
@media print{
  body{background:#fff}
  .bar,.hint{display:none !important}
  .frame{width:auto !important;height:auto !important;margin:0;overflow:visible}
  .paper{transform:none !important;box-shadow:none}
}
`;
const CARD_JS = `
(function(){
  var root = document.documentElement, paper = document.querySelector('.paper'), frame = document.querySelector('.frame');
  var card = document.querySelector('.card'), name = document.querySelector('.c-name'), page = document.getElementById('page-size');
  var size = document.getElementById('size'), sheet = document.getElementById('paper'), tone = document.getElementById('tone');
  tone.addEventListener('change', function(){ card.classList.toggle('blue', tone.value === 'blue'); });
  function fitName(){ // a long name is written smaller, on one line or two
    var big = card.classList.contains('tag') ? 2.5 : 3.4, s = big; name.style.fontSize = s + 'em';
    while (s > 1.4 && (name.scrollWidth > name.clientWidth + 1 || name.offsetHeight > parseFloat(getComputedStyle(name).fontSize) * 2.3)){ s -= 0.1; name.style.fontSize = s.toFixed(2) + 'em'; }
  }
  function scale(){
    var s = Math.min(1, (root.clientWidth - 24) / paper.offsetWidth);
    paper.style.transform = s < 1 ? 'scale(' + s + ')' : '';
    frame.style.width = Math.ceil(paper.offsetWidth * s) + 'px'; frame.style.height = Math.ceil(paper.offsetHeight * s) + 'px';
  }
  function lay(){
    var tag = size.value === 'tag', a4 = sheet.value === 'a4';
    root.style.setProperty('--cw', tag ? '3.5in' : '5in'); root.style.setProperty('--ch', tag ? '3.5in' : '7in');
    root.style.setProperty('--w', a4 ? '210mm' : '8.5in'); root.style.setProperty('--h', a4 ? '297mm' : '11in');
    page.textContent = '@page{size:' + (a4 ? '210mm 297mm' : '8.5in 11in') + ';margin:0}';
    card.classList.toggle('tag', tag); fitName(); scale();
  }
  size.addEventListener('change', lay); sheet.addEventListener('change', lay);
  document.getElementById('print').addEventListener('click', function(){ window.print(); });
  window.addEventListener('resize', scale);
  lay();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(lay);
})();
`;
/* s: { recipient, from, title, tier, giftUrl (shown in small print), qr (what the code opens), backUrl } */
function qrCardHtml(s) {
  const gold = s.tier !== 'platinum';
  const disc = `<svg class="c-disc" viewBox="0 0 48 48" aria-hidden="true">
      <defs><radialGradient id="cd" cx="34%" cy="28%" r="80%"><stop offset="0" stop-color="${gold ? '#FFF6D8' : '#FFFFFF'}"/><stop offset=".5" stop-color="${gold ? '#D3A53A' : '#C8CED6'}"/><stop offset="1" stop-color="${gold ? '#9A7218' : '#8B949F'}"/></radialGradient></defs>
      <circle cx="24" cy="24" r="23.3" fill="url(#cd)" stroke="${gold ? '#9A7218' : '#8B949F'}" stroke-width=".7"/>
      <circle cx="24" cy="24" r="19.4" fill="none" stroke="rgba(40,52,64,.22)" stroke-width=".45"/>
      <circle cx="24" cy="24" r="16.2" fill="none" stroke="rgba(40,52,64,.22)" stroke-width=".45"/>
      <circle cx="24" cy="24" r="13" fill="none" stroke="rgba(40,52,64,.22)" stroke-width=".45"/>
      <circle cx="24" cy="24" r="9.6" fill="#FFFFFF" stroke="${gold ? '#9A7218' : '#8B949F'}" stroke-width=".5"/>
      <path d="${HEART}" transform="translate(24 24) scale(.052) translate(0 -24)" fill="#0E2A33"/>
    </svg>`;
  const mark = pos => `<i class="${pos} h"></i><i class="${pos} v"></i>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>A card for ${esc(s.recipient)}'s song</title>
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Jost:wght@400;500&display=swap" rel="stylesheet">
<style>${CARD_CSS}</style>
<style id="page-size">@page{size:8.5in 11in;margin:0}</style>
</head>
<body>
<div class="bar">
  <a href="${esc(s.backUrl)}">Back to the song</a><span class="grow"></span>
  <label>Colour <select id="tone"><option value="blue">Sea glass</option><option value="white">White (less ink)</option></select></label>
  <label>Size <select id="size"><option value="card">Card, 5 by 7 in</option><option value="tag">Gift tag, 3.5 in square</option></select></label>
  <label>Paper <select id="paper"><option value="letter">US Letter</option><option value="a4">A4</option></select></label>
  <button class="go" type="button" id="print">Print or save as PDF</button>
</div>
<p class="hint">Print at 100% (no "fit to page") on heavy paper, then cut along the corner marks. Tuck it into a card, or tie it to flowers or a gift. When ${esc(s.recipient)} points a phone's camera at the square, the song opens.</p>
<div class="frame">
  <div class="paper">
    <div class="cut">${mark('tl')}${mark('tr')}${mark('bl')}${mark('br')}
      <div class="card blue">
        ${disc}
        <p class="c-for">A song for</p>
        <h1 class="c-name" dir="auto">${esc(s.recipient)}</h1>
        ${s.title ? `<p class="c-title" dir="auto">${esc(s.title)}</p>` : ''}
        <span class="c-gap"></span>
        <div class="c-qr">${qrSvg(s.qr)}</div>
        <p class="c-scan">Point your phone's camera here to open it.</p>
        <span class="c-gap"></span>
        <p class="c-from" dir="auto">From ${esc(s.from)}</p>
        <p class="c-url">${esc(String(s.giftUrl).replace(/^https?:\/\//, ''))}</p>
        <p class="c-mark">${MARK}</p>
      </div>
    </div>
  </div>
</div>
<script>${CARD_JS}</script>
</body>
</html>`;
}

module.exports = { sheetHtml, qrCardHtml, DESIGNS: DESIGNS.map(d => d[0]) };
