'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const cfg = require('./config');

const mediaDir = path.join(cfg.dataDir, 'media');
fs.mkdirSync(mediaDir, { recursive: true });

const db = new Database(path.join(cfg.dataDir, 'songpost.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL,            -- generating | ready | failed
    error TEXT,
    paid INTEGER NOT NULL DEFAULT 0,
    paid_at INTEGER,
    price_cents INTEGER NOT NULL,
    stripe_session TEXT,
    recipient TEXT, sender TEXT, relationship TEXT, occasion TEXT,
    tone TEXT, genre TEXT, voice TEXT, details TEXT,
    title TEXT, lyrics TEXT, style TEXT, note TEXT,
    takes_json TEXT NOT NULL DEFAULT '[]',   -- finished recordings
    chosen INTEGER NOT NULL DEFAULT 0,       -- index into takes
    attempts INTEGER NOT NULL DEFAULT 0,     -- recordings started
    engine TEXT,
    ip TEXT
  );
  CREATE TABLE IF NOT EXISTS events (ip TEXT, kind TEXT, at INTEGER);
  CREATE INDEX IF NOT EXISTS events_kind_at ON events (kind, at);
  CREATE TABLE IF NOT EXISTS replies (id INTEGER PRIMARY KEY, order_id TEXT, body TEXT, share_ok INTEGER, at INTEGER);
  CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY, order_id TEXT, body TEXT, at INTEGER);
  CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY, order_id TEXT, to_contact TEXT, subject TEXT, body TEXT, created_at INTEGER, sent_at INTEGER);
  CREATE TABLE IF NOT EXISTS funnel (day TEXT, kind TEXT, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind));
`);

// What the site has used and earned, kept per day so it survives songs being cleaned up or deleted.
// kind: song_started | rec_take | rec_redo | rec_second (amount = seconds of music) | claude_in | claude_out
// (amount = tokens) | sale | sale_practice (amount = cents).
// How songs spread: via_gift_visit | via_gift_started | via_gift_sale (a song started from a gift page), the same three with
// "join" (by someone who added to a group song), group_invite | group_part | group_started | group_sale (songs made together),
// ref_visit:<code> | ref_started:<code> | ref_sale:<code> (a partner's link), heard:<answer>. For the sale kinds, amount = cents
// of real money, so a practice unlock adds to n and nothing to amount.
db.exec(`CREATE TABLE IF NOT EXISTS usage (day TEXT, kind TEXT, n INTEGER NOT NULL DEFAULT 0, amount REAL NOT NULL DEFAULT 0, PRIMARY KEY (day, kind))`);

// The owner's choices made on the admin page (which music engine records the songs).
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);

// Whether each outside service (claude, music, stripe, messages) last worked, for the health check.
db.exec(`CREATE TABLE IF NOT EXISTS health (service TEXT PRIMARY KEY, last_ok_at INTEGER, last_err_at INTEGER, last_err TEXT, fails_in_row INTEGER NOT NULL DEFAULT 0)`);

// Columns added after the first version. Each is added once; an existing database keeps its data.
function addColumns(table, cols) {
  for (const col of cols) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`); }
    catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; } // already there is fine; anything else is not
  }
}
addColumns('orders', ['gen_started_at INTEGER', 'language TEXT', 'say_name TEXT', 'contact TEXT', "tier TEXT DEFAULT 'gold'",
  'schedule_to TEXT', 'schedule_date TEXT', 'schedule_sent_at INTEGER', 'removed INTEGER NOT NULL DEFAULT 0', 'first_played_at INTEGER',
  // gen_kind: what the recording under way is (take | redo | second). gen_event_id: its entry in the free-preview count.
  'gen_kind TEXT', 'gen_event_id INTEGER', 'redo_at INTEGER', 'schedule_queued_at INTEGER', 'schedule_failed_at INTEGER']);
