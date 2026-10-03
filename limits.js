'use strict';
const cfg = require('./config');
const db = require('./db');
const { PublicError } = require('./errors');

const HOUR = 3600 * 1000, DAY = 24 * HOUR;

// Lyrics are cheap, but not free.
function checkLyrics(ip) {
  if (db.countEvents('lyrics', HOUR, ip) >= cfg.lyricsPerIpPerHour) {
    throw new PublicError('You have written a lot of lyrics in the last hour. Try again a little later.', 429);
  }
  db.addEvent(ip, 'lyrics');
}

// Every recording made before payment costs real money, so cap them per visitor and per day.
// Only unpaid, finished recordings count: a failed one is taken back, and paying for a song clears its recordings.
function peekSong(ip) {
  if (db.countEvents('song', DAY, ip) >= cfg.songsPerIpPerDay) {
    throw new PublicError('You have reached today\'s limit for free previews. Unlock a song you have made, or come back tomorrow.', 429);
  }
  if (db.countEvents('song', DAY) >= cfg.dailyUnpaidSongCap) {
    throw new PublicError('We are recording more songs than usual today. Try again in a few hours.', 429);
  }
}
// Counts one recording for this visitor and returns the entry's id (see db.removeEvent).
function checkSong(ip, orderId) {
  peekSong(ip);
  return db.addEvent(ip, 'song', orderId);
}

// A plain per-visitor hourly cap, for small actions such as replies and reports. Returns false when over.
function allow(ip, kind, perHour) {
  if (db.countEvents(kind, HOUR, ip) >= perHour) return false;
  db.addEvent(ip, kind);
  return true;
}

module.exports = { checkLyrics, peekSong, checkSong, allow };
