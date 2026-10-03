'use strict';
// ElevenLabs Music. Docs: https://elevenlabs.io/docs/api-reference/music/compose
// Uses a chunk-based composition plan (music_v2 / music_v2_5) so the lyrics are sung as written.
const cfg = require('../config');
const { PublicError } = require('../errors');
const { parseSections } = require('../sections');

const SECTION_HINTS = [
  [/chorus/i, ['bigger, fuller arrangement', 'memorable sung hook']],
  [/bridge/i, ['stripped back, emotional build']],
  [/outro|ending/i, ['gentle ending, resolving']],
  [/intro/i, ['instrumental intro']],
];

function buildPlan(song) {
  const base = String(song.style || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 12);
  if (song.voice === 'male') base.push('male lead vocal');
  if (song.voice === 'female') base.push('female lead vocal');
  if (song.voice === 'duet') base.push('male and female duet vocals', 'harmonies on the chorus');
  base.push('clear, upfront lead vocal', 'polished production');
  const negative = song.voice === 'male' ? ['female lead vocal'] : song.voice === 'female' ? ['male lead vocal'] : [];

  let sections = parseSections(song.lyrics).slice(0, 30);
  if (!sections.length) throw new PublicError('The song needs lyrics before it can be recorded.');

  // A short instrumental lead-in, unless the lyrics already start with one.
  const introAdded = !/intro/i.test(sections[0].name);
  if (introAdded) sections = [{ name: 'Intro', lines: [] }].concat(sections).slice(0, 30);

  let chunks = sections.map((s, i) => {
    const hint = (SECTION_HINTS.find(([re]) => re.test(s.name)) || [null, []])[1];
    return {
      text: `[${s.name}]` + (s.lines.length ? '\n' + s.lines.join('\n') : ''),
      // ElevenLabs' own examples run about four seconds a line; a little more keeps the singing unhurried.
      duration_ms: s.lines.length ? Math.min(60000, Math.max(8000, Math.round(s.lines.length * cfg.elevenSecondsPerLine * 1000))) : 6000,
      // The first chunk's styles set the tone for the whole song.
      positive_styles: (i === 0 ? base : base.slice(0, 5)).concat(hint).slice(0, 50),
      negative_styles: negative,
      context_adherence: 'high',
    };
  });

  // Keep the whole song under the configured ceiling (cost is per generated minute).
  const total = chunks.reduce((n, c) => n + c.duration_ms, 0);
  const max = cfg.elevenMaxSeconds * 1000;
  if (total > max) {
    const k = max / total;
    chunks = chunks.map(c => Object.assign(c, { duration_ms: Math.max(3000, Math.round(c.duration_ms * k / 500) * 500) }));
  }
  return { chunks, introAdded };
}

async function generate(song) {
  if (!cfg.elevenKey) throw new PublicError('Recording is not set up yet.', 503);
  const plan = buildPlan(song);
  const res = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': cfg.elevenKey },
    body: JSON.stringify({ composition_plan: { chunks: plan.chunks }, model_id: cfg.elevenModel }),
    signal: AbortSignal.timeout(8 * 60 * 1000),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 1000);
    console.error('ElevenLabs error', res.status, body);
    if (/bad_composition_plan|bad_prompt/.test(body)) {
      throw new PublicError('The music service turned down part of the lyrics or style, usually because it names a real artist or song. Change that and try again.', 422);
    }
    if (res.status === 429) throw new PublicError('The studio is busy. Try again in a minute.', 429);
    throw new PublicError('The recording did not finish. Try again.', 502);
  }
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length < 1000) throw new PublicError('The recording did not finish. Try again.', 502);
  // Where each section of the customer's lyrics starts, in seconds (the added intro is skipped).
  let t = 0; const starts = [];
  plan.chunks.forEach((c, i) => { if (!(plan.introAdded && i === 0)) starts.push(t / 1000); t += c.duration_ms; });
  return { audio, mime: 'audio/mpeg', ext: 'mp3', durationSec: t / 1000, sectionStarts: starts };
}

module.exports = { name: 'elevenlabs', generate, buildPlan };
