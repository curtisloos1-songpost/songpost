'use strict';
// ElevenLabs Music. Docs: https://elevenlabs.io/docs/api-reference/music/compose
// Uses a chunk-based composition plan (music_v2 / music_v2_5) so the lyrics are sung as written.
// Each part of the song is one chunk, with its own words, length, sounds to use and sounds to avoid (up to 50 of each).
const cfg = require('../config');
const { PublicError } = require('../errors');
const { parseSections } = require('../sections');

const SECTION_HINTS = [
  [/chorus/i, ['bigger, fuller arrangement', 'memorable sung hook']],
  [/bridge/i, ['stripped back, emotional build']],
  [/outro|ending/i, ['gentle ending, resolving']],
  [/intro/i, ['instrumental intro']],
];

// A style descriptor can be about one part of the song ("stripped bridge", "big final chorus", "sing-along hook").
// It is sent with that part, not with the whole song. Returns which part, or null for the song as a whole.
function partOf(descriptor) {
  if (/\b(final|last)\s+chorus\b/i.test(descriptor)) return 'final chorus';
  if (/\bbridge\b/i.test(descriptor)) return 'bridge';
  if (/\b(chorus(es)?|hook|refrain)\b/i.test(descriptor)) return 'chorus';
  if (/\bverses?\b/i.test(descriptor)) return 'verse';
  if (/\bintro\b/i.test(descriptor)) return 'intro';
  if (/\b(outro|ending)\b/i.test(descriptor)) return 'outro';
  return null;
}
const isTempo = d => /\b\d{2,3}\s*bpm\b|\btempo\b/i.test(d);

// Said about every song, in every part of it. The polish is left out when the description already says it,
// or asks for a deliberately rough sound.
const ROUGH = 'lo-?fi|\\braw\\b|\\brough\\b|garage|\\bdemo\\b';
const QUALITY = [['clear, upfront lead vocal', null], ['polished production', new RegExp('polished|' + ROUGH, 'i')],
  ['radio-ready mix', new RegExp('radio.ready|' + ROUGH, 'i')], ['professional studio recording', new RegExp('studio recording|' + ROUGH, 'i')]];
// Sounds no song wants. Each is left out when the description asks for something like it (a lo-fi song, a fuzz guitar).
const QUALITY_AVOID = [['low quality', /low.quality|lo-?fi/i], ['demo recording', /\bdemo\b/i], ['muffled vocals', /muffled/i], ['off-key singing', /off.?key/i],
  ['distorted audio', /distort|fuzz|overdriv|saturat/i], ['background noise', /noise|crackle|hiss/i], ['robotic vocals', /robot|vocoder|auto-?tune|talk ?box/i]];

