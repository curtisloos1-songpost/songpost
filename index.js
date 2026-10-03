'use strict';
/*
  THE MUSIC ENGINE SOCKET

  Every engine is one file in this folder that exports:

    name      string shown in the admin page
    generate  async (song) => { audio, mime, ext, durationSec }

  song is { title, style, lyrics, voice, genre, tone } where
    style   comma-separated descriptors ("country, warm, acoustic guitar, ...")
    lyrics  text with section labels on their own lines ([Verse 1], [Chorus], ...)
    voice   "any" | "male" | "female" | "duet"

  The result is the finished song:
    audio        Buffer with the whole file
    mime         "audio/mpeg" (or "audio/wav")
    ext          "mp3" (or "wav")
    durationSec  length in seconds, or null if the engine doesn't say
    sectionStarts  optional: when each section of the lyrics starts, in seconds, in order.
                   With it, the free preview opens on the part where the name is sung.

  An engine may take minutes; it waits or polls internally and returns when the
  song is done. To show a customer a useful message, throw a PublicError.

  To add an engine (for example Suno's official API when it opens): copy
  elevenlabs.js, change the request, add one line below, set MUSIC_ENGINE.
  Nothing else in the site knows which engine is in use.
*/
const cfg = require('../config');

const ENGINES = {
  elevenlabs: () => require('./elevenlabs'),
  sunoapi: () => require('./sunoapi'),
  mock: () => require('./mock'),
};

function getEngine() {
  const make = ENGINES[cfg.musicEngine];
  if (!make) throw new Error(`Unknown MUSIC_ENGINE "${cfg.musicEngine}". Use one of: ${Object.keys(ENGINES).join(', ')}`);
  return make();
}

module.exports = { getEngine, engineNames: Object.keys(ENGINES) };
