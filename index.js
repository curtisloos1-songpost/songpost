'use strict';
/*
  THE MUSIC ENGINE SOCKET

  Every engine is one file in this folder that exports:

    name      string shown in the admin page
    generate  async (song) => { audio, mime, ext, durationSec }

  song is { title, style, arrangement, lyrics, voice, genre, tone, model } where
    style        comma-separated descriptors ("country, warm, acoustic guitar, ...")
    arrangement  the producer's notes, one line for each part of the song, and what to avoid
    lyrics       text with section labels on their own lines ([Verse 1], [Chorus], ...)
    voice        "any" | "male" | "female" | "duet"
    model        optional: the engine's own model to record on, in place of its everyday one (the premium recording)

  The result is the finished song:
    audio        Buffer with the whole file
    mime         "audio/mpeg" (or "audio/wav")
    ext          "mp3" (or "wav")
    durationSec  length in seconds, or null if the engine doesn't say
    sectionStarts  optional: when each section of the lyrics starts, in seconds, in order.
    lineStarts     optional: when each line of the lyrics is sung, in seconds, in order (null for a line not known).
                   With it, the free preview opens on the part where the name is sung.
    flatCost     optional: what this one song cost, in dollars, for an engine that charges by the song.

  An engine may take minutes; it waits or polls internally and returns when the
  song is done. To show a customer a useful message, throw a PublicError.

  TWO ENGINES
  One engine records the songs: MUSIC_ENGINE, or the owner's choice on the admin page. When ElevenLabs and
  Mureka both have keys, the other one is the backup: if the first cannot record a song (it is down, busy,
  or out of credit), the song is recorded on the backup and the customer notices nothing.

  PREMIUM
  A Platinum record is recorded once more after payment, on Mureka's premium model (PREMIUM_MODEL, or the
  owner's choice on the admin page). That recording is asked for with song.model, and is never passed to
  the backup: a recording made elsewhere would not be what the customer paid for.

  To add an engine (for example Suno's official API when it opens): copy mureka.js or elevenlabs.js,
  change the request, add it below, set MUSIC_ENGINE. Nothing else in the site knows which engine is in use.
*/
const cfg = require('../config');
const db = require('../db');

const ENGINES = {
  elevenlabs: () => require('./elevenlabs'),
  mureka: () => require('./mureka'),
  sunoapi: () => require('./sunoapi'),
  mock: () => require('./mock'),
};
// The engines the owner can switch between, and that stand in for each other.
const PAIR = ['elevenlabs', 'mureka'];
const LABELS = { elevenlabs: 'ElevenLabs', mureka: 'Mureka', sunoapi: 'sunoapi (unofficial)', mock: 'practice tones' };
// Whether an engine has what it needs to record.
const ready = name => name === 'mock' || (name === 'elevenlabs' ? !!cfg.elevenKey : name === 'mureka' ? !!cfg.murekaKey : name === 'sunoapi' ? !!cfg.sunoapiKey : false);

// The engine that records the songs: the owner's choice on the admin page, while that engine has its key; else MUSIC_ENGINE.
function activeName() {
  const chosen = db.getSetting('music_engine');
  return PAIR.includes(chosen) && ready(chosen) && PAIR.includes(cfg.musicEngine) ? chosen : cfg.musicEngine;
}
// The engine that takes over when the first cannot record: the other of the pair, when it has its key.
// MUSIC_BACKUP=off turns this off; MUSIC_BACKUP=<name> names it.
function backupName() {
  const active = activeName();
  if (cfg.musicBackup === 'off' || !PAIR.includes(active)) return null;
  const pick = PAIR.includes(cfg.musicBackup) ? cfg.musicBackup : PAIR.find(n => n !== active);
  return pick && pick !== active && ready(pick) ? pick : null;
}
// The premium model a Platinum record is recorded on after payment, or null when there is none to give:
// Mureka must be the engine in use, the owner must not have turned it off, and it must be a different
// model from the one every song is recorded on.
function premiumModel() {
  if (activeName() !== 'mureka') return null;
  const mureka = require('./mureka');
  const chosen = db.getSetting('premium_model');
  const want = chosen != null ? chosen : cfg.premiumModel;
  return want && want !== 'auto' && mureka.MODELS.includes(want) && want !== mureka.model() ? want : null;
}
function load(name) {
  const make = ENGINES[name];
  if (!make) throw new Error(`Unknown MUSIC_ENGINE "${name}". Use one of: ${Object.keys(ENGINES).join(', ')}`);
  return make();
}
const getEngine = () => load(activeName());
const getBackup = () => { const name = backupName(); return name ? load(name) : null; };

module.exports = { getEngine, getBackup, activeName, backupName, premiumModel, ready, PAIR, LABELS, engineNames: Object.keys(ENGINES) };
