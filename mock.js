'use strict';
// A stand-in engine for testing the site without paying for music: a 45-second tune made of plain tones.
const RATE = 22050, SECONDS = 45;
const NOTES = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 349.23];

const { parseSections } = require('../sections');

async function generate(song) {
  await new Promise(r => setTimeout(r, 2500));
  const samples = RATE * SECONDS;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / RATE, beat = Math.floor(t * 2), f = NOTES[beat % NOTES.length];
    const env = Math.min(1, ((t * 2) % 1) * 20) * (1 - ((t * 2) % 1)) ;
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * f * t) * env * 12000), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  // Pretend each lyric section takes an equal share of the tune, so the preview cut can be tested.
  const n = Math.max(1, parseSections(song && song.lyrics).length);
  const sectionStarts = Array.from({ length: n }, (_, i) => Math.floor(i * (SECONDS - 30) / n));
  return { audio: Buffer.concat([head, data]), mime: 'audio/wav', ext: 'wav', durationSec: SECONDS, sectionStarts };
}

module.exports = { name: 'mock', generate };
