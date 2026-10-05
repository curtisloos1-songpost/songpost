'use strict';
// The lyric sheet that comes with a Platinum record: one page, made to be printed and framed.
// The page sizes its own writing so that a song fits on a single sheet: smaller writing, then two columns, then a smaller
// photo, then three columns, and last of all no photo. If even that is not enough it says so (see the script at the end).
const { parseSections } = require('./sections');
const { strokesSvg } = require('./touches');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEART = 'M0,-30C-25,-75 -100,-55 -100,-5C-100,45 -40,75 0,110C40,75 100,45 100,-5C100,-55 25,-75 0,-30Z';

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
.st{margin:0 0 .92em;break-inside:avoid}
.st:last-child{margin-bottom:0}
.st p{margin:0;overflow-wrap:anywhere}
.orn.low{margin:.16in 0 .1in}
.sig{display:block;height:.5in;max-width:2.6in;margin:0 auto .04in;color:var(--ink);flex:none}
.from{font:italic 500 15pt/1.2 var(--serif);margin:0;max-width:100%;overflow-wrap:anywhere}
.date{font:500 8pt/1.3 var(--sans);letter-spacing:.22em;text-transform:uppercase;color:var(--soft);margin:.06in 0 0}
.mark{font:500 6.5pt/1 var(--sans);letter-spacing:.3em;text-transform:uppercase;color:var(--silver);margin:.13in 0 0}
@media print{
  body{background:#fff}
  .bar,.hint,.warn{display:none !important}
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
  var sel = document.getElementById('paper'), show = document.getElementById('show-pic');
  if (sel) sel.addEventListener('change', function(){ paperSize(sel.value === 'a4'); });
  if (show && pic) show.addEventListener('change', function(){ wantPic = show.checked; fit(); });
  document.getElementById('print').addEventListener('click', function(){ window.print(); });
  window.addEventListener('resize', scale);
  if (pic){ pic.addEventListener('load', fit); pic.addEventListener('error', function(){ wantPic = false; fit(); }); }
  fit(); scale();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ fit(); scale(); });
})();
`;

/*
  s: { title, recipient, from, paidAt, lyrics, photoUrl, backUrl, signature }
  Section labels ([Verse 1], [Chorus]) are left off: on a framed sheet the song reads as a poem.
*/
function sheetHtml(s) {
  const stanzas = parseSections(s.lyrics).filter(x => x.lines.length)
    .map(x => `<div class="st">${x.lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>`).join('\n      ');
  const heart = `<svg viewBox="-110 -80 220 200" aria-hidden="true"><path d="${HEART}" fill="#8B949F"/></svg>`;
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
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&family=Jost:wght@400;500&display=swap" rel="stylesheet">
<style>${CSS}</style>
<style id="page-size">@page{size:8.5in 11in;margin:0}</style>
</head>
<body>
<div class="bar">
  <a href="${esc(s.backUrl)}">Back to the song</a><span class="grow"></span>
  ${s.photoUrl ? '<label><input type="checkbox" id="show-pic" checked> Show the photo</label>' : ''}
  <label>Paper <select id="paper"><option value="letter">US Letter</option><option value="a4">A4</option></select></label>
  <button class="go" type="button" id="print">Print or save as PDF</button>
</div>
<p class="hint">To keep a copy, choose "Save as PDF" in the print window. For framing, print at 100% (no "fit to page") on heavy paper.</p>
<p class="warn" role="status" hidden></p>
<div class="frame">
  <div class="paper">
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
    ${strokesSvg(s.signature, 'sig')}
    <p class="from">From ${esc(s.from)}</p>
    <p class="date" data-ms="${Number(s.paidAt) || ''}">${esc(fallbackDate)}</p>
    <p class="mark">Songpost</p>
  </div>
</div>
<script>${JS}</script>
</body>
</html>`;
}

module.exports = { sheetHtml };
