'use strict';
// Mureka. Docs: https://platform.mureka.ai/docs/
// A song is asked for with its lyrics and one description of the sound; Mureka arranges and times it itself.
// The request starts a task, which is asked about every few seconds until the song is ready.
const cfg = require('../config');
const db = require('../db');
const { PublicError } = require('../errors');
const { parseSections } = require('../sections');

const BASE = 'https://api.mureka.ai';
// Mureka's list prices, in dollars a song. COST_MUREKA_PER_SONG replaces them all, if set.
const PRICES = { 'mureka-7.6': 0.03, 'mureka-o2': 0.045, 'mureka-8': 0.045, 'mureka-9': 0.045, 'mureka-9.5': 0.15 };
const MODELS = ['auto'].concat(Object.keys(PRICES));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// The model in use: the owner's choice on the admin page, or the one in the settings.
const model = () => { const chosen = db.getSetting('mureka_model'); return MODELS.includes(chosen) ? chosen : (MODELS.includes(cfg.murekaModel) ? cfg.murekaModel : 'mureka-9'); };

// The one description of the sound Mureka is given (1,024 characters at most): the whole style, the singer,
// then what the producer's notes say about each part. Mureka has no place for sounds to avoid, and a sound
// named in order to rule it out might be taken as a request, so "Avoid" lines and "no ..." notes are left out.
function promptFor(song) {
  const style = String(song.style || '').split(',').map(d => d.replace(/\s+/g, ' ').trim()).filter(d => d && !/^(no|without|avoid)\s/i.test(d));
  if (song.voice === 'male' && !style.some(d => /\bmale\b/i.test(d) && !/female/i.test(d))) style.push('male vocal');
  if (song.voice === 'female' && !style.some(d => /female/i.test(d))) style.push('female vocal');
  if (song.voice === 'duet' && !style.some(d => /duet/i.test(d))) style.push('male and female duet');
  let prompt = style.join(', ').slice(0, 700);
  for (const raw of String(song.arrangement || '').split(/\r?\n/)) {
    const at = raw.indexOf(':');
    if (at < 1 || /^\s*avoid\s*$/i.test(raw.slice(0, at))) continue;
    const notes = raw.slice(at + 1).split(/[,;]/).map(d => d.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '')).filter(d => d && !/^(no|without|avoid)\s/i.test(d));
    if (!notes.length) continue;
    const line = `. ${raw.slice(0, at).replace(/[*#[\]_`]/g, '').replace(/^[\s\d.)-]+(?=[A-Za-z])/, '').trim()}: ${notes.join(', ')}`;
    if (prompt.length + line.length > 1024) break;
    prompt += line;
  }
  return prompt;
}

// When each part of the customer's lyrics starts, in seconds, from the line timings Mureka reports.
// Mureka may add parts of its own (an intro, a break), so each of our parts is found by its first line.
function startsFrom(lyrics, reported) {
  const plain = t => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const lines = (Array.isArray(reported) ? reported : []).flatMap(s => (Array.isArray(s && s.lines) ? s.lines : [])).filter(l => l && Number.isFinite(l.start) && plain(l.text));
  const starts = []; let from = 0;
  for (const s of parseSections(lyrics)) {
    if (!s.lines.length) return null;
    const want = plain(s.lines[0]);
    const i = lines.findIndex((l, k) => k >= from && (plain(l.text) === want || plain(l.text).startsWith(want) || want.startsWith(plain(l.text))));
    if (i < 0) return null;
    starts.push(lines[i].start / 1000); from = i + 1;
  }
  return starts.length ? starts : null;
}

// One request to Mureka. A failure is told to the customer plainly; detail is for the owner's health table.
async function call(path, opts) {
  let res;
  try {
    res = await fetch(BASE + path, Object.assign({ signal: AbortSignal.timeout(60000) }, opts, {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.murekaKey}` } }));
  } catch (e) {
    throw Object.assign(new PublicError('The recording did not finish. Try again.', 502), { detail: 'Mureka did not answer' });
  }
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (res.ok && json) return json;
  console.error('Mureka error', res.status, text.slice(0, 500));
  const detail = `Mureka answered ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 220)}`;
  if (res.status === 429) throw Object.assign(new PublicError('The studio is busy. Try again in a minute.', 429), { detail });
  throw Object.assign(new PublicError('The recording did not finish. Try again.', 502), { detail });
}