// One descriptor, tidied: no invisible characters, no trailing full stop, never cut through the middle of a character.
const clean = (d, max) => Array.from(String(d).replace(/[\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').replace(/^[\s*_`"'>-]+|[\s*_`"'.]+$/g, '')).slice(0, max).join('').trim();
const real = d => /[\p{L}\p{N}]/u.test(d) && !/^(no|none|nothing|n\/a)$/i.test(d);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const uniq = list => list.filter((d, i) => d && list.findIndex(x => same(x, d)) === i);
// "no drums", "without drums", "drums drop out": something to take away. Returns what, or null.
function takenAway(d) {
  const m = /^(?:no|without|avoid|remove|drop|minus)\s+(?:the\s+|any\s+)?(\S.*)$/i.exec(d) || /^(\S.*?)\s+(?:drops?|dropped)\s+out$/i.exec(d);
  return m ? m[1].trim() : null;
}
// Whether a descriptor names a thing, as a whole word: "punchy drums" names "drums" and "drum"; "bass-baritone" does not name "bass".
function names(d, thing) {
  const stem = thing.replace(/s$/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return !!stem && new RegExp('(^|[^\\p{L}\\p{N}-])' + stem + 's?($|[^\\p{L}\\p{N}-])', 'iu').test(d);
}
// The voice, the tempo and the genre (always written first) are the song itself: no note about one part can take them out.
const fixed = d => /vocal|voice|sing|duet/i.test(d) || isTempo(d);

// The producer's notes, written by Claude and open to the customer: one line for each part of the song
// ("Verse 1: soft close-up vocal, no drums"), and "Avoid: ..." for the whole song. Labels are read generously:
// "Verses 1 and 2", "All choruses", "**Bridge**", "2. Outro/Ending". A line that can't be read is left out.
function readNotes(text) {
  const parts = [], avoid = [];
  for (const raw of String(text || '').split(/\r?\n/).slice(0, 24)) {
    const line = raw.slice(0, 400), at = line.indexOf(':');
    if (at < 1 || at > 60) continue;
    const items = line.slice(at + 1).split(/[,;]/).map(d => clean(d, 80)).filter(real).slice(0, 8);
    if (!items.length) continue;
    const label = line.slice(0, at).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[*#[\]•–_]/g, ' ').replace(/^[\s\d.)-]+(?=[a-z])/, '')
      .replace(/\b(all|every|each|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!label) continue;
    if (label === 'avoid') { avoid.push(...items.map(d => takenAway(d) || d)); continue; }
    let word = '';
    for (const piece of label.split(/\s*(?:,|&|\/|\+|\band\b)\s*/).filter(Boolean)) {
      const m = /^([a-z][a-z -]*[a-z]|[a-z])?\s*(\d{1,2})?$/.exec(piece);
      if (!m || (!m[1] && !word)) continue;
      if (m[1]) word = /chorus(es)?$/.test(m[1]) ? m[1].replace(/es$/, '') : m[1].replace(/([^s])s$/, '$1'); // "verses" is "verse", "choruses" is "chorus"
      parts.push({ word, n: m[2] ? Number(m[2]) : 0, items });
    }
  }
  return { parts, avoid: uniq(avoid).slice(0, 12) };
}

// The song in parts, as written, with a short instrumental lead-in unless the lyrics already start with one.
function partsOf(song) {
  let sections = parseSections(song.lyrics).slice(0, 30);
  if (!sections.length) throw new PublicError('The song needs lyrics before it can be recorded.');
  const introAdded = !/intro/i.test(sections[0].name);
  if (introAdded) sections = [{ name: 'Intro', lines: [] }].concat(sections).slice(0, 30);
  return { sections, introAdded };
}
// ElevenLabs' own examples run about four seconds a line; a little more keeps the singing unhurried.
const lengthOf = s => (s.lines.length ? Math.min(60000, Math.max(8000, Math.round(s.lines.length * cfg.elevenSecondsPerLine * 1000))) : 6000);
const textOf = s => `[${s.name}]` + (s.lines.length ? '\n' + s.lines.join('\n') : '');
// Keep the whole song under the configured ceiling (cost is per generated minute).
function fitted(chunks) {
  const total = chunks.reduce((n, c) => n + c.duration_ms, 0), max = cfg.elevenMaxSeconds * 1000;
  if (total <= max) return chunks;
  const k = max / total;
  return chunks.map(c => Object.assign(c, { duration_ms: Math.max(3000, Math.round(c.duration_ms * k / 500) * 500) }));
}

/*
  The full plan. Every part of the song is given:
    - the whole description of the sound ("style"), the voice, and the standing notes on quality;
    - what the producer's notes say about that part, or Songpost's own note for that kind of part when they say nothing;
    - what to avoid: the other singer, the notes' "Avoid" line, poor sound, and anything the notes take out of that part.
*/
function buildPlan(song, opts) {
  if (opts && opts.plain) return buildPlainPlan(song);
  const all = String(song.style || '').split(',').map(d => clean(d, 100)).filter(real).slice(0, 20);
  const cues = all.filter(partOf).map(text => ({ text, part: partOf(text) }));
  // "no drums" in the description itself is something to avoid all through the song.
  const never = all.filter(d => !partOf(d)).map(takenAway).filter(Boolean);
  let base = all.filter(d => !partOf(d) && !takenAway(d));
  if (song.voice === 'male') base.push('male lead vocal');
  if (song.voice === 'female') base.push('female lead vocal');
  if (song.voice === 'duet') base.push('male and female duet vocals', 'harmonies on the chorus');
  const notes = readNotes(song.arrangement);
  const wanted = d => !takenAway(d) && !/\b(no|without|free)\b/i.test(d);
  const sound = base.filter(wanted).join(', ');
  const standing = QUALITY.filter(([, said]) => !(said && said.test(sound))).map(([d]) => d);
  base = uniq(base.concat(standing));
  const asked = base.concat(cues.map(c => c.text), notes.parts.flatMap(p => p.items)).filter(wanted).join(', ');
  const negative = uniq((song.voice === 'male' ? ['female lead vocal'] : song.voice === 'female' ? ['male lead vocal'] : [])
    .concat(notes.avoid, never, QUALITY_AVOID.filter(([, like]) => !like.test(asked)).map(([d]) => d))).filter(d => !base.some(x => same(x, d)));

  const { sections, introAdded } = partsOf(song);
  // What kind of part it is ("verse", "chorus"), and which one of its kind (the second verse, the third chorus).
  const kind = s => s.name.toLowerCase().replace(/\s*\d+$/, '').replace(/^(final|last)\s+/, '').trim();
  const nth = (s, i) => { const m = /(\d+)\s*$/.exec(s.name); return m ? Number(m[1]) : sections.slice(0, i + 1).filter(x => kind(x) === kind(s)).length; };
  let lastChorus = sections.map(s => kind(s) === 'chorus').lastIndexOf(true);
  if (lastChorus < 0) lastChorus = sections.map(s => /chorus/i.test(s.name)).lastIndexOf(true);
  // A pre-chorus is not a chorus: a cue or a note about "the chorus" is not for it.
  const lift = s => /^pre/.test(kind(s));
  const about = (s, i) => cues.filter(c => (c.part === 'final chorus' ? i === lastChorus
    : c.part === 'outro' ? /outro|ending/i.test(s.name) : new RegExp(c.part, 'i').test(s.name) && !(c.part === 'chorus' && lift(s)))).map(c => c.text);
  // Which parts a line of the notes is about: "Verse 1" is that verse, "Verse" every verse, "Chorus" every chorus,
  // "Chorus 2" the second one, and "Final chorus" what is added the last time round.
  const isFinal = p => /^(final|last) chorus$/.test(p.word);
  const fits = (p, s, i) => (isFinal(p) ? i === lastChorus
    : (p.word === kind(s) || (/^(outro|ending)$/.test(p.word) && /^(outro|ending)/.test(kind(s)))) && (!p.n || p.n === nth(s, i)));
  const rank = p => (isFinal(p) ? 2 : p.n ? 1 : 0);

  const chunks = sections.map((s, i) => {
    const said = notes.parts.filter(p => fits(p, s, i)).sort((a, b) => rank(a) - rank(b)).flatMap(p => p.items);
    // Songpost's own note for this kind of part stands in only when the producer's notes say nothing about it.
    const own = lift(s) ? ['building, lifting towards the chorus'] : (SECTION_HINTS.find(([re]) => re.test(s.name)) || [null, []])[1];
    const local = (said.length && !/intro/i.test(s.name) ? [] : own).concat(about(s, i), said);
    // Read in order, so the more exact line has the last word: "Verse: no drums" then "Verse 2: drums enter" leaves the drums in verse 2.
    let add = [], out = [];
    for (const d of local) {
      const x = takenAway(d);
      if (x) { add = add.filter(a => !names(a, x)); if (!out.some(o => same(o, x))) out.push(x); }
      else { out = out.filter(o => !names(d, o)); add.push(d); }
    }
    // What is taken out of this part goes with what to avoid here, and anything in the description that names it steps aside.
    const positive = uniq(base.filter((d, k) => k === 0 || fixed(d) || standing.includes(d) || !out.some(x => names(d, x))).concat(add)).slice(0, 50);
    return { text: textOf(s), duration_ms: lengthOf(s), positive_styles: positive,
      // a part is never told to use and to avoid the same thing: what is asked for here wins
      negative_styles: uniq(negative.concat(out)).filter(d => !positive.some(p => same(p, d))).slice(0, 50), context_adherence: 'high' };
  });
  return { chunks: fitted(chunks), introAdded };
}

// The plain plan, as it was sent before the producer's notes existed: the first part carries the description, the others
// its first five descriptors and the tempo. Kept as the fallback if the studio ever turns the full plan down.
function buildPlainPlan(song) {
  const all = String(song.style || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 16);
  const cues = all.filter(partOf).map(text => ({ text, part: partOf(text) }));
  const base = all.filter(d => !partOf(d));
  const every = base.slice(0, 5).concat(base.slice(5).filter(isTempo));
  if (song.voice === 'male') base.push('male lead vocal');
  if (song.voice === 'female') base.push('female lead vocal');
  if (song.voice === 'duet') base.push('male and female duet vocals', 'harmonies on the chorus');
  base.push('clear, upfront lead vocal', 'polished production');
  const negative = song.voice === 'male' ? ['female lead vocal'] : song.voice === 'female' ? ['male lead vocal'] : [];
  const { sections, introAdded } = partsOf(song);
  const lastChorus = sections.map(s => /chorus/i.test(s.name)).lastIndexOf(true);
  const about = (s, i) => cues.filter(c => (c.part === 'final chorus' ? i === lastChorus
    : c.part === 'outro' ? /outro|ending/i.test(s.name) : new RegExp(c.part, 'i').test(s.name))).map(c => c.text);
  const chunks = sections.map((s, i) => {
    const hint = (SECTION_HINTS.find(([re]) => re.test(s.name)) || [null, []])[1].concat(about(s, i));
    return { text: textOf(s), duration_ms: lengthOf(s), positive_styles: (i === 0 ? base : every).concat(hint).slice(0, 50), negative_styles: negative, context_adherence: 'high' };
  });
  return { chunks: fitted(chunks), introAdded };
}

const ask = plan => fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'xi-api-key': cfg.elevenKey },
  body: JSON.stringify({ composition_plan: { chunks: plan.chunks }, model_id: cfg.elevenModel }),
  signal: AbortSignal.timeout(8 * 60 * 1000),
});

async function generate(song) {
  if (!cfg.elevenKey) throw new PublicError('Recording is not set up yet.', 503);
  let plan = buildPlan(song), used = 'full';
  let res = await ask(plan);
  // If the studio turns the full plan down, the plain one is tried once before the customer is told anything.
  // Not for a wrong key, an empty account or a busy studio: a second request would only fail the same way.
  if (!res.ok && res.status >= 400 && res.status < 500 && ![401, 402, 403, 429].includes(res.status)) {
    console.error('ElevenLabs turned down the full plan', res.status, (await res.text()).slice(0, 1000));
    plan = buildPlan(song, { plain: true }); used = 'plain';
    res = await ask(plan);
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 1000);
    console.error('ElevenLabs error', res.status, body);
    if (/bad_composition_plan|bad_prompt/.test(body)) {
      throw new PublicError('The music service turned down part of the lyrics or style, usually because it names a real artist or song. Change that and try again.', 422);
    }
    // detail is for the owner's health table on the admin page; the customer only sees the plain message.
    const detail = `ElevenLabs answered ${res.status}: ${body.replace(/\s+/g, ' ').slice(0, 220)}`;
    if (res.status === 429) throw Object.assign(new PublicError('The studio is busy. Try again in a minute.', 429), { detail });
    throw Object.assign(new PublicError('The recording did not finish. Try again.', 502), { detail });
  }
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length < 1000) throw new PublicError('The recording did not finish. Try again.', 502);
  // Where each section of the customer's lyrics starts, in seconds (the added intro is skipped).
  let t = 0; const starts = [];
  plan.chunks.forEach((c, i) => { if (!(plan.introAdded && i === 0)) starts.push(t / 1000); t += c.duration_ms; });
  return { audio, mime: 'audio/mpeg', ext: 'mp3', durationSec: t / 1000, sectionStarts: starts, plan: used };
}

module.exports = { name: 'elevenlabs', generate, buildPlan, readNotes };