// How a song came about. group_id: made together with others (see song_groups). group_names: everyone it is from.
// via + from_order: started from a gift page ("gift") or by someone who added to a group song ("join"), and which song led to it.
// chain_depth: how many songs in a row led to this one. ref_code: the partner link the buyer arrived by. heard: their answer to
// "How did you hear about us?".
addColumns('orders', ['group_id TEXT', 'group_names TEXT', 'via TEXT', 'from_order TEXT', 'chain_depth INTEGER NOT NULL DEFAULT 0', 'ref_code TEXT', 'heard TEXT']);
// arrangement: the producer's notes sent to the studio with the style (what changes from part to part, and what to avoid).
addColumns('orders', ['arrangement TEXT']);
// premium: a Platinum record's recording on the premium model. 0 not part of this song, 1 owed, 2 recorded.
// photo: the file name of the picture the sender added to the gift page (Platinum).
addColumns('orders', ['premium INTEGER NOT NULL DEFAULT 0', 'photo TEXT']);
// The sender's own touches on the gift page. answers_json: what they told us, as [{ q, a }]. words: which of those
// they chose to show, as [index]. signature: the strokes they drew. spoken: the file name of their spoken message (voice is the singer they chose).
addColumns('orders', ['answers_json TEXT', 'words TEXT', 'signature TEXT', 'spoken TEXT']);
addColumns('events', ['order_id TEXT']);
// featured: a reply the recipient allowed to be shared, which the owner has chosen to show on the site as a testimonial.
addColumns('replies', ['featured INTEGER NOT NULL DEFAULT 0']);
// A photo shown with a testimonial needs three yeses. photo_share (on the song): the buyer allows it. photo_ok (on the
// reply): the recipient allows it. photo_featured (on the reply): the owner looked at it and chose to show it.
addColumns('orders', ['photo_share INTEGER NOT NULL DEFAULT 0']);
// sheet_design: the look the sender chose for the lyric sheet (see DESIGNS in sheet.js). Empty means the classic one.
addColumns('orders', ['sheet_design TEXT']);
addColumns('replies', ['photo_ok INTEGER NOT NULL DEFAULT 0', 'photo_featured INTEGER NOT NULL DEFAULT 0']);
// A video the recipient recorded for the buyer. share_ok: the recipient allows Songpost to show it to others.
// One-tap reactions from the person a song is for: a heart, a laugh. Each tap is one row.
db.exec(`CREATE TABLE IF NOT EXISTS taps (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, emoji TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS taps_order ON taps (order_id);`);
db.exec(`CREATE TABLE IF NOT EXISTS reactions (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, file TEXT, mime TEXT,
  bytes INTEGER, seconds INTEGER, share_ok INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL)`);
// tag: what a message is for, when something has to happen once it is delivered ("schedule").
addColumns('outbox', ['attempts INTEGER NOT NULL DEFAULT 0', 'next_try_at INTEGER', 'failed_at INTEGER', 'tag TEXT']);

// A part's id is never used twice (AUTOINCREMENT), so "whose memories the lyrics were written from" can't point at a later arrival.
// A song made together. The organizer holds the key; anyone with the id (the invite link) can add their memories
// until the song is recorded, when order_id is set and the group closes.
db.exec(`
  CREATE TABLE IF NOT EXISTS song_groups (id TEXT PRIMARY KEY, key TEXT NOT NULL, created_at INTEGER NOT NULL, organizer TEXT, recipient TEXT,
    relationship TEXT, occasion TEXT, order_id TEXT, ip TEXT);
  CREATE TABLE IF NOT EXISTS group_parts (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, token TEXT NOT NULL, name TEXT, relationship TEXT,
    answers_json TEXT NOT NULL DEFAULT '[]', contact TEXT, at INTEGER, ip TEXT);
  CREATE INDEX IF NOT EXISTS group_parts_group ON group_parts (group_id);
  CREATE TABLE IF NOT EXISTS partners (code TEXT PRIMARY KEY, name TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL, removed INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY, token TEXT NOT NULL, order_id TEXT, email TEXT NOT NULL, sender TEXT, recipient TEXT,
    occasion TEXT, month_day TEXT, holidays INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, sent_json TEXT NOT NULL DEFAULT '[]');
`);

