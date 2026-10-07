'use strict';
/*
  What each vendor says about its own bill, read by the site so nobody has to type it in.

  Every few hours the site asks each vendor it has a key for, and keeps the answers in the settings table
  under "vendor_live". The admin page reads them from there, so the page never waits on a vendor.

  A feed never throws: when a vendor cannot be read it reports why in plain words, and the last good
  figures are kept. Nothing here changes anything at a vendor; every request only reads.

    claude      Anthropic's cost report. Needs ANTHROPIC_ADMIN_KEY (organization accounts only).
                Without it the site's own count of Claude requests is used.
    mureka      Balance left and money spent, from the Mureka key the site already has.
    elevenlabs  The plan, the next bill and the credits used, from the ElevenLabs key the site already has.
    stripe      The fees Stripe really charged, once Stripe is connected.
    render      Render has no bill to read, so the price is worked out from render.yaml and Render's
                list prices. The space used on the disk is measured.
    email       How many emails the site sent, from its own records.
    domain      When the domain renews, from the public registry. No key needed.
*/
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const db = require('./db');

const DAY = 24 * 3600 * 1000;
const EVERY = 6 * 3600 * 1000;
// VENDOR_API_BASE is for tests only: it sends every request to a stand-in server instead of the real vendors.
const TEST = (process.env.VENDOR_API_BASE || '').replace(/\/+$/, '');
const HOSTS = { claude: 'https://api.anthropic.com', mureka: 'https://api.mureka.ai', elevenlabs: 'https://api.elevenlabs.io', stripe: 'https://api.stripe.com', domain: 'https://rdap.org' };
const url = (feed, rest) => (TEST ? TEST + '/' + feed : HOSTS[feed]) + rest;

const usd = x => (x < 0 ? '-' : '') + '$' + Math.abs(x).toFixed(2);
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const nice = ms => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const count = n => Math.round(n).toLocaleString('en-US');
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null);

class FeedError extends Error {}
// One read-only request. Says in plain words what went wrong, without ever repeating a key.
async function ask(name, feed, rest, headers) {
  let res;
  try { res = await fetch(url(feed, rest), { headers, signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw new FeedError(`Could not reach ${name}.`); }
  if (res.status === 401 || res.status === 403) throw new FeedError(`${name} would not let this key read the account.`);
  if (!res.ok) throw new FeedError(`${name} answered with an error (${res.status}).`);
  try { return await res.json(); } catch (e) { throw new FeedError(`${name} sent an answer the site could not read.`); }
}

/* ---------- the feeds ---------- */
// Each returns { off, monthly, monthlyFrom, used30, usedFrom, renews, says, alerts }: only the parts it knows.

async function claude() {
  if (!cfg.anthropicAdminKey) return { off: true };
  let cents = 0, page = '';
  const from = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10) + 'T00:00:00Z';
  for (let i = 0; i < 6; i++) {
    const j = await ask('Anthropic', 'claude', `/v1/organizations/cost_report?starting_at=${from}&limit=31${page ? '&page=' + encodeURIComponent(page) : ''}`,
      { 'x-api-key': cfg.anthropicAdminKey, 'anthropic-version': '2023-06-01' });
    for (const day of (j && j.data) || []) for (const r of day.results || []) cents += num(r.amount) || 0;
    if (!j || !j.has_more || !j.next_page) break;
    page = j.next_page;
  }
  const used30 = cents / 100;
  return { used30, usedFrom: 'Anthropic\'s own figure', says: `Anthropic billed ${usd(used30)} in the last 30 days. That is the whole Anthropic account, so it includes anything else that uses it.` };
}

async function murekaFeed() {
  if (!cfg.murekaKey) return { off: true, says: 'Not connected.' };
  const j = await ask('Mureka', 'mureka', '/v1/account/billing', { Authorization: 'Bearer ' + cfg.murekaKey });
  const bal = num(j && j.balance), spentAll = num(j && j.total_spending);
  if (bal == null || spentAll == null) throw new FeedError('Mureka sent an answer the site could not read.');
  const balance = bal / 100, spent = spentAll / 100;   // Mureka reports in cents
  // Mureka gives only a running total, so the site notes it once a day and works out a month's spending from the difference.
  let marks = [];
  try { marks = JSON.parse(db.getSetting('vendor_marks') || '{}').mureka || []; } catch (e) { marks = []; }
  const today = isoDay(Date.now());
  marks = marks.filter(m => Array.isArray(m) && m[0] !== today).concat([[today, spent]]).slice(-400);
  db.setSetting('vendor_marks', JSON.stringify({ mureka: marks }));
  const cut = isoDay(Date.now() - 30 * DAY), older = marks.filter(m => m[0] <= cut);
  const mark = older.length ? older[older.length - 1] : marks[0];
  const out = { says: `${usd(balance)} left on the account. ${usd(spent)} spent since the account opened.`, alerts: [] };
  if (older.length) { out.used30 = Math.max(0, spent - mark[1]); out.usedFrom = 'Mureka\'s own figure'; }
  else if (mark[0] !== today) out.says += ` ${usd(Math.max(0, spent - mark[1]))} of that since ${nice(Date.parse(mark[0]))}.`;
  if (balance < 5) out.alerts.push(`Mureka has ${usd(balance)} left. Songs stop recording on Mureka when it runs out, so top it up.`);
  return out;
}

async function elevenlabs() {
  if (!cfg.elevenKey) return { off: true, says: 'Not connected.' };
  const j = await ask('ElevenLabs', 'elevenlabs', '/v1/user/subscription', { 'xi-api-key': cfg.elevenKey });
  if (!j || typeof j !== 'object') throw new FeedError('ElevenLabs sent an answer the site could not read.');
  const tier = String(j.tier || '').replace(/_/g, ' '), plan = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) + ' plan.' : '';
  const months = { monthly_period: 1, '3_month_period': 3, '6_month_period': 6, annual_period: 12 }[j.billing_period] || 1;
  const inv = j.next_invoice && num(j.next_invoice.amount_due_cents) != null ? j.next_invoice : null;
  const out = { says: plan, alerts: [] };
  if (inv) {
    const bill = num(inv.amount_due_cents) / 100, at = num(inv.next_payment_attempt_unix);
    out.monthly = bill / months;
    out.monthlyFrom = 'ElevenLabs\' next bill';
    if (at) out.renews = isoDay(at * 1000);
    out.says += ` Next bill ${usd(bill)}${at ? ' on ' + nice(at * 1000) : ''}${months > 1 ? `, which covers ${months} months` : ''}.`;
  } else if (j.tier === 'free') { out.monthly = 0; out.monthlyFrom = 'ElevenLabs: the free plan'; }
  const used = num(j.character_count), limit = num(j.character_limit);
  if (used != null && limit) {
    out.says += ` ${count(used)} of ${count(limit)} credits used this period.`;
    if (used / limit >= 0.9) out.alerts.push(`ElevenLabs credits are ${Math.round(used / limit * 100)}% used for this period. It is the backup for recording songs.`);
  }
  out.says = out.says.trim();
  return out;
}

