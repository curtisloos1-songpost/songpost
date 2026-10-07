'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const db = require('./db');
const notify = require('./notify');
const { getEngine, getBackup, premiumModel } = require('./engines');
const { parseSections } = require('./sections');

/*
  A recording is one of three kinds, kept on the order as gen_kind while it runs:

    take    a preview recorded before payment. Uses up one of the order's takes and counts towards
            the visitor's free previews. A failure gives both back.
    redo    the one free redo after payment. The new recording replaces the one on the gift page.
            A failure gives the redo back.
    second  the second take that comes with Platinum, when the customer only recorded one before paying.
            The recording they chose stays the main one.
    premium the recording on the premium model that comes with Platinum, when there is a premium model.
            It becomes the main one; the earlier takes stay, and the sender can put one of them back.
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
  const names = s => s.lines.some(l => l.toLowerCase().includes(want));
  // The first verse, chorus or bridge that sings the name. A name that only appears in the outro (a theme
  // song's dedication) doesn't count: the preview would be the last few seconds of the song.
  let i = want ? sections.findIndex(s => names(s) && !/outro|ending|intro/i.test(s.name)) : -1;
  const hasName = i >= 0;
  if (i < 0) i = sections.findIndex(s => /chorus/i.test(s.name));
  if (i < 0 && want) i = sections.findIndex(names);
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

// What a Platinum record is still owed after payment, or null:
//   premium  its recording on the premium model, when the song was sold with one and there still is one
//   second   a second take, when there is no premium model and the customer only recorded one before paying
function owedKind(o) {
  if (!o || !o.paid || o.removed || o.tier !== 'platinum' || !o.takes.length) return null;
  if (o.engine === 'upload') return null; // the owner's own recording, added from the admin page: there is nothing for the studio to record
  if (o.premium === 1 && premiumModel()) return 'premium';
  return o.takes.length === 1 ? 'second' : null;
}
// Records what a Platinum record is owed. The same words and the same notes as the recording the customer chose, performed again.
function startOwedTake(id) {
  const o = db.getOrder(id), kind = owedKind(o);
  if (!kind || o.status === 'generating') return false;
  try { getEngine(); } catch (e) { return false; }
  const t = o.takes[o.chosen] || o.takes[0];
  db.updateOrder(id, { status: 'generating', error: null, gen_started_at: Date.now(), gen_kind: kind, gen_event_id: null,
    title: t.title || o.title, lyrics: t.lyrics || o.lyrics, style: t.style || o.style,
    arrangement: typeof t.arrangement === 'string' ? t.arrangement : '' });
  startGeneration(id);
  return true;
}
// A premium recording that could not be made is tried again by itself, after each wait in PREMIUM_RETRY_MS. The
// customer has paid for it and may not come back to press "Record it now". After the last try it waits for them, or
// for the next restart; the admin page shows it as still owed.
const owedTries = new Map();
function retryOwedLater(id) {
  const n = owedTries.get(id) || 0, wait = cfg.premiumRetryMs[n];
  if (!wait) return;
  owedTries.set(id, n + 1);
  const timer = setTimeout(() => { try { startOwedTake(id); } catch (e) { console.error('Could not start the owed recording for order', id, e); } }, wait);
  if (timer.unref) timer.unref();
}
// Once another recording of a paid song is out of the way, whatever is still owed is started.
function afterRecording(id, kind, failed) {
  try {
    if (kind === 'premium') { if (failed) retryOwedLater(id); else owedTries.delete(id); return; }
    if (owedKind(db.getOrder(id))) startOwedTake(id);
  } catch (e) { console.error('Could not look after what is owed for order', id, e); }
}
// At start-up: premium recordings that a restart cut short, or that never began.
function resumeOwed() {
  let n = 0;
  for (const o of db.owedPremium()) {
    const timer = setTimeout(() => { try { startOwedTake(o.id); } catch (e) { console.error('Could not start the owed recording for order', o.id, e); } }, 5000 + 20000 * n++);
    if (timer.unref) timer.unref();
  }
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
    let engine = getEngine(), out, stoodInFor = null;
    // A Platinum record's recordings after payment are made on the premium model, when there is one.
    const premium = order.paid && order.tier === 'platinum' && order.premium && (kind === 'premium' || kind === 'redo') ? premiumModel() : null;
    if (kind === 'premium' && !premium) throw Object.assign(new Error('There is no premium model to record on'), { noted: true });
    const voice = /duet/i.test(order.voice) ? 'duet' : /woman/i.test(order.voice) ? 'female' : /man/i.test(order.voice) ? 'male' : 'any';
    const song = { title: order.title, style: order.style, lyrics: sungLyrics(order), voice, genre: order.genre, tone: order.tone, arrangement: order.arrangement || '' };
    if (premium) song.model = premium;
    const why = e => (e && (e.detail || e.publicMessage || e.message)) || 'The recording failed';
    // Running counts for the admin page's engine report. Counting never gets in the way of a song.
    const count = (what, name, amount) => { try { db.addUsage(`eng_${what}:${name}`, 1, amount || 0); } catch (x) { /* not counted */ } };
    try {
      out = await engine.generate(song);
    } catch (e) {
      // The first engine could not record. If there is a backup, the song is recorded there and the customer notices nothing.
      // Not when the song itself was turned down (422): that is the customer's to change, and no outage.
      // Nor a premium recording: one made on the other engine would not be what the customer paid for.
      const backup = premium ? null : getBackup();
      if (!backup || (e && e.status === 422)) throw e;
      console.error(`The ${engine.name} engine could not record order ${id}; recording it on ${backup.name} instead.`, e);
      db.noteErr('music:' + engine.name, why(e));
      count('fail', engine.name);
      stoodInFor = engine.name; engine = backup;
      try { out = await engine.generate(song); }
      catch (e2) { if (!(e2 && e2.status === 422)) { db.noteErr('music:' + engine.name, why(e2)); count('fail', engine.name); } throw Object.assign(e2, { noted: true }); }
      count('standin', engine.name);
    }
    db.noteOk('music:' + engine.name);
    count('ok', engine.name, order.gen_started_at ? Math.round((Date.now() - order.gen_started_at) / 1000) : 0);
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
      title: order.title, lyrics: order.lyrics, style: order.style, arrangement: order.arrangement || '',
      plain: out.plan === 'plain' || undefined, // plain: the studio turned down the full plan, and the plain one was used
      stoodInFor: stoodInFor || undefined,      // stoodInFor: the engine that could not record this take, when the backup did
      model: out.model || undefined, premium: premium ? true : undefined }); // premium: recorded on the premium model
    const patch = { status: 'ready', error: null, takes, engine: engine.name, gen_kind: null, gen_event_id: null };
    if (premium) patch.premium = 2; // the premium recording itself, or a redo made on the premium model: either way they have it
    // A redo replaces the song on the gift page. A Platinum second take, or a preview that finishes after
    // the song was paid for, is added without changing the recording the customer chose.
    // The premium recording becomes the main one too: it is what a Platinum record is for.
    if (kind === 'redo' || kind === 'premium' || (kind === 'take' && !fresh.paid)) patch.chosen = takes.length - 1;
    db.updateOrder(id, patch);
    // Count the music made, for the cost figures on the admin page.
    // An engine that charges by the song says what this one cost; the rest are costed by the minute.
    try { db.addUsage('rec_' + kind, 1, out.durationSec || 0); if (out.flatCost != null) { db.addUsage('rec_flat', 1, out.durationSec || 0); db.addUsage('rec_flat_usd', 1, out.flatCost); } } catch (e) { /* counting never blocks a song */ }
    if (kind === 'redo') {
      notify.send(id, fresh.contact, `Your new recording for ${fresh.recipient} is ready`,
        `We recorded your song for ${fresh.recipient} again. The new recording is on the same link:\n${cfg.baseUrl}/g/${id}`);
    }
    afterRecording(id, kind, false);
    if (kind === 'premium') {
      notify.send(id, fresh.contact, `The premium recording for ${fresh.recipient} is ready`,
        `Your Platinum record's premium recording is ready, and it now plays first on ${fresh.recipient}'s page. Your earlier takes are still there, and you can put one of them first instead:\n${cfg.baseUrl}/?order=${id}&key=${fresh.key}\n\nTheir page: ${cfg.baseUrl}/g/${id}`);
    }
  } catch (e) {
    console.error('Recording failed for order', id, e);
    // A song the music service turned down for its words (422) is the customer's to fix, not an outage.
    if (!(e && (e.status === 422 || e.noted))) { let name = 'unknown'; try { name = getEngine().name; } catch (x) { /* a wrong engine name */ } db.noteErr('music:' + name, (e && (e.detail || e.publicMessage || e.message)) || 'The recording failed'); try { db.addUsage('eng_fail:' + name, 1, 0); } catch (x) { /* not counted */ } }
    fail(id, e.publicMessage || 'The recording did not finish. Try again.');
    afterRecording(id, kind, true);
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

module.exports = { startGeneration, recoverInterrupted, owedKind, startOwedTake, resumeOwed, makePreview, previewTarget, sungLyrics };