async function generate(song) {
  if (!cfg.murekaKey) throw new PublicError('Recording is not set up yet.', 503);
  const body = { lyrics: String(song.lyrics || '').slice(0, 5000), model: MODELS.includes(song.model) ? song.model : model(), n: 1, prompt: promptFor(song) };
  if (!parseSections(body.lyrics).length) throw new PublicError('The song needs lyrics before it can be recorded.');
  if (song.voice === 'male' || song.voice === 'female') body.gender = song.voice;
  let task = await call('/v1/song/generate', { method: 'POST', body: JSON.stringify(body) });
  if (!task.id) throw Object.assign(new PublicError('The recording did not finish. Try again.', 502), { detail: 'Mureka gave no task number' });

  const deadline = Date.now() + 10 * 60 * 1000;
  while (!['succeeded', 'failed', 'timeouted', 'cancelled'].includes(task.status)) {
    if (Date.now() > deadline) throw Object.assign(new PublicError('The recording took too long. Try again.', 504), { detail: 'Mureka had not finished after ten minutes' });
    await sleep(cfg.murekaPollMs);
    task = await call('/v1/song/query/' + encodeURIComponent(task.id), { method: 'GET' });
  }
  if (task.status !== 'succeeded') {
    const why = String(task.failed_reason || task.status);
    console.error('Mureka task failed', task.id, why);
    // Words or a sound it will not record are the customer's to change, not an outage.
    if (/sensitive|violat|polic|prohibit|copyright|illegal|inappropriate|not allowed|forbidden content/i.test(why)) {
      throw new PublicError('The music service turned down part of the lyrics or style. Change that and try again.', 422);
    }
    throw Object.assign(new PublicError('The recording did not finish. Try again.', 502), { detail: `Mureka could not make the song: ${why.slice(0, 200)}` });
  }
  const choice = (Array.isArray(task.choices) ? task.choices : []).find(c => c && c.url);
  if (!choice) throw Object.assign(new PublicError('The recording did not finish. Try again.', 502), { detail: 'Mureka finished without a song' });
  // Mureka's links stop working after 30 days, so the file is copied to our own disk like every other recording.
  let file;
  try { file = await fetch(choice.url, { signal: AbortSignal.timeout(120000) }); } catch (e) { file = null; }
  if (!file || !file.ok) throw Object.assign(new PublicError('The recording could not be downloaded. Try again.', 502), { detail: 'The finished song could not be fetched from Mureka' });
  const audio = Buffer.from(await file.arrayBuffer());
  if (audio.length < 1000) throw Object.assign(new PublicError('The recording did not finish. Try again.', 502), { detail: 'Mureka sent an empty file' });
  const wav = audio.toString('latin1', 0, 4) === 'RIFF';
  const used = String(task.model || body.model);
  return { audio, mime: wav ? 'audio/wav' : 'audio/mpeg', ext: wav ? 'wav' : 'mp3', model: used,
    durationSec: Number(choice.duration) > 0 ? Number(choice.duration) / 1000 : null,
    sectionStarts: startsFrom(body.lyrics, choice.lyrics_sections) || undefined,
    // Mureka charges by the song, not by the minute.
    flatCost: cfg.costMurekaPerSong != null && !song.model ? cfg.costMurekaPerSong : (PRICES[used] != null ? PRICES[used] : PRICES[body.model] != null ? PRICES[body.model] : PRICES['mureka-9']) };
}

module.exports = { name: 'mureka', generate, promptFor, startsFrom, MODELS, model };