// Example songs shown on the opening page. Each is either a song made on this site (order_id) or an audio file
// the owner uploaded (file). outside marks a file that was made with a different music tool.
db.exec(`CREATE TABLE IF NOT EXISTS samples (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, title TEXT, caption TEXT,
  order_id TEXT, file TEXT, mime TEXT, outside INTEGER NOT NULL DEFAULT 0)`);

const COLUMNS = ['status', 'error', 'paid', 'paid_at', 'price_cents', 'stripe_session', 'title', 'lyrics', 'style', 'note',
  'takes_json', 'chosen', 'attempts', 'engine', 'gen_started_at', 'tier', 'schedule_to', 'schedule_date', 'schedule_sent_at',
  'removed', 'first_played_at', 'gen_kind', 'gen_event_id', 'redo_at', 'schedule_queued_at', 'schedule_failed_at', 'heard', 'arrangement', 'premium', 'photo', 'words', 'signature', 'spoken', 'photo_share', 'sheet_design'];

function hydrate(row) {
  if (!row) return null;
  let takes = [];
  try { takes = JSON.parse(row.takes_json) || []; } catch (e) { /* keep empty */ }
  return Object.assign({}, row, { takes, paid: !!row.paid, removed: !!row.removed });
}
const today = () => new Date().toISOString().slice(0, 10);

// Deletes one file from the media folder. A missing file is fine.
function unlinkMedia(name) {
  if (!name) return;
  try { fs.unlinkSync(path.join(mediaDir, path.basename(String(name)))); } catch (e) { /* already gone */ }
}
// Deletes the audio files of an order's takes. Missing files are fine.
function unlinkTakes(takes) {
  for (const t of takes || []) {
    for (const f of [t.file, t.preview]) {
      if (!f) continue;
      try { fs.unlinkSync(path.join(mediaDir, path.basename(f))); } catch (e) { /* already gone */ }
    }
  }
}

