'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const db = require('./db');
const notify = require('./notify');
const { getEngine } = require('./engines');
const { parseSections } = require('./sections');

/*
  A recording is one of three kinds, kept on the order as gen_kind while it runs:

    take    a preview recorded before payment. Uses up one of the order's takes and counts towards
            the visitor's free previews. A failure gives both back.
    redo    the one free redo after payment. The new recording replaces the one on the gift page.
            A failure gives the redo back.
    second  the second take that comes with Platinum, when the customer only recorded one before paying.
            The recording they chose stays the main one.
*/

// The free preview: a stretch of the finished file, cut without re-encoding.
function makePreview(audio, mime, durationSec, previewSec, startSec) {
  startSec = Math.max(0, Math.min(startSec || 0, (durationSec || 0) - previewSec));
  if (!durationSec) startSec = 0;
  if (mime === 'audio/wav' && audio.length > 44) {
    const byteRate = audio.readUInt32LE(28), align = audio.readUInt16LE(32) || 2;
    let from = Math.floor(byteRate * startSec); from -= from % align;
    let len = Math.min(audio.length - 44 - from, byteRate * previewSec); len -= len % align;
    const out = Buffer.concat([audio.subarray(0, 44), audio.subarray(44 + from, 44 + from + len)]);
    out.writeUInt32LE(36 + len, 4); out.writeUInt32LE(len, 40);
    return out;
  }
  // MP3 is a chain of independent frames, so a byte cut plays. Skip any ID3 tag, then start on a frame boundary.
  let dataStart = 0;
  if (audio.length > 10 && audio.toString('latin1', 0, 3) === 'ID3') {
    dataStart = 10 + ((audio[6] & 0x7f) << 21 | (audio[7] & 0x7f) << 14 | (audio[8] & 0x7f) << 7 | (audio[9] & 0x7f));
  }
  const bytesPerSec = durationSec ? (audio.length - dataStart) / durationSec : 16000; // 128 kbps when unknown
  let from = dataStart + Math.floor(bytesPerSec * startSec);
  if (startSec > 0 && audio[dataStart] === 0xff) {
    const b1 = audio[dataStart + 1], b2 = audio[dataStart + 2] & 0xfc;
    for (let i = from; i < Math.min(audio.length - 4, from + 4000); i++) {
      if (audio[i] === 0xff && audio[i + 1] === b1 && (audio[i + 2] & 0xfc) === b2) { from = i; break; }
    }
  }
  return audio.subarray(from, Math.min(audio.length, from + Math.floor(bytesPerSec * previewSec)));
}

// Which section of the lyrics the preview should open on: the first one that sings the name, else the chorus.
function previewTarget(lyrics, recipient) {
  const sections = parseSections(lyrics), want = String(recipient || '').trim().toLowerCase();
  let i = want ? sections.findIndex(s => s.lines.some(l => l.toLowerCase().includes(want))) : -1;
  const hasName = i >= 0;
  if (i < 0) i = sections.findIndex(s => /chorus/i.test(s.name));
  if (i < 0) return null;
  return { index: i, name: sections[i].name, lines: sections[i].lines.slice(0, 4), hasName };
}

// The words sent to the singer: the name spelled the way it sounds, when the customer gave that.
function sungLyrics(order) {
  const name = String(order.recipient || '').trim(), say = String(order.say_name || '').trim();
  if (!name || !say) return order.lyrics;
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return order.lyrics.replace(new RegExp('(^|[^\\p{L}])' + safe + '(?![\\p{L}])', 'giu'), (m, pre) => pre + say);
}

// A recording that didn't finish. Gives back whatever starting it used up.
function fail(id, message) {
  const o = db.getOrder(id);
  if (!o || o.status !== 'generating') return;
  const kind = o.gen_kind || 'take';
  const patch = { status: o.takes.length ? 'ready' : 'failed', error: message, gen_kind: null, gen_event_id: null };
  if (kind === 'take') patch.attempts = Math.max(0, o.attempts - 1); // a failed recording doesn't use up a take
  if (kind === 'redo') patch.redo_at = null;                          // ...or the free redo
  if (o.gen_event_id) db.removeEvent(o.gen_event_id);                 // ...or one of today's free previews
  db.updateOrder(id, patch);
}

async function run(id) {
  const order = db.getOrder(id);
  if (!order) return;
  const kind = order.gen_kind || 'take';
  try {
    const engine = getEngine();
    const voice = /duet/i.test(order.voice) ? 'duet' : /woman/i.test(order.voice) ? 'female' : /man/i.test(order.voice) ? 'male' : 'any';
    const out = await engine.generate({ title: order.title, style: order.style, lyrics: sungLyrics(order), voice, genre: order.genre, tone: order.tone });
    const fresh = db.getOrder(id);
    if (!fresh) return; // the song was deleted while it was recording
    const n = fresh.takes.length;
    const file = `${id}-${n}.${out.ext}`, preview = `${id}-${n}-preview.${out.ext}`;
    fs.writeFileSync(path.join(db.mediaDir, file), out.audio);
    // Open the preview where the name is sung, when the engine tells us where each section starts.
    const target = previewTarget(order.lyrics, order.recipient);
    const starts = Array.isArray(out.sectionStarts) ? out.sectionStarts : null;
    const at = target && starts && Number.isFinite(starts[target.index]) && out.durationSec ? starts[target.index] : null;
    fs.writeFileSync(path.join(db.mediaDir, preview), makePreview(out.audio, out.mime, out.durationSec, cfg.previewSeconds, at || 0));
    const genSeconds = fresh.gen_started_at ? Math.round((Date.now() - fresh.gen_started_at) / 1000) : null;
    const takes = fresh.takes.concat({ file, preview, mime: out.mime, duration: out.durationSec, genSeconds, engine: engine.name,
      previewSection: at != null ? { name: target.name, lines: target.lines, hasName: target.hasName } : null,
      title: order.title, lyrics: order.lyrics, style: order.style });
    const patch = { status: 'ready', error: null, takes, engine: engine.name, gen_kind: null, gen_event_id: null };
    // A redo replaces the song on the gift page. A Platinum second take, or a preview that finishes after
    // the song was paid for, is added without changing the recording the customer chose.
    if (kind === 'redo' || (kind === 'take' && !fresh.paid)) patch.chosen = takes.length - 1;
    db.updateOrder(id, patch);
    if (kind === 'redo') {
      notify.send(id, fresh.contact, `Your new recording for ${fresh.recipient} is ready`,
        `We recorded your song for ${fresh.recipient} again. The new recording is on the same link:\n${cfg.baseUrl}/g/${id}`);
    }
  } catch (e) {
    console.error('Recording failed for order', id, e);
    fail(id, e.publicMessage || 'The recording did not finish. Try again.');
  }
}

// Starts a recording in the background. The browser polls the order until it is ready.
function startGeneration(id) {
  run(id).catch(e => { console.error('Recording crashed for order', id, e); fail(id, 'The recording did not finish. Try again.'); });
}

// A recording that was running when the server stopped can't be resumed. Called once at start-up.
function recoverInterrupted() {
  for (const o of db.generatingOrders()) fail(o.id, 'The recording was interrupted. Try again.');
}

module.exports = { startGeneration, recoverInterrupted, makePreview, previewTarget, sungLyrics };