async function stripe() {
  if (!cfg.stripeKey) return { off: true, says: 'Not connected yet, so there are no card fees.' };
  const since = Math.floor((Date.now() - 30 * DAY) / 1000);
  let fees = 0, payments = 0, after = '';
  for (let i = 0; i < 30; i++) {
    const j = await ask('Stripe', 'stripe', `/v1/balance_transactions?limit=100&created[gte]=${since}${after ? '&starting_after=' + encodeURIComponent(after) : ''}`, { Authorization: 'Bearer ' + cfg.stripeKey });
    const rows = (j && j.data) || [];
    for (const t of rows) { fees += (num(t.fee) || 0) / 100; if (t.type === 'charge' || t.type === 'payment') payments++; }
    if (!j || !j.has_more || !rows.length) break;
    after = rows[rows.length - 1].id;
  }
  return { used30: fees, usedFrom: 'Stripe\'s own figure', says: `Stripe charged ${usd(fees)} in fees on ${count(payments)} payment${payments === 1 ? '' : 's'} in the last 30 days.` };
}

// Render's list prices, dollars a month. Only the instance sizes this site could sensibly run on.
const RENDER_PLANS = { free: 0, starter: 7, '0.5c-512mb': 7, standard: 25, '1c-2gb': 25 };
const RENDER_DISK_PER_GB = 0.25;
function folderBytes(dir) {
  let total = 0;
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return 0; }
  for (const d of names) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) total += folderBytes(p);
    else if (d.isFile()) { try { total += fs.statSync(p).size; } catch (e) { /* it went away while counting */ } }
  }
  return total;
}
async function render() {
  let yaml = '';
  try { yaml = fs.readFileSync(path.join(__dirname, '..', 'render.yaml'), 'utf8'); } catch (e) { return { off: true, says: 'The site could not find its hosting file, so there is no price to work out.' }; }
  const plan = ((/^\s*plan:\s*([^\s#]+)/m.exec(yaml) || [])[1] || '').toLowerCase(), gb = num((/^\s*sizeGB:\s*(\d+)/m.exec(yaml) || [])[1]);
  const out = { says: '', alerts: [] };
  if (plan in RENDER_PLANS) {
    const disk = (gb || 0) * RENDER_DISK_PER_GB;
    out.monthly = RENDER_PLANS[plan] + disk;
    out.monthlyFrom = 'Render\'s list prices';
    out.says = `The website ${usd(RENDER_PLANS[plan])}${gb ? ` and its ${gb} GB disk ${usd(disk)}` : ''}, at Render's list prices. Render has no bill the site can read, so check it against Render's own page if you change the plan.`;
  } else out.says = 'The site does not know the price of this Render plan.';
  if (gb) {
    const used = folderBytes(cfg.dataDir) / 1e9, pct = Math.round(used / gb * 100);
    out.says += ` Disk: ${used.toFixed(2)} of ${gb} GB used.`;
    if (pct >= 80) out.alerts.push(`The disk that holds the songs is ${pct}% full. Make it larger in Render before it fills: a full disk cannot save new songs.`);
  }
  return out;
}

async function email() {
  if (cfg.messageProvider !== 'resend' || !cfg.resendKey) return { off: true, monthly: 0, monthlyFrom: 'Not in use yet', says: 'Not connected yet, so nothing is being paid.' };
  const s = db.messagesSent(Date.now() - 30 * DAY);
  const out = { says: `${count(s.n)} email${s.n === 1 ? '' : 's'} sent in the last 30 days. Resend's free plan covers 3,000 a month and 100 a day.`, alerts: [] };
  if (s.n <= 3000) { out.monthly = 0; out.monthlyFrom = 'Resend\'s free plan'; }
  else out.says = `${count(s.n)} emails sent in the last 30 days, which is past Resend's free plan.`;
  if (s.busiest >= 80) out.alerts.push(`The site sent ${count(s.busiest)} emails in one day. Resend's free plan stops at 100 a day, so move to the paid plan before emails start failing.`);
  return out;
}

async function domain() {
  let host = '';
  try { host = new URL(cfg.baseUrl).hostname.toLowerCase(); } catch (e) { host = ''; }
  if (!host || host === 'localhost' || /^[\d.:[\]]+$/.test(host) || host.endsWith('.onrender.com')) return { off: true, monthly: 0, monthlyFrom: 'Not in use yet', says: 'No domain yet: the site is on Render\'s own address, which is free.' };
  const name = host.split('.').slice(-2).join('.');
  const j = await ask('the domain registry', 'domain', '/domain/' + encodeURIComponent(name), { accept: 'application/rdap+json, application/json' });
  const ev = ((j && j.events) || []).find(e => e && e.eventAction === 'expiration'), at = ev ? Date.parse(ev.eventDate) : NaN;
  if (!Number.isFinite(at)) return { says: `${name}: the registry did not say when it renews.` };
  return { renews: isoDay(at), says: `${name} is registered until ${nice(at)}.` };
}

const FEEDS = { claude, mureka: murekaFeed, elevenlabs, stripe, render, email, domain };
const NAMES = { claude: 'Anthropic', mureka: 'Mureka', elevenlabs: 'ElevenLabs', stripe: 'Stripe', render: 'Render', email: 'the email service', domain: 'the domain registry' };

/* ---------- keeping the answers ---------- */
function live() {
  try { const v = JSON.parse(db.getSetting('vendor_live') || 'null'); if (v && typeof v === 'object' && v.feeds) return v; } catch (e) { /* nothing kept yet */ }
  return { at: 0, feeds: {} };
}
let running = null;
function refresh() {
  if (running) return running;
  running = (async () => {
    const before = live().feeds, feeds = {};
    await Promise.all(Object.keys(FEEDS).map(async k => {
      try { feeds[k] = Object.assign({ at: Date.now() }, await FEEDS[k]()); }
      catch (e) {
        if (!(e instanceof FeedError)) console.error('Vendor feed crashed:', k, e);
        const err = e instanceof FeedError ? e.message : `The site could not work out the figures for ${NAMES[k]}.`;
        // Keep the last good figures, and say that they are old.
        feeds[k] = before[k] && !before[k].off ? Object.assign({}, before[k], { err, alerts: [] }) : { err };
      }
    }));
    db.setSetting('vendor_live', JSON.stringify({ at: Date.now(), feeds }));
    return feeds;
  })().finally(() => { running = null; });
  return running;
}
// Checks soon after the site starts, then four times a day.
function start() {
  const go = () => refresh().catch(e => console.error('Vendor check crashed:', e));
  setTimeout(go, 20 * 1000).unref();
  setInterval(go, EVERY).unref();
}

module.exports = { live, refresh, start, NAMES };