module.exports = {
  mediaDir,
  unlinkMedia,
  createOrder(o) {
    db.prepare(`INSERT INTO orders (id, key, created_at, status, price_cents, recipient, sender, relationship, occasion,
      tone, genre, voice, details, title, lyrics, style, note, attempts, ip, language, say_name, contact, gen_started_at, gen_kind, gen_event_id,
      group_id, group_names, via, from_order, chain_depth, ref_code, heard, arrangement, answers_json)
      VALUES (@id, @key, @created_at, @status, @price_cents, @recipient, @sender, @relationship, @occasion,
      @tone, @genre, @voice, @details, @title, @lyrics, @style, @note, @attempts, @ip, @language, @say_name, @contact, @gen_started_at, @gen_kind, @gen_event_id,
      @group_id, @group_names, @via, @from_order, @chain_depth, @ref_code, @heard, @arrangement, @answers_json)`)
      .run(Object.assign({ gen_kind: 'take', gen_event_id: null, group_id: null, group_names: null, via: null, from_order: null, chain_depth: 0, ref_code: null, heard: null, arrangement: '', answers_json: '[]' }, o));
  },
  getOrder(id) {
    return hydrate(db.prepare('SELECT * FROM orders WHERE id = ?').get(String(id || '')));
  },
  updateOrder(id, patch) {
    const p = Object.assign({}, patch);
    if (p.takes) { p.takes_json = JSON.stringify(p.takes); delete p.takes; }
    for (const k of ['paid', 'removed']) if (typeof p[k] === 'boolean') p[k] = p[k] ? 1 : 0;
    const keys = Object.keys(p).filter(k => COLUMNS.includes(k));
    if (!keys.length) return;
    db.prepare(`UPDATE orders SET ${keys.map(k => `${k} = @${k}`).join(', ')} WHERE id = @id`).run(Object.assign({ id }, p));
  },
  listOrders(limit = 500) {
    return db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').all(limit).map(hydrate);
  },
  // Recordings that were running when the server last stopped.
  generatingOrders() {
    return db.prepare(`SELECT * FROM orders WHERE status = 'generating'`).all().map(hydrate);
  },
  // Platinum records that were sold with a premium recording and have not had it yet.
  owedPremium() {
    return db.prepare(`SELECT * FROM orders WHERE paid = 1 AND removed = 0 AND tier = 'platinum' AND premium = 1 AND status != 'generating'`).all().map(hydrate);
  },
  // Counts across every song, however many there are.
  totals() {
    return db.prepare(`SELECT COUNT(*) AS songs, COALESCE(SUM(paid), 0) AS paid,
      COALESCE(SUM(CASE WHEN paid = 1 THEN price_cents ELSE 0 END), 0) AS cents FROM orders
      WHERE COALESCE(stripe_session, '') <> 'own'`).get(); // the owner's own uploads are not songs the site recorded or sold
  },
  // Paid songs whose send date has arrived and whose message has not been queued yet.
  dueSchedules(cutoffDay) {
    return db.prepare(`SELECT * FROM orders WHERE paid = 1 AND removed = 0 AND schedule_date IS NOT NULL
      AND schedule_sent_at IS NULL AND schedule_queued_at IS NULL AND schedule_date <= ?`).all(cutoffDay).map(hydrate);
  },
  // Unpaid songs older than the cutoff that still have audio on disk.
  staleUnpaid(beforeMs) {
    return db.prepare(`SELECT * FROM orders WHERE paid = 0 AND created_at < ? AND status != 'generating' AND takes_json != '[]'`).all(beforeMs).map(hydrate);
  },
  // An unpaid preview that has aged out: the audio goes, the order stays so the customer can record it again.
  expireUnpaid(id) {
    const o = this.getOrder(id);
    if (!o || o.paid) return;
    unlinkTakes(o.takes);
    this.updateOrder(id, { takes: [], chosen: 0, attempts: 0, status: 'failed', error: 'This preview has expired. Record it again to hear it.' });
  },
  // Removes a song for good: its audio, its details, and everything attached to it.
  deleteOrder(id) {
    const o = this.getOrder(id);
    if (!o) return false;
    unlinkTakes(o.takes);
    unlinkMedia(o.photo); unlinkMedia(o.spoken);
    for (const r of db.prepare('SELECT file FROM reactions WHERE order_id = ?').all(o.id)) unlinkMedia(r.file);
    db.transaction(() => {
      for (const t of ['replies', 'reports', 'outbox', 'events', 'reminders', 'samples', 'reactions', 'taps']) db.prepare(`DELETE FROM ${t} WHERE order_id = ?`).run(o.id);
      // what the people who made it together wrote goes too
      for (const g of db.prepare('SELECT id FROM song_groups WHERE order_id = ?').all(o.id)) {
        db.prepare('DELETE FROM group_parts WHERE group_id = ?').run(g.id);
        db.prepare('DELETE FROM song_groups WHERE id = ?').run(g.id);
      }
      db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
    })();
    return true;
  },

  /* ---------- songs made together ---------- */
  createGroup(g) {
    db.prepare(`INSERT INTO song_groups (id, key, created_at, organizer, recipient, relationship, occasion, ip)
      VALUES (@id, @key, @created_at, @organizer, @recipient, @relationship, @occasion, @ip)`).run(g);
  },
  getGroup(id) { return db.prepare('SELECT * FROM song_groups WHERE id = ?').get(String(id || '')) || null; },
  updateGroup(id, patch) {
    const keys = Object.keys(patch).filter(k => ['organizer', 'recipient', 'relationship', 'occasion', 'order_id'].includes(k));
    if (keys.length) db.prepare(`UPDATE song_groups SET ${keys.map(k => `${k} = @${k}`).join(', ')} WHERE id = @id`).run(Object.assign({ id }, patch));
  },
  groupForOrder(orderId) { return db.prepare('SELECT * FROM song_groups WHERE order_id = ?').get(orderId) || null; },
  // What each person added, oldest first.
  groupParts(groupId) {
    return db.prepare('SELECT * FROM group_parts WHERE group_id = ? ORDER BY id').all(groupId).map(p => {
      let answers = []; try { answers = JSON.parse(p.answers_json) || []; } catch (e) { /* keep empty */ }
      return Object.assign({}, p, { answers });
    });
  },
  addGroupPart(p) {
    return db.prepare(`INSERT INTO group_parts (group_id, token, name, relationship, answers_json, contact, at, ip)
      VALUES (@group_id, @token, @name, @relationship, @answers_json, @contact, @at, @ip)`).run(p).lastInsertRowid;
  },
  updateGroupPart(id, p) {
    db.prepare('UPDATE group_parts SET name = @name, relationship = @relationship, answers_json = @answers_json, contact = @contact, at = @at WHERE id = @id').run(Object.assign({ id }, p));
  },
  removeGroupPart(groupId, partId) { db.prepare('DELETE FROM group_parts WHERE group_id = ? AND id = ?').run(groupId, partId); },
  // Invitations nobody turned into a song: what people wrote is not kept for ever.
  pruneGroups(beforeMs) {
    for (const g of db.prepare(`SELECT g.id FROM song_groups g LEFT JOIN orders o ON o.id = g.order_id
      WHERE g.created_at < ? AND (g.order_id IS NULL OR o.id IS NULL OR o.paid = 0)`).all(beforeMs)) {
      db.prepare('DELETE FROM group_parts WHERE group_id = ?').run(g.id);
      db.prepare('DELETE FROM song_groups WHERE id = ?').run(g.id);
    }
  },
  // Songs that were started from this song's gift page or by people who helped make it.
  songsLedTo(orderId) { return db.prepare('SELECT COUNT(*) AS n FROM orders WHERE from_order = ?').get(orderId).n; },
  longestChain() { return db.prepare('SELECT COALESCE(MAX(chain_depth), 0) AS n FROM orders').get().n; },

  /* ---------- example songs on the opening page ---------- */
  addSample(s) {
    return db.prepare(`INSERT INTO samples (created_at, title, caption, order_id, file, mime, outside)
      VALUES (@created_at, @title, @caption, @order_id, @file, @mime, @outside)`).run(Object.assign({ order_id: null, file: null, mime: null, outside: 0 }, s)).lastInsertRowid;
  },
  setSampleFile(id, file) { db.prepare('UPDATE samples SET file = ? WHERE id = ?').run(file, id); },
  getSample(id) { return db.prepare('SELECT * FROM samples WHERE id = ?').get(id) || null; },
  listSamples() { return db.prepare('SELECT * FROM samples ORDER BY id').all(); },
  removeSample(id) {
    const s = this.getSample(id);
    if (!s) return;
    if (s.file) { try { fs.unlinkSync(path.join(mediaDir, path.basename(s.file))); } catch (e) { /* already gone */ } }
    db.prepare('DELETE FROM samples WHERE id = ?').run(id);
  },

  /* ---------- partners (referral links) ---------- */
  addPartner(code, name, note) {
    db.prepare('INSERT OR IGNORE INTO partners (code, name, note, created_at) VALUES (?, ?, ?, ?)').run(code, name, note || '', Date.now());
  },
  // A partner whose link still counts.
  getPartner(code) { return db.prepare('SELECT * FROM partners WHERE code = ? AND removed = 0').get(String(code || '')) || null; },
  // Whether a code has ever been given out. A removed partner's code is never given to anyone else, so nobody inherits its figures.
  partnerCodeTaken(code) { return !!db.prepare('SELECT 1 FROM partners WHERE code = ?').get(String(code || '')); },
  listPartners() { return db.prepare('SELECT * FROM partners WHERE removed = 0 ORDER BY created_at').all(); },
  removePartner(code) { db.prepare('UPDATE partners SET removed = 1 WHERE code = ?').run(code); },

  /* ---------- reminders the buyer asked for ---------- */
  setReminder(r) {
    const old = db.prepare('SELECT * FROM reminders WHERE order_id = ?').get(r.order_id);
    if (old) {
      // A changed date starts afresh: what was noted as sent (or skipped) for the old date doesn't hold the new one back.
      let sent = []; try { sent = JSON.parse(old.sent_json) || []; } catch (e) { /* start again */ }
      if (old.month_day !== r.month_day) sent = sent.filter(k => !/-day$/.test(k));
      db.prepare('UPDATE reminders SET email = @email, month_day = @month_day, holidays = @holidays, sent_json = @sent_json, created_at = @created_at WHERE id = @id')
        .run({ id: old.id, email: r.email, month_day: r.month_day, holidays: r.holidays, sent_json: JSON.stringify(sent), created_at: old.month_day !== r.month_day ? r.created_at : old.created_at });
      return old.id;
    }
    return db.prepare(`INSERT INTO reminders (token, order_id, email, sender, recipient, occasion, month_day, holidays, created_at)
      VALUES (@token, @order_id, @email, @sender, @recipient, @occasion, @month_day, @holidays, @created_at)`).run(r).lastInsertRowid;
  },
  reminderFor(orderId) { return db.prepare('SELECT * FROM reminders WHERE order_id = ?').get(orderId) || null; },
  getReminder(id) { return db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) || null; },
  listReminders(limit = 2000) { return db.prepare('SELECT * FROM reminders ORDER BY id DESC LIMIT ?').all(limit); },
  markReminderSent(id, keys) { db.prepare('UPDATE reminders SET sent_json = ? WHERE id = ?').run(JSON.stringify(keys.slice(-40)), id); },
  removeReminder(id) { db.prepare('DELETE FROM reminders WHERE id = ?').run(id); },
  // Every reminder going to one address, for "stop them all".
  removeRemindersFor(email) { db.prepare('DELETE FROM reminders WHERE lower(email) = lower(?)').run(email); },

  // Returns the new entry's id, so it can be taken back if the thing it counted didn't happen.
  addEvent(ip, kind, orderId) {
    return db.prepare('INSERT INTO events (ip, kind, at, order_id) VALUES (?, ?, ?, ?)').run(ip, kind, Date.now(), orderId || null).lastInsertRowid;
  },
  removeEvent(rowid) { if (rowid) db.prepare('DELETE FROM events WHERE rowid = ?').run(rowid); },
  removeOrderEvents(orderId, kind) { db.prepare('DELETE FROM events WHERE order_id = ? AND kind = ?').run(orderId, kind); },
  countEvents(kind, sinceMs, ip) {
    const since = Date.now() - sinceMs;
    if (ip) return db.prepare('SELECT COUNT(*) AS n FROM events WHERE kind = ? AND at > ? AND ip = ?').get(kind, since, ip).n;
    return db.prepare('SELECT COUNT(*) AS n FROM events WHERE kind = ? AND at > ?').get(kind, since).n;
  },
  pruneEvents() { db.prepare('DELETE FROM events WHERE at < ?').run(Date.now() - 3 * 24 * 3600 * 1000); },

  addReply(orderId, body, shareOk, photoOk) {
    db.prepare('INSERT INTO replies (order_id, body, share_ok, photo_ok, at) VALUES (?, ?, ?, ?, ?)').run(orderId, body, shareOk ? 1 : 0, shareOk && photoOk ? 1 : 0, Date.now());
  },
  // What the recipient wrote back about one song, oldest first.
  repliesFor(orderId) { return db.prepare('SELECT body, at FROM replies WHERE order_id = ? ORDER BY at').all(orderId); },
  addTap(orderId, emoji) { db.prepare('INSERT INTO taps (order_id, emoji, at) VALUES (?, ?, ?)').run(orderId, emoji, Date.now()); },
  tapsFor(orderId) { return db.prepare('SELECT emoji, at FROM taps WHERE order_id = ? ORDER BY at, id').all(orderId); },
  // Replies with the first name of the person who wrote them (the song's recipient).
  listReplies(limit = 200) {
    return db.prepare(`SELECT r.*, o.recipient, o.photo AS order_photo, o.photo_share AS order_photo_share, o.removed AS order_removed
      FROM replies r LEFT JOIN orders o ON o.id = r.order_id ORDER BY r.at DESC LIMIT ?`).all(limit);
  },
  // The owner chooses to show the photo with a testimonial. Only where the buyer and the recipient both said yes.
  setReplyPhotoFeatured(id, on) {
    db.prepare(`UPDATE replies SET photo_featured = ? WHERE id = ? AND share_ok = 1 AND photo_ok = 1
      AND EXISTS (SELECT 1 FROM orders o WHERE o.id = replies.order_id AND o.photo IS NOT NULL AND o.photo_share = 1)`).run(on ? 1 : 0, id);
  },
  // The photo for one testimonial, or nothing unless every yes is still in place and the song is still up.
  testimonialPhoto(replyId) {
    return db.prepare(`SELECT o.photo FROM replies r JOIN orders o ON o.id = r.order_id WHERE r.id = ? AND r.featured = 1 AND r.share_ok = 1
      AND r.photo_ok = 1 AND r.photo_featured = 1 AND o.photo_share = 1 AND o.photo IS NOT NULL AND o.removed = 0 AND o.paid = 1`).get(replyId) || null;
  },
  // The photo on a song changed or went, or the buyer changed their mind: what the recipient and the owner agreed to was the old one.
  clearPhotoConsent(orderId) { db.prepare('UPDATE replies SET photo_ok = 0, photo_featured = 0 WHERE order_id = ?').run(orderId); },
  hidePhotoTestimonials(orderId) { db.prepare('UPDATE replies SET photo_featured = 0 WHERE order_id = ?').run(orderId); },

  // Reaction videos.
  addReaction(r) {
    return db.prepare('INSERT INTO reactions (order_id, file, mime, bytes, seconds, share_ok, at) VALUES (@order_id, @file, @mime, @bytes, @seconds, @share_ok, @at)').run(r).lastInsertRowid;
  },
  getReaction(id) { return db.prepare('SELECT * FROM reactions WHERE id = ?').get(id) || null; },
  reactionsFor(orderId) { return db.prepare('SELECT * FROM reactions WHERE order_id = ? ORDER BY at').all(orderId); },
  listReactions(limit = 200) {
    return db.prepare(`SELECT r.*, o.recipient, o.sender, o.removed AS order_removed FROM reactions r LEFT JOIN orders o ON o.id = r.order_id ORDER BY r.at DESC LIMIT ?`).all(limit);
  },
  deleteReaction(id) {
    const r = this.getReaction(id);
    if (!r) return false;
    unlinkMedia(r.file);
    db.prepare('DELETE FROM reactions WHERE id = ?').run(id);
    return true;
  },
  // Only a reply whose writer ticked "may share" can be shown on the site.
  setReplyFeatured(id, on) { db.prepare('UPDATE replies SET featured = ? WHERE id = ? AND share_ok = 1').run(on ? 1 : 0, id); },
  // The testimonials to show: featured replies whose song is still up, newest first.
  featuredReplies(limit = 3) {
    return db.prepare(`SELECT r.id, r.body, o.recipient,
        (r.photo_featured = 1 AND r.photo_ok = 1 AND o.photo_share = 1 AND o.photo IS NOT NULL) AS with_photo
      FROM replies r JOIN orders o ON o.id = r.order_id
      WHERE r.featured = 1 AND r.share_ok = 1 AND o.removed = 0 ORDER BY r.at DESC LIMIT ?`).all(limit);
  },
  addReport(orderId, body) { db.prepare('INSERT INTO reports (order_id, body, at) VALUES (?, ?, ?)').run(orderId, body, Date.now()); },
  listReports(limit = 200) { return db.prepare('SELECT * FROM reports ORDER BY at DESC LIMIT ?').all(limit); },

  queueMessage(orderId, to, subject, body, tag) {
    return db.prepare('INSERT INTO outbox (order_id, to_contact, subject, body, created_at, tag) VALUES (?, ?, ?, ?, ?, ?)')
      .run(orderId, to, subject, body, Date.now(), tag || null).lastInsertRowid;
  },
  getMessage(id) { return db.prepare('SELECT * FROM outbox WHERE id = ?').get(id); },
  markMessageSent(id) { db.prepare('UPDATE outbox SET sent_at = ? WHERE id = ?').run(Date.now(), id); },
  // A delivery that didn't work: when to try again, or (failedAt) that we have given up.
  markMessageTried(id, attempts, nextTryAt, failedAt) {
    db.prepare('UPDATE outbox SET attempts = ?, next_try_at = ?, failed_at = ? WHERE id = ?').run(attempts, nextTryAt || null, failedAt || null, id);
  },
  // Messages that failed at least once and are due another try.
  retryableMessages(now) {
    return db.prepare(`SELECT * FROM outbox WHERE sent_at IS NULL AND failed_at IS NULL AND attempts > 0
      AND next_try_at IS NOT NULL AND next_try_at <= ? ORDER BY id LIMIT 50`).all(now);
  },
  listOutbox(limit = 200) { return db.prepare('SELECT * FROM outbox ORDER BY created_at DESC, id DESC LIMIT ?').all(limit); },

  // A call to an outside service worked, or didn't. Never throws: keeping score must not break a song.
  noteOk(service) {
    try { db.prepare(`INSERT INTO health (service, last_ok_at, fails_in_row) VALUES (?, ?, 0)
      ON CONFLICT(service) DO UPDATE SET last_ok_at = excluded.last_ok_at, fails_in_row = 0`).run(service, Date.now()); } catch (e) { /* ignore */ }
  },
  noteErr(service, message) {
    try { db.prepare(`INSERT INTO health (service, last_err_at, last_err, fails_in_row) VALUES (?, ?, ?, 1)
      ON CONFLICT(service) DO UPDATE SET last_err_at = excluded.last_err_at, last_err = excluded.last_err, fails_in_row = fails_in_row + 1`)
      .run(service, Date.now(), String(message || '').slice(0, 300)); } catch (e) { /* ignore */ }
  },
  getSetting(key) { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : null; },
  setSetting(key, value) { db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value)); },
  healthAll() { const out = {}; for (const r of db.prepare('SELECT * FROM health').all()) out[r.service] = r; return out; },

  // Adds to today's running count for one kind of use (see the usage table above).
  addUsage(kind, n, amount) {
    db.prepare(`INSERT INTO usage (day, kind, n, amount) VALUES (?, ?, ?, ?)
      ON CONFLICT(day, kind) DO UPDATE SET n = n + excluded.n, amount = amount + excluded.amount`).run(today(), kind, n || 0, amount || 0);
  },
  // How many messages went out since a time, and the most in any one day (email plans have a daily limit).
  messagesSent(since) {
    const all = db.prepare('SELECT COUNT(*) AS n FROM outbox WHERE sent_at >= ?').get(since);
    const top = db.prepare('SELECT COUNT(*) AS n FROM outbox WHERE sent_at >= ? GROUP BY CAST(sent_at / 86400000 AS INTEGER) ORDER BY n DESC LIMIT 1').get(since);
    return { n: all.n, busiest: top ? top.n : 0 };
  },
  // Totals per kind since a day (YYYY-MM-DD), or for all time when no day is given.
  usageTotals(sinceDay) {
    const out = {};
    for (const r of db.prepare('SELECT kind, SUM(n) AS n, SUM(amount) AS amount FROM usage WHERE day >= ? GROUP BY kind').all(sinceDay || '0000-00-00')) out[r.kind] = { n: r.n, amount: r.amount };
    return out;
  },
  // Totals for every kind that starts with a prefix ("ref_sale:" gives one entry per partner code), keyed by what follows it.
  usageByPrefix(prefix, sinceDay) {
    const out = {};
    for (const r of db.prepare('SELECT kind, SUM(n) AS n, SUM(amount) AS amount FROM usage WHERE day >= ? AND substr(kind, 1, ?) = ? GROUP BY kind')
      .all(sinceDay || '0000-00-00', prefix.length, prefix)) out[r.kind.slice(prefix.length)] = { n: r.n, amount: r.amount };
    return out;
  },
  firstUsageDay() { const r = db.prepare('SELECT MIN(day) AS d FROM usage').get(); return r && r.d; },

  // Counts of how many visitors reach each step, kept per day.
  bumpFunnel(kind) {
    db.prepare('INSERT INTO funnel (day, kind, n) VALUES (?, ?, 1) ON CONFLICT(day, kind) DO UPDATE SET n = n + 1').run(today(), kind);
  },
  funnelTotals(days = 30) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const out = {};
    for (const r of db.prepare('SELECT kind, SUM(n) AS n FROM funnel WHERE day >= ? GROUP BY kind').all(since)) out[r.kind] = r.n;
    return out;
  },
};
