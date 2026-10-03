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

// Columns added after the first version. Each is added once; an existing database keeps its data.
function addColumns(table, cols) {
  for (const col of cols) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`); } catch (e) { /* already there */ }
  }
}
addColumns('orders', ['gen_started_at INTEGER', 'language TEXT', 'say_name TEXT', 'contact TEXT', "tier TEXT DEFAULT 'gold'",
  'schedule_to TEXT', 'schedule_date TEXT', 'schedule_sent_at INTEGER', 'removed INTEGER NOT NULL DEFAULT 0', 'first_played_at INTEGER',
  // gen_kind: what the recording under way is (take | redo | second). gen_event_id: its entry in the free-preview count.
  'gen_kind TEXT', 'gen_event_id INTEGER', 'redo_at INTEGER', 'schedule_queued_at INTEGER', 'schedule_failed_at INTEGER']);
addColumns('events', ['order_id TEXT']);
// tag: what a message is for, when something has to happen once it is delivered ("schedule").
addColumns('outbox', ['attempts INTEGER NOT NULL DEFAULT 0', 'next_try_at INTEGER', 'failed_at INTEGER', 'tag TEXT']);

const COLUMNS = ['status', 'error', 'paid', 'paid_at', 'price_cents', 'stripe_session', 'title', 'lyrics', 'style', 'note',
  'takes_json', 'chosen', 'attempts', 'engine', 'gen_started_at', 'tier', 'schedule_to', 'schedule_date', 'schedule_sent_at',
  'removed', 'first_played_at', 'gen_kind', 'gen_event_id', 'redo_at', 'schedule_queued_at', 'schedule_failed_at'];

function hydrate(row) {
  if (!row) return null;
  let takes = [];
  try { takes = JSON.parse(row.takes_json) || []; } catch (e) { /* keep empty */ }
  return Object.assign({}, row, { takes, paid: !!row.paid, removed: !!row.removed });
}
const today = () => new Date().toISOString().slice(0, 10);

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
  createOrder(o) {
    db.prepare(`INSERT INTO orders (id, key, created_at, status, price_cents, recipient, sender, relationship, occasion,
      tone, genre, voice, details, title, lyrics, style, note, attempts, ip, language, say_name, contact, gen_started_at, gen_kind, gen_event_id)
      VALUES (@id, @key, @created_at, @status, @price_cents, @recipient, @sender, @relationship, @occasion,
      @tone, @genre, @voice, @details, @title, @lyrics, @style, @note, @attempts, @ip, @language, @say_name, @contact, @gen_started_at, @gen_kind, @gen_event_id)`)
      .run(Object.assign({ gen_kind: 'take', gen_event_id: null }, o));
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
  // Counts across every song, however many there are.
  totals() {
    return db.prepare(`SELECT COUNT(*) AS songs, COALESCE(SUM(paid), 0) AS paid,
      COALESCE(SUM(CASE WHEN paid = 1 THEN price_cents ELSE 0 END), 0) AS cents FROM orders`).get();
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
    db.transaction(() => {
      for (const t of ['replies', 'reports', 'outbox', 'events']) db.prepare(`DELETE FROM ${t} WHERE order_id = ?`).run(o.id);
      db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
    })();
    return true;
  },

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

  addReply(orderId, body, shareOk) { db.prepare('INSERT INTO replies (order_id, body, share_ok, at) VALUES (?, ?, ?, ?)').run(orderId, body, shareOk ? 1 : 0, Date.now()); },
  listReplies(limit = 200) { return db.prepare('SELECT * FROM replies ORDER BY at DESC LIMIT ?').all(limit); },
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
