'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cfg = require('./src/config');
const db = require('./src/db');
const limits = require('./src/limits');
const notify = require('./src/notify');
const { PublicError } = require('./src/errors');
const { writeLyrics, reviewContent, suggestSound, checkSpelling, listNames, THEME } = require('./src/lyrics');
const { startGeneration, recoverInterrupted } = require('./src/jobs');
const { getEngine } = require('./src/engines');
const LEGAL = require('./src/legal.json');
const OCCASIONS = require('./src/occasions.json');

const stripe = cfg.stripeKey ? require('stripe')(cfg.stripeKey) : null;
const testCheckout = !stripe && cfg.devMocks;

const app = express();
app.set('trust proxy', cfg.trustProxy);
app.disable('x-powered-by');
// Protective headers on every response: no guessing file types, no showing the site inside another site's
// frame, no leaking full addresses (which can hold a song's key) to other sites, and https only once on https.
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  if (/^https:/.test(process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || '')) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
// For text that goes into a request to Claude between triple quotes: it can't close the quotes itself.
const quotable = (v, max) => clip(v, max).replace(/"{3,}/g, '"');
// A name or other short label: one line.
const label = (v, max) => clip(String(v == null ? '' : v).replace(/\s+/g, ' '), max);
const newId = bytes => crypto.randomBytes(bytes).toString('base64url');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const giftUrl = id => `${cfg.baseUrl}/g/${id}`;
// A contact is an email address or a mobile number.
function contactKind(v) {
  v = String(v || '').trim();
  if (/^\S+@\S+\.\S+$/.test(v)) return 'email';
  if (v.replace(/\D/g, '').length >= 10 && /^[\d\s().+-]+$/.test(v)) return 'phone';
  return '';
}
const PRICES = { gold: () => cfg.priceGoldCents, platinum: () => cfg.pricePlatinumCents };
const tierName = t => (t === 'platinum' ? 'Platinum' : 'Gold');
const DAY = 24 * 3600 * 1000;

// What the gift page shows: the words of the recording that was chosen, which can differ from
// lyrics the sender has edited since but not recorded.
function shown(o) {
  const t = o.takes[o.chosen];
  return { title: (t && t.title) || o.title, lyrics: (t && t.lyrics) || o.lyrics };
}

// Platinum comes with two takes. If the customer only recorded one before paying, record the other now.
function startSecondTake(id) {
  const o = db.getOrder(id);
  if (!o || !o.paid || o.removed || o.tier !== 'platinum' || o.takes.length !== 1 || o.status === 'generating') return false;
  try { getEngine(); } catch (e) { return false; }
  const t = o.takes[0];
  db.updateOrder(id, { status: 'generating', error: null, gen_started_at: Date.now(), gen_kind: 'second', gen_event_id: null,
    title: t.title || o.title, lyrics: t.lyrics || o.lyrics, style: t.style || o.style }); // the same words, performed again
  startGeneration(id);
  return true;
}

// tier and priceCents come from the checkout that was actually paid, not from whatever the order says now.
function markPaid(id, sessionId, tier, priceCents) {
  const o = db.getOrder(id);
  if (!o || o.paid) return;
  const t = tier === 'platinum' || tier === 'gold' ? tier : (o.tier === 'platinum' ? 'platinum' : 'gold');
  const cents = parseInt(priceCents, 10);
  db.updateOrder(id, { paid: true, paid_at: Date.now(), stripe_session: sessionId || null, tier: t, price_cents: Number.isFinite(cents) ? cents : PRICES[t]() });
  db.removeOrderEvents(id, 'song'); // a song that was paid for no longer counts towards the free-preview limit
  db.bumpFunnel('paid');
  // A real sale, or a practice unlock from the test checkout that brought in no money.
  db.addUsage(sessionId === 'test' ? 'sale_practice' : 'sale', 1, Number.isFinite(cents) ? cents : PRICES[t]());
  // How this sale came about, for the "How songs spread" figures. A practice unlock counts as unlocked, with no money.
  const got = sessionId === 'test' ? 0 : (Number.isFinite(cents) ? cents : PRICES[t]());
  if (o.via) db.addUsage(`via_${o.via}_sale`, 1, got);
  if (o.ref_code) db.addUsage('ref_sale:' + o.ref_code, 1, got);
  if (o.group_id) db.addUsage('group_sale', 1, got);
  if (o.heard) db.addUsage('heard:' + o.heard, 1, got);
  notify.send(id, o.contact, `Your song for ${o.recipient} is ready to send`,
    `Thank you. Your ${tierName(t)} record for ${o.recipient} is unlocked. Order reference: ${id}.\n\nSend them this link: ${giftUrl(id)}\n\nManage it here: ${cfg.baseUrl}/?order=${id}&key=${o.key}\n\nRedo and refund policy: ${cfg.baseUrl}/refunds`);
  // Everyone who added their memories and left an email hears that the song is ready.
  const g = o.group_id ? db.getGroup(o.group_id) : null;
  if (g) for (const p of db.groupParts(g.id)) {
    if (contactKind(p.contact) !== 'email') continue;
    notify.send(id, p.contact, `The song for ${o.recipient} is ready`,
      `${g.organizer} has finished the song you helped make for ${o.recipient}.\n\nListen to it here: ${giftUrl(id)}?sender=1\n\n${g.organizer} is the one giving it to ${o.recipient}, so please leave the sending to them. Afterwards, you can see what ${o.recipient} writes back on the page where you added your memories: ${cfg.baseUrl}/join/${g.id}`);
  }
  if (t === 'platinum') startSecondTake(id);
}

/* ---------- Stripe webhook (needs the raw body, so it comes before express.json) ---------- */
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !cfg.stripeWebhookSecret) return res.status(503).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], cfg.stripeWebhookSecret);
  } catch (e) {
    return res.status(400).send('Bad signature');
  }
  db.noteOk('stripe');
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const s = event.data.object;
    if (s.payment_status === 'paid' && s.metadata && s.metadata.orderId) markPaid(s.metadata.orderId, s.id, s.metadata.tier, s.metadata.priceCents);
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '60kb' }));

/* ---------- helpers ---------- */
function cleanBrief(b) {
  b = b || {};
  const answers = (Array.isArray(b.answers) ? b.answers : []).slice(0, 6)
    .map(p => ({ q: label(p && p.q, 120), a: quotable(p && p.a, 600) })).filter(p => p.q && p.a);
  const brief = {
    recipient: clip(b.recipient, 40), sender: clip(b.sender, 40), relationship: clip(b.relationship, 40),
    occasion: clip(b.occasion, 40) || 'Just because', tone: clip(b.tone, 60) || 'Heartfelt',
    genre: clip(b.genre, 60) || 'Acoustic folk', voice: clip(b.voice, 40) || 'No preference',
    language: clip(b.language, 30) || 'English', sayName: clip(b.sayName, 40), inspiration: clip(b.inspiration, 120),
    tempo: clip(b.tempo, 30), instruments: label(b.instruments, 80),
    contact: clip(b.contact, 120), answers,
  };
  if (!brief.recipient) throw new PublicError('Add their name so the song can use it.');
  if (!brief.sender) throw new PublicError("Add your name so they know who it's from.");
  // A song made together: add what the others wrote. An invitation this device doesn't hold the key to is ignored.
  const g = b.group && typeof b.group === 'object' ? db.getGroup(clip(b.group.id, 40)) : null;
  let others = [];
  if (g && sameText(clip(b.group.key, 60), g.key)) {
    // b.group.used, when given, is whose memories the lyrics in hand were written from (see /api/lyrics): someone
    // who added theirs after that is not in the song, so is not counted here.
    const used = Array.isArray(b.group.used) ? b.group.used.map(Number) : null;
    const people = db.groupParts(g.id).filter(p => p.answers.length && (!used || used.includes(p.id)))
      .map(p => ({ id: p.id, name: p.name, relationship: p.relationship || '', answers: p.answers }));
    const names = [brief.sender].concat(people.map(p => p.name));
    brief.group = { id: g.id, people, taken: !!g.order_id };
    brief.fromAll = listNames(names); // everyone, for the gift page
    brief.from = fromLine(names);     // short enough for the record label and the heading
    others = people.flatMap(p => p.answers);
  }
  // A theme ("young love") can be said in two words; a story needs a sentence.
  const said = answers.concat(others).map(p => p.a).join(' ').length;
  if (brief.occasion === THEME ? said < 8 : said < 20) throw new PublicError(brief.occasion === THEME ? 'Tell us the theme, in a few words.' : 'Answer at least one question, in a sentence or two.');
  return brief;
}
function ownedOrder(req) {
  const o = db.getOrder(req.params.id);
  const key = Buffer.from(String(req.get('x-order-key') || req.query.key || ''));
  const real = Buffer.from(o ? o.key : '');
  if (!o || !key.length || key.length !== real.length || !crypto.timingSafeEqual(key, real)) {
    throw new PublicError('That song was not found on this device.', 404);
  }
  return o;
}
// How long a recording usually takes: the average of recent real ones, or a starting guess per engine.
const FIRST_GUESS = { mock: 3, elevenlabs: 75, sunoapi: 150 };
let estimateCache = { at: 0, value: 0 };
function estimateSeconds() {
  if (Date.now() - estimateCache.at < 30000) return estimateCache.value;
  const times = [];
  for (const o of db.listOrders(60)) for (const t of o.takes) if (t.genSeconds && t.engine === cfg.musicEngine && times.length < 20) times.push(t.genSeconds);
  const value = times.length >= 3 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : (FIRST_GUESS[cfg.musicEngine] || 90);
  estimateCache = { at: Date.now(), value };
  return value;
}
function scheduleView(o) {
  return o.schedule_date ? { to: o.schedule_to, date: o.schedule_date, sent: !!o.schedule_sent_at, failed: !!o.schedule_failed_at } : null;
}
// The one free redo: there until it is used, or until the window after paying closes.
function redoView(o) {
  if (!o.paid) return null;
  const until = (o.paid_at || 0) + cfg.redoDays * DAY;
  return { used: !!o.redo_at, until, available: !o.removed && !o.redo_at && cfg.redoDays > 0 && Date.now() <= until };
}
function senderView(o) {
  return {
    id: o.id, status: o.status, error: o.error || null, paid: o.paid, paidAt: o.paid_at || null, tier: o.tier || 'gold',
    recipient: o.recipient, sender: o.sender, occasion: o.occasion, genre: o.genre, tone: o.tone, title: o.title, lyrics: o.lyrics, style: o.style || '',
    note: o.note || '', sayName: o.say_name || '', contactKind: contactKind(o.contact),
    takes: o.takes.map((t, i) => ({ n: i, title: t.title, duration: t.duration, previewSection: t.previewSection || null })), chosen: o.chosen,
    takesLeft: Math.max(0, cfg.takesPerOrder - o.attempts), previewSeconds: cfg.previewSeconds,
    estimateSeconds: estimateSeconds(),
    elapsedSeconds: o.status === 'generating' && o.gen_started_at ? Math.max(0, Math.round((Date.now() - o.gen_started_at) / 1000)) : 0,
    giftUrl: o.paid ? giftUrl(o.id) : null, schedule: scheduleView(o),
    // after payment: which recording is under way, the free redo, and a Platinum second take still owed
    kind: o.status === 'generating' ? (o.gen_kind || 'take') : null, redo: redoView(o),
    secondTakeMissing: !!(o.paid && o.tier === 'platinum' && o.takes.length < 2 && o.status !== 'generating'),
    // what has happened on the gift page, so the sender can see it on their own page even with no message service
    firstPlayedAt: o.first_played_at || null, replies: o.paid ? db.repliesFor(o.id) : [],
    // a song made together: everyone it is from. passedOn: songs since started from this one's gift page or by its contributors.
    fromAll: o.group_names || '', together: !!o.group_id, passedOn: o.paid ? db.songsLedTo(o.id) : 0,
    heard: o.heard || '', reminder: o.paid ? reminderView(o) : null,
  };
}
// How long lyric writing usually takes: the average of recent requests, or a starting guess.
const lyricTimes = [];
const lyricsEstimateSeconds = () => (lyricTimes.length >= 3 ? Math.round(lyricTimes.reduce((a, b) => a + b, 0) / lyricTimes.length) : 20);

/* ---------- private preview lock ---------- */
// With ACCESS_CODE set, making a song needs the invite code. Gift pages, policy pages and songs that
// already exist stay open to anyone holding their link. An invite link looks like  https://your-site/?code=THE-CODE
const accessToken = () => crypto.createHmac('sha256', cfg.accessCode).update('songpost-access').digest('base64url');
const cookieOf = (req, name) => { const m = ('; ' + (req.headers.cookie || '')).match(new RegExp('; ' + name + '=([^;]*)')); return m ? m[1] : ''; };
const sameText = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const hasAccess = req => !cfg.accessCode || sameText(cookieOf(req, 'sp_access'), accessToken());
const codeMatches = code => !!cfg.accessCode && sameText(String(code || '').trim().toLowerCase(), cfg.accessCode.toLowerCase());
function grantAccess(res) {
  res.append('Set-Cookie', `sp_access=${accessToken()}; Path=/; Max-Age=${60 * 24 * 3600}; HttpOnly; SameSite=Lax${cfg.baseUrl.startsWith('https') ? '; Secure' : ''}`);
}
function requireAccess(req) {
  if (!hasAccess(req)) throw new PublicError('Songpost is in a private preview. Open the site and enter your invite code first.', 403);
}
app.post('/api/access', (req, res) => {
  if (!limits.allow(req.ip, 'access', 20)) return res.status(429).json({ error: 'Too many tries. Wait a while and try again.' });
  if (!codeMatches(req.body && req.body.code)) return res.status(403).json({ error: "That code isn't right. Check it and try again." });
  grantAccess(res);
  res.json({ ok: true });
});

// "Send it for me on a date" is only offered when messages can really be sent (or in local practice mode).
const canSchedule = () => notify.live() || cfg.devMocks;
// Whether a message can get to this contact. A mobile number is out of reach when only email is connected.
const canReach = contact => contactKind(contact) !== 'phone' || !notify.live() || notify.canText();

/* ---------- public API ---------- */
app.get('/api/config', (req, res) => {
  res.json({ priceGoldCents: cfg.priceGoldCents, pricePlatinumCents: cfg.pricePlatinumCents, previewSeconds: cfg.previewSeconds,
    takesPerOrder: cfg.takesPerOrder, testCheckout, messaging: notify.live(), scheduling: canSchedule(), redoDays: cfg.redoDays,
    lyricsEstimateSeconds: lyricsEstimateSeconds(), texting: notify.canText(), heardChoices: HEARD });
});

// The moments we count to see where visitors drop off. "paid" is counted on the server.
const TRACKED = ['arrived', 'started', 'lyrics', 'preview', 'clickpay'];
// Visits that came from somewhere we want to measure: a gift page, the page where someone added to a group song, a partner's link.
const VISITS = { fromgift: 'via_gift_visit', fromjoin: 'via_join_visit' };
app.post('/api/track', (req, res) => {
  const kind = String(req.body && req.body.kind || '');
  const visit = Object.prototype.hasOwnProperty.call(VISITS, kind) ? VISITS[kind] : null;
  if ((TRACKED.includes(kind) || visit || kind === 'ref') && limits.allow(req.ip, 'track', 60)) {
    if (TRACKED.includes(kind)) db.bumpFunnel(kind);
    else if (visit) db.addUsage(visit, 1, 0);
    else { const p = db.getPartner(clip(req.body.code, 40).toLowerCase()); if (p) db.addUsage('ref_visit:' + p.code, 1, 0); }
  }
  res.json({ ok: true });
});

/* ---------- where a song came from ---------- */
// The choices for "How did you hear about Songpost?", asked once after the first song a device unlocks.
const HEARD = ['Someone sent me a song', 'A friend or family member', 'Facebook or Instagram', 'TikTok or YouTube', 'My workplace',
  'A shop or business', 'A search online', 'News, radio or TV', 'Something else'];
// What the browser says about how the visitor arrived, checked against what we know. Nothing here is trusted as given.
function sourceOf(body) {
  const s = (body && typeof body.source === 'object' && body.source) || {};
  const out = { via: null, from_order: null, chain_depth: 0, ref_code: null, heard: null };
  let parent = null;
  if (s.from) { parent = db.getOrder(clip(s.from, 40)); if (parent && parent.paid) out.via = 'gift'; else parent = null; }
  else if (s.join) { const g = db.getGroup(clip(s.join, 40)); if (g) { out.via = 'join'; parent = g.order_id ? db.getOrder(g.order_id) : null; } }
  if (parent) { out.from_order = parent.id; out.chain_depth = (parent.chain_depth || 0) + 1; }
  const p = s.ref ? db.getPartner(clip(s.ref, 40).toLowerCase()) : null;
  if (p) out.ref_code = p.code;
  const heard = clip(s.heard, 60);
  out.heard = HEARD.includes(heard) ? heard : out.via === 'gift' ? HEARD[0] : null;
  return out;
}

/* ---------- songs made together ---------- */
// One person starts the song and sends an invite link. Each person who opens it adds their own memories on the
// page at /join/<id>. The organizer sees what was added, and the lyrics are written from everyone's answers.
// Recording the song closes the invitation.
const MAX_PARTS = 8;
// Who a song made together is from, short enough for the record label and the page heading.
function fromLine(names) {
  const all = listNames(names);
  return names.length < 3 || all.length <= 40 ? all : `${names[0]} and ${names.length - 1} others`;
}
function ownedGroup(req) {
  const g = db.getGroup(req.params.id), key = String(req.get('x-group-key') || '');
  if (!g || !key || !sameText(key, g.key)) throw new PublicError('That invitation was not found on this device.', 404);
  return g;
}
function groupView(g) {
  return { id: g.id, closed: !!g.order_id, joinUrl: `${cfg.baseUrl}/join/${g.id}`, max: MAX_PARTS,
    parts: db.groupParts(g.id).map(p => ({ id: p.id, name: p.name, relationship: p.relationship || '', at: p.at, answers: p.answers })) };
}
const groupBasics = b => ({ organizer: clip(b && b.organizer, 40), recipient: clip(b && b.recipient, 40), relationship: clip(b && b.relationship, 40),
  occasion: clip(b && b.occasion, 40) || 'Just because' });
app.post('/api/groups', wrap(async (req, res) => {
  requireAccess(req);
  const b = groupBasics(req.body);
  if (!b.recipient) throw new PublicError('Add their name first, so the people you invite know who the song is for.');
  if (!b.organizer) throw new PublicError('Add your name first, so the people you invite know who is asking.');
  if (!limits.allow(req.ip, 'group', 10)) throw new PublicError('That is a lot of invitations. Try again later.', 429);
  const g = Object.assign({ id: newId(9), key: newId(18), created_at: Date.now(), ip: req.ip }, b);
  db.createGroup(g);
  db.addUsage('group_invite', 1, 0);
  res.json(Object.assign({ key: g.key }, groupView(g)));
}));
// The organizer's page asks this every so often: who has added their part. It also carries any change to the names.
app.post('/api/groups/:id/sync', wrap(async (req, res) => {
  const g = ownedGroup(req), b = groupBasics(req.body);
  if (!g.order_id && b.recipient && b.organizer) db.updateGroup(g.id, b);
  res.json(groupView(db.getGroup(g.id)));
}));
app.post('/api/groups/:id/remove', wrap(async (req, res) => {
  const g = ownedGroup(req);
  if (g.order_id) throw new PublicError('The song has already been recorded.');
  db.removeGroupPart(g.id, parseInt(req.body.part, 10));
  res.json(groupView(g));
}));

// The page an invited person sees. Anyone with the link can read who the song is for and add to it; only the
// device that added a part can change it, and only that device is shown the finished song.
const partOf = (g, req) => { const t = String(req.get('x-part-token') || ''); return (t && db.groupParts(g.id).find(p => sameText(t, p.token))) || null; };
function joinView(g, part) {
  const o = g.order_id ? db.getOrder(g.order_id) : null;
  const out = { organizer: g.organizer, recipient: g.recipient, relationship: g.relationship || '', occasion: g.occasion, closed: !!g.order_id,
    full: !part && db.groupParts(g.id).length >= MAX_PARTS, emailOn: notify.live(),
    mine: part ? { name: part.name, relationship: part.relationship || '', answers: part.answers, contact: part.contact || '' } : null, ready: null };
  if (part && o && o.paid && !o.removed) {
    out.ready = { id: o.id, url: `/g/${o.id}?sender=1`, title: shown(o).title, firstPlayedAt: o.first_played_at || null, replies: db.repliesFor(o.id) };
  }
  return out;
}
const invited = id => { const g = db.getGroup(id); if (!g) throw new PublicError('This invitation was not found. Check the link, or ask for it again.', 404); return g; };
app.get('/api/join/:id', wrap(async (req, res) => { const g = invited(req.params.id); res.set('Cache-Control', 'no-store').json(joinView(g, partOf(g, req))); }));
app.post('/api/join/:id', wrap(async (req, res) => {
  const g = invited(req.params.id), mine = partOf(g, req), b = req.body || {};
  if (g.order_id) throw new PublicError(`${g.organizer} has already recorded the song, so nothing more can be added.`);
  const name = label(b.name, 24), contact = clip(b.contact, 120);
  const answers = (Array.isArray(b.answers) ? b.answers : []).slice(0, 4).map(p => ({ q: label(p && p.q, 120), a: quotable(p && p.a, 400) })).filter(p => p.q && p.a);
  if (!name) throw new PublicError('Add your first name, so the song can be signed from you.');
  if (answers.map(p => p.a).join(' ').length < 8) throw new PublicError('Answer at least one question, in a sentence or two.');
  if (contact && contactKind(contact) !== 'email') throw new PublicError("That doesn't look like an email address. Check it, or leave it empty.");
  const part = { group_id: g.id, name, relationship: label(b.relationship, 40), answers_json: JSON.stringify(answers), contact, at: Date.now(), ip: req.ip };
  if (mine) { db.updateGroupPart(mine.id, part); return res.json({ token: mine.token }); }
  if (db.groupParts(g.id).length >= MAX_PARTS) throw new PublicError('This song already has as many people as it can hold.');
  if (!limits.allow(req.ip, 'join', 20)) throw new PublicError('That is a lot of entries. Try again later.', 429);
  part.token = newId(18);
  db.addGroupPart(part);
  db.addUsage('group_part', 1, 0);
  res.json({ token: part.token });
}));

// A tone and musical style suggested from the story. The customer sees them already selected and can change them.
// This never returns an error: no suggestion just means the usual defaults stay selected.
app.post('/api/suggest', wrap(async (req, res) => {
  requireAccess(req);
  let brief;
  try { brief = cleanBrief(req.body.brief); } catch (e) { return res.json({}); }
  if (!limits.allow(req.ip, 'suggest', 30)) return res.json({});
  res.json((await suggestSound(brief).catch(() => null)) || {});
}));

// The spelling of an occasion the customer typed themselves. Like the suggestion above, this never returns an error:
// with nothing to offer, the text comes back as it was typed.
app.post('/api/spell', wrap(async (req, res) => {
  requireAccess(req);
  const text = label(req.body && req.body.text, 40);
  if (!text || !limits.allow(req.ip, 'spell', 30)) return res.json({ text });
  res.json({ text: (await checkSpelling(text).catch(() => null)) || text });
}));

// 1. Write the lyrics (free).
app.post('/api/lyrics', wrap(async (req, res) => {
  requireAccess(req);
  const brief = cleanBrief(req.body.brief);
  limits.checkLyrics(req.ip);
  const started = Date.now();
  const out = await writeLyrics(brief, clip(req.body.again, 80) || null);
  lyricTimes.push(Math.max(1, Math.round((Date.now() - started) / 1000)));
  if (lyricTimes.length > 20) lyricTimes.shift();
  // For a song made together: whose memories these lyrics were written from. The browser sends it back when recording.
  if (brief.group) out.usedParts = brief.group.people.map(p => p.id);
  res.json(out);
}));

// 2. Record the song. Costs us money, so it needs a contact and is rate limited.
app.post('/api/orders', wrap(async (req, res) => {
  requireAccess(req);
  const brief = cleanBrief(req.body.brief);
  if (brief.group && brief.group.taken) { brief.group = null; brief.fromAll = ''; } // an invitation that already has its song can't be used for another
  if (!contactKind(brief.contact)) throw new PublicError('Add your email or mobile number so we can send you the link to your song.');
  if (!canReach(brief.contact)) throw new PublicError("We can't send texts yet. Add your email address so we can send you the link to your song.");
  const lyrics = clip(req.body.lyrics, 4500);
  if (lyrics.length < 40) throw new PublicError('The song needs lyrics before it can be recorded.');
  const title = clip(req.body.title, 80) || `A Song for ${brief.recipient}`;
  // How it should sound: written by Claude from the customer's choices, and the customer may have changed it.
  const style = quotable(label(req.body.style, 400), 400) || `${brief.genre}, warm, clear lead vocal`;
  getEngine(); // fail early if the engine name is wrong
  limits.peekSong(req.ip); // refuse before doing any work if today's free previews are used up
  // The customer may have rewritten the lyrics, so they are checked against the content rules before recording.
  // So are the names and occasion the gift page shows, and the sounds-like spelling the singer is given for the name.
  await reviewContent({ title, lyrics, style,
    shown: `For ${brief.recipient}, from ${brief.fromAll || brief.sender}${brief.relationship ? ` (the sender's ${brief.relationship})` : ''}. Occasion: ${brief.occasion}.`,
    sungName: brief.sayName ? `Name: ${brief.recipient}. Sung as: ${brief.sayName}` : '' });
  const id = newId(9);
  // A song made together is signed from everyone who added to it.
  const people = brief.group ? brief.group.people : [], src = sourceOf(req.body);
  const order = Object.assign({
    id, key: newId(18), created_at: Date.now(), status: 'generating', price_cents: cfg.priceGoldCents,
    gen_kind: 'take', gen_event_id: limits.checkSong(req.ip, id),
    recipient: brief.recipient, sender: people.length ? brief.from : brief.sender, relationship: brief.relationship, occasion: brief.occasion,
    group_id: people.length ? brief.group.id : null, group_names: people.length ? brief.fromAll : null,
    tone: brief.tone, genre: brief.genre, voice: brief.voice,
    details: brief.answers.map(p => `${p.q} ${p.a}`).concat(people.flatMap(p => p.answers.map(a => `${p.name}: ${a.q} ${a.a}`))).join('\n'),
    title, lyrics,
    style,
    note: '', attempts: 1, ip: req.ip, language: brief.language, say_name: brief.sayName, contact: brief.contact, gen_started_at: Date.now(),
  }, src);
  db.createOrder(order);
  db.addUsage('song_started', 1, 0);
  if (src.via) db.addUsage(`via_${src.via}_started`, 1, 0);
  if (src.ref_code) db.addUsage('ref_started:' + src.ref_code, 1, 0);
  // Recording closes the invitation: nothing more can be added, and the people who added to it are shown the song once it is unlocked.
  if (brief.group) {
    db.updateGroup(brief.group.id, { order_id: id });
    // What was added too late to be in the song is not kept: those people are not signed on it and are not shown it.
    for (const p of db.groupParts(brief.group.id)) if (!people.some(x => x.id === p.id)) db.removeGroupPart(brief.group.id, p.id);
    if (people.length) db.addUsage('group_started', 1, 0);
  }
  notify.send(order.id, order.contact, `Your song for ${order.recipient}`,
    `Your song for ${order.recipient} is being recorded. Come back to it any time:\n${cfg.baseUrl}/?order=${order.id}&key=${order.key}`);
  startGeneration(order.id);
  res.json({ id: order.id, key: order.key });
}));

// 3. The sender's browser polls this until the recording is ready.
app.get('/api/orders/:id', wrap(async (req, res) => res.json(senderView(ownedOrder(req)))));

// Record another take, optionally with edited lyrics.
app.post('/api/orders/:id/retake', wrap(async (req, res) => {
  const o = ownedOrder(req);
  if (o.paid) throw new PublicError('This song is already unlocked.');
  if (o.status === 'generating') throw new PublicError('A recording is already under way.');
  if (o.attempts >= cfg.takesPerOrder) throw new PublicError('You have used all the takes for this song.');
  getEngine();
  limits.peekSong(req.ip);
  const patch = { status: 'generating', error: null, gen_started_at: Date.now(), gen_kind: 'take' };
  const lyrics = clip(req.body.lyrics, 4500), title = clip(req.body.title, 80), style = quotable(label(req.body.style, 400), 400);
  if (lyrics.length >= 40) patch.lyrics = lyrics;
  if (title) patch.title = title;
  if (style) patch.style = style;
  let now = o;
  const newSound = patch.style && patch.style !== o.style;
  if ((patch.lyrics && patch.lyrics !== o.lyrics) || (patch.title && patch.title !== o.title) || newSound) {
    await reviewContent({ title: patch.title || o.title, lyrics: patch.lyrics || o.lyrics, style: newSound ? patch.style : '' });
    now = db.getOrder(o.id); // the check takes a moment; make sure nothing else started meanwhile
    if (!now || now.paid || now.status === 'generating' || now.attempts >= cfg.takesPerOrder) throw new PublicError('A recording is already under way.');
  }
  patch.attempts = now.attempts + 1;
  patch.gen_event_id = limits.checkSong(req.ip, o.id);
  db.updateOrder(o.id, patch);
  startGeneration(o.id);
  res.json(senderView(db.getOrder(o.id)));
}));

// The one free redo after paying. The new recording replaces the song on the gift page, at the same link.
app.post('/api/orders/:id/redo', wrap(async (req, res) => {
  const o = ownedOrder(req);
  const check = x => {
    if (!x || !x.paid) throw new PublicError('The free redo is for songs that have been unlocked. Before paying, record another take instead.');
    if (x.removed) throw new PublicError('This song has been removed.', 404);
    if (x.status === 'generating') throw new PublicError('A recording is already under way.');
    if (x.redo_at) throw new PublicError('The free redo for this song has already been used.');
    if (!redoView(x).available) throw new PublicError(`The free redo is available for ${cfg.redoDays} days after paying.`);
  };
  check(o);
  getEngine();
  const cur = shown(o);
  const lyrics = clip(req.body.lyrics, 4500), title = clip(req.body.title, 80);
  const next = { title: title || cur.title, lyrics: lyrics.length >= 40 ? lyrics : cur.lyrics };
  if (next.title !== cur.title || next.lyrics !== cur.lyrics) {
    await reviewContent(next);
    check(db.getOrder(o.id));
  }
  db.updateOrder(o.id, { status: 'generating', error: null, gen_started_at: Date.now(), gen_kind: 'redo', gen_event_id: null,
    redo_at: Date.now(), title: next.title, lyrics: next.lyrics });
  startGeneration(o.id);
  res.json(senderView(db.getOrder(o.id)));
}));

// Platinum's second take is recorded automatically after payment. This is the retry if that recording failed.
app.post('/api/orders/:id/second-take', wrap(async (req, res) => {
  const o = ownedOrder(req);
  if (o.status === 'generating') throw new PublicError('A recording is already under way.');
  if (!startSecondTake(o.id)) throw new PublicError('There is no second take to record for this song.');
  res.json(senderView(db.getOrder(o.id)));
}));

// Pick which take to buy.
app.post('/api/orders/:id/choose', wrap(async (req, res) => {
  const o = ownedOrder(req);
  const n = parseInt(req.body.take, 10);
  if (o.paid || !o.takes[n]) throw new PublicError('That take is not available.');
  db.updateOrder(o.id, { chosen: n, title: o.takes[n].title, lyrics: o.takes[n].lyrics });
  res.json(senderView(db.getOrder(o.id)));
}));

// The free preview of a take.
app.get('/api/orders/:id/preview/:n', (req, res) => {
  const o = db.getOrder(req.params.id), t = o && !o.removed && o.takes[parseInt(req.params.n, 10)];
  if (!t) return res.status(404).end();
  res.type(t.mime).set('Cache-Control', 'private, max-age=3600').sendFile(t.preview, { root: db.mediaDir });
});

// 4. Pay. Sends the browser to Stripe Checkout.
app.post('/api/orders/:id/checkout', wrap(async (req, res) => {
  const o = ownedOrder(req);
  if (!o.takes.length || o.status === 'generating') throw new PublicError('The song is not ready yet.');
  if (o.paid) return res.json({ url: `${cfg.baseUrl}/?order=${o.id}` });
  const tier = req.body.tier === 'platinum' ? 'platinum' : 'gold', price = PRICES[tier]();
  const note = clip(req.body.note, 600);
  // The note is shown on the gift page, so it gets the same check as the lyrics. An outage never blocks a sale.
  if (note && note !== (o.note || '')) await reviewContent({ note }, { failOpen: true });
  db.updateOrder(o.id, { note, tier, price_cents: price });
  if (testCheckout) return res.json({ url: `${cfg.baseUrl}/?order=${o.id}&session_id=test` });
  if (!stripe) throw new PublicError('Payments are not set up yet.', 503);
  // An unofficial music engine is fine for previews, but we don't sell what it makes unless told to.
  if (cfg.musicEngine === 'sunoapi' && !cfg.allowUnofficialEngine) throw new PublicError('Payments are off while the site is using a test music engine.', 503);
  const params = {
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: price, product_data: { name: `${tierName(tier)} record for ${o.recipient}` } } }],
    success_url: `${cfg.baseUrl}/?order=${o.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${cfg.baseUrl}/?order=${o.id}`,
    client_reference_id: o.id,
    metadata: { orderId: o.id, tier, priceCents: String(price) }, // what this checkout sells; read back when it is paid
  };
  if (contactKind(o.contact) === 'email') params.customer_email = o.contact;
  if (cfg.stripeAutomaticTax) params.automatic_tax = { enabled: true };
  // Only one checkout stays open per song. An earlier one that was already paid unlocks the song;
  // one that is still open is closed, so the customer can't pay twice or pay one price for the other record.
  if (o.stripe_session) {
    const old = await stripe.checkout.sessions.retrieve(o.stripe_session).catch(() => null);
    if (old && old.payment_status === 'paid' && old.metadata && old.metadata.orderId === o.id) {
      markPaid(o.id, old.id, old.metadata.tier, old.metadata.priceCents);
      return res.json({ url: `${cfg.baseUrl}/?order=${o.id}` });
    }
    if (old && old.status === 'open') await stripe.checkout.sessions.expire(old.id).catch(() => {});
  }
  let session;
  try { session = await stripe.checkout.sessions.create(params); db.noteOk('stripe'); }
  catch (e) { db.noteErr('stripe', e && e.message); throw e; }
  if (!db.getOrder(o.id).paid) db.updateOrder(o.id, { stripe_session: session.id });
  res.json({ url: session.url });
}));

// 5. Back from Stripe. The webhook is the source of truth; this makes the page update right away.
app.get('/api/orders/:id/confirm', wrap(async (req, res) => {
  let o = db.getOrder(req.params.id);
  if (!o) throw new PublicError('That song was not found.', 404);
  const sid = String(req.query.session_id || '');
  if (!o.paid && sid) {
    if (testCheckout && sid === 'test') markPaid(o.id, 'test', o.tier);
    else if (stripe) {
      const s = await stripe.checkout.sessions.retrieve(sid).catch(() => null);
      if (s && s.payment_status === 'paid' && s.metadata && s.metadata.orderId === o.id) markPaid(o.id, s.id, s.metadata.tier, s.metadata.priceCents);
    }
    o = db.getOrder(o.id);
  }
  res.json({ id: o.id, paid: o.paid, paidAt: o.paid_at || null, tier: o.tier || 'gold', recipient: o.recipient, sender: o.sender, together: !!o.group_id, title: shown(o).title,
    giftUrl: o.paid ? giftUrl(o.id) : null });
}));

// Send it for me on a date.
app.post('/api/orders/:id/schedule', wrap(async (req, res) => {
  const o = ownedOrder(req);
  if (!o.paid) throw new PublicError('Unlock the song before scheduling it.');
  if (!canSchedule()) throw new PublicError("We can't send songs for you yet. Send them the link yourself.", 503);
  if (o.schedule_sent_at) throw new PublicError('This song has already been sent.');
  if (o.schedule_queued_at && !o.schedule_failed_at) throw new PublicError('This song is already on its way.');
  const to = clip(req.body.to, 120), date = clip(req.body.date, 10);
  if (!contactKind(to)) throw new PublicError('Add their email or mobile number so we know where to send it.');
  if (!canReach(to)) throw new PublicError("We can't send texts yet. Add their email address instead.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + 'T00:00:00Z'))) throw new PublicError('Pick the date to send it.');
  // The customer's "today" can be a day behind the server's (UTC) date, so yesterday in UTC is still allowed.
  if (date < new Date(Date.now() - DAY).toISOString().slice(0, 10)) throw new PublicError('Pick today or a later date.');
  db.updateOrder(o.id, { schedule_to: to, schedule_date: date, schedule_queued_at: null, schedule_failed_at: null });
  res.json({ schedule: scheduleView(db.getOrder(o.id)) });
}));

// "How did you hear about Songpost?" Answered once, after unlocking.
app.post('/api/orders/:id/heard', wrap(async (req, res) => {
  const o = ownedOrder(req), answer = clip(req.body.answer, 60);
  if (!o.paid) throw new PublicError('Unlock the song first.');
  if (!HEARD.includes(answer)) throw new PublicError('Pick one of the answers.');
  if (!o.heard) {
    db.updateOrder(o.id, { heard: answer });
    db.addUsage('heard:' + answer, 1, o.stripe_session === 'test' ? 0 : o.price_cents);
  }
  res.json({ heard: o.heard || answer });
}));

/* ---------- reminders the buyer asks for ---------- */
// Emails only, and only to someone who asked: a date of their own each year, and, if they tick it, the gift holidays.
function reminderView(o) {
  const r = db.reminderFor(o.id);
  return r ? { email: r.email, monthDay: r.month_day || '', holidays: !!r.holidays } : null;
}
app.post('/api/orders/:id/reminder', wrap(async (req, res) => {
  const o = ownedOrder(req), b = req.body || {};
  if (!o.paid) throw new PublicError('Unlock the song first.');
  if (b.off) { const r = db.reminderFor(o.id); if (r) db.removeReminder(r.id); return res.json({ reminder: null }); }
  if (!canSchedule()) throw new PublicError("We can't send reminders yet.", 503);
  // A reminder goes to the address the buyer gave for the song. Only a buyer who gave a mobile number types one here.
  const had = db.reminderFor(o.id);
  const email = contactKind(o.contact) === 'email' ? o.contact : clip(b.email, 120) || (had ? had.email : '');
  if (contactKind(email) !== 'email') throw new PublicError('Add your email address so we know where to send the reminder.');
  // The date is kept as a month and day, and comes round every year. 29 February is kept as the 28th.
  const m = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(clip(b.date, 10));
  let monthDay = '';
  if (m) {
    if (isNaN(Date.parse(`2024-${m[1]}-${m[2]}T00:00:00Z`)) || new Date(`2024-${m[1]}-${m[2]}T00:00:00Z`).getUTCDate() !== +m[2]) throw new PublicError('Pick the date to be reminded about.');
    monthDay = m[1] === '02' && m[2] === '29' ? '02-28' : `${m[1]}-${m[2]}`;
  }
  if (!monthDay && !b.holidays) throw new PublicError('Pick a date, or tick the holidays, so there is something to remind you about.');
  if (!limits.allow(req.ip, 'reminder', 20)) throw new PublicError('That is a lot of reminders. Try again later.', 429);
  db.setReminder({ token: newId(12), order_id: o.id, email, sender: o.sender, recipient: o.recipient, occasion: o.occasion,
    month_day: monthDay, holidays: b.holidays ? 1 : 0, created_at: Date.now() });
  res.json({ reminder: reminderView(o) });
}));

/* ---------- the gift page ---------- */
function liveGift(id) {
  const o = db.getOrder(id);
  if (!o || !o.paid) throw new PublicError('This song has not been unlocked yet.', 404);
  if (o.removed) throw new PublicError('This song has been removed.', 404);
  return o;
}
// What the recipient's page needs. Only once the song is paid for, and never after it is removed.
app.get('/api/gift/:id', wrap(async (req, res) => {
  const o = liveGift(req.params.id);
  const words = shown(o);
  const out = { recipient: o.recipient, sender: o.sender, occasion: o.occasion, genre: o.genre, tone: o.tone, tier: o.tier || 'gold',
    title: words.title, lyrics: words.lyrics, note: o.note || '', paidAt: o.paid_at, audioUrl: `/media/${o.id}`,
    replyIsSent: notify.live() && !!contactKind(o.contact) && canReach(o.contact), // false: a reply waits on the sender's page instead of being messaged
    fromAll: o.group_names && o.group_names !== o.sender ? o.group_names : '', together: !!o.group_id };
  // Platinum keeps every recording, each with its own words.
  if (out.tier === 'platinum' && o.takes.length > 1) {
    out.takes = o.takes.map((t, i) => ({ url: `/media/${o.id}?take=${i}`, chosen: i === o.chosen, title: t.title || words.title, lyrics: t.lyrics || words.lyrics }));
  }
  res.json(out);
}));
app.post('/api/gift/:id/played', wrap(async (req, res) => {
  const o = liveGift(req.params.id);
  if (!o.first_played_at) {
    db.updateOrder(o.id, { first_played_at: Date.now() });
    notify.send(o.id, o.contact, `${o.recipient} played your song`, `${o.recipient} just played the song you made.\n${giftUrl(o.id)}`);
  }
  res.json({ ok: true });
}));
app.post('/api/gift/:id/reply', wrap(async (req, res) => {
  const o = liveGift(req.params.id);
  const body = clip(req.body.body, 600);
  if (!body) throw new PublicError('Write a few words first.');
  if (!limits.allow(req.ip, 'reply', 10)) throw new PublicError('That is a lot of messages. Try again later.', 429);
  db.addReply(o.id, body, !!req.body.shareOk);
  notify.send(o.id, o.contact, `${o.recipient} wrote back about your song`, `${o.recipient} says:\n\n${body}`);
  res.json({ ok: true });
}));
app.post('/api/gift/:id/report', wrap(async (req, res) => {
  const o = liveGift(req.params.id);
  const body = clip(req.body.body, 600);
  if (!body) throw new PublicError('Tell us what is wrong first.');
  if (!limits.allow(req.ip, 'report', 10)) throw new PublicError('That is a lot of reports. Try again later.', 429);
  db.addReport(o.id, body);
  res.json({ ok: true });
}));

// The full song. Only once paid, and never after it is removed.
app.get('/media/:id', (req, res) => {
  const o = db.getOrder(req.params.id);
  if (!o || !o.paid || o.removed) return res.status(404).end();
  let n = o.chosen;
  if (req.query.take != null && (o.tier === 'platinum') && o.takes[parseInt(req.query.take, 10)]) n = parseInt(req.query.take, 10);
  const t = o.takes[n];
  if (!t) return res.status(404).end();
  if (req.query.download) res.attachment(`${(t.title || o.title || 'song').replace(/[^\w \-]+/g, '').trim() || 'song'}.${t.file.split('.').pop()}`);
  res.type(t.mime).set('Cache-Control', 'private, max-age=86400').sendFile(t.file, { root: db.mediaDir });
});

// Some engines insist on a callback address. We poll instead.
app.post('/api/engine-callback', (req, res) => res.json({ ok: true }));

// What people have said. Real words only: quotes typed into public/testimonials.json by the owner, followed by
// replies from recipients who allowed sharing and that the owner chose on the admin page.
/* ---------- example songs on the opening page ---------- */
// Up to three, chosen by the owner on the admin page: songs made on this site, or audio files the owner uploaded.
// A song made here stops being an example the moment it is removed or deleted.
const MAX_SAMPLES = 3;
// Every example says who made it: the founder, by that word and not by name. The owner can add to it ("..., for his wife").
const FOUNDER_LINE = 'Made by the founder of Songpost';
// Every example says how it was recorded, so a visitor knows whether it is what they will get.
const SAME_NOTE = 'Recorded on Songpost, with the same music tool that will record your song.';
const OUTSIDE_NOTE = 'Recorded with a different music tool from the one Songpost uses, so your song may sound different.';
function sampleSource(s) {
  if (!s.order_id) return s.file ? { file: s.file, mime: s.mime || 'audio/mpeg', title: s.title, note: s.outside ? OUTSIDE_NOTE : SAME_NOTE } : null;
  const o = db.getOrder(s.order_id), t = o && o.paid && !o.removed ? o.takes[o.chosen] : null;
  // A song made here before the music engine was changed was recorded with the earlier one.
  return t ? { file: t.file, mime: t.mime, title: s.title || shown(o).title, note: !t.engine || t.engine === cfg.musicEngine ? SAME_NOTE : 'Recorded on Songpost.' } : null;
}
app.get('/samples.json', (req, res) => {
  const list = db.listSamples().map(s => ({ s, src: sampleSource(s) })).filter(x => x.src).slice(0, MAX_SAMPLES)
    .map(({ s, src }) => ({ id: s.id, title: src.title || 'A Songpost song', caption: s.caption || FOUNDER_LINE, note: src.note, url: `/sample/${s.id}` }));
  res.set('Cache-Control', 'no-store').json(list);
});
app.get('/sample/:id', (req, res) => {
  const s = db.getSample(parseInt(req.params.id, 10)), src = s && sampleSource(s);
  if (!src) return res.status(404).end();
  res.type(src.mime).set('Cache-Control', 'public, max-age=3600').sendFile(path.basename(src.file), { root: db.mediaDir });
});

app.get('/testimonials.json', (req, res) => {
  let typed = [];
  try { typed = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'testimonials.json'), 'utf8')); } catch (e) { /* none */ }
  const chosen = db.featuredReplies(3).map(r => ({ quote: r.body, name: `${r.recipient}, who was given a song` }));
  res.set('Cache-Control', 'no-store').json((Array.isArray(typed) ? typed : []).concat(chosen).slice(0, 3));
});

/* ---------- pages ---------- */
const pageHtml = fs.readFileSync(path.join(__dirname, 'src', 'page.html'), 'utf8');
// The policy-page frame, filled in. body is trusted HTML written in this file or in legal.json.
// opts.desc is the description search engines and link previews show. opts.index lets search engines list the page
// (every other framed page asks them not to).
const framed = (title, heading, body, opts) => (opts && opts.index ? pageHtml.replace('<meta name="robots" content="noindex">\n', '') : pageHtml)
  .replace(/\{\{TITLE\}\}/g, () => esc(title)).replace(/\{\{DESC\}\}/g, () => esc((opts && opts.desc) || heading))
  .replace('{{HEADING}}', () => esc(heading)).replace('{{BODY}}', () => body);
const INVITE_BODY = `<p>Songpost is being tested by invitation. If you were given an invite code, enter it to make a song.</p>
  <form id="invite"><label class="field">Invite code<input id="invite-code" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="60"></label>
  <div class="row"><button class="btn primary" type="submit">Continue</button></div><p class="err" role="alert" id="invite-err"></p></form>
  <script>document.getElementById('invite').addEventListener('submit', async function (e) { e.preventDefault();
    var err = document.getElementById('invite-err'); err.textContent = '';
    try { var r = await fetch('/api/access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: document.getElementById('invite-code').value }) });
      if (r.ok) { location.reload(); return; } var j = await r.json().catch(function () { return {}; }); err.textContent = j.error || 'Something went wrong. Try again.'; }
    catch (x) { err.textContent = 'You seem to be offline. Check your connection and try again.'; } });</script>`;
app.get(['/', '/index.html'], (req, res, next) => {
  if (hasAccess(req)) return next();
  if (req.query.code != null) { // an invite link: remember the code on this device, then drop it from the address
    if (limits.allow(req.ip, 'access', 20) && codeMatches(req.query.code)) {
      grantAccess(res);
      const rest = new URLSearchParams(req.query); rest.delete('code');
      return res.redirect('/' + (rest.toString() ? '?' + rest.toString() : ''));
    }
  }
  res.status(403).set('Cache-Control', 'no-store').type('html').send(framed('Songpost: private preview', 'Private preview', INVITE_BODY));
});
const giftHtml = fs.readFileSync(path.join(__dirname, 'public', 'gift.html'), 'utf8');
app.get('/g/:id', (req, res) => {
  const o = db.getOrder(req.params.id);
  const live = o && o.paid && !o.removed;
  const title = live ? `${o.recipient}, ${o.sender} made you a song` : 'Songpost';
  const desc = live ? `"${shown(o).title}" - press play to hear it.` : 'Turn their story or theme into a song.';
  res.status(live ? 200 : 404).type('html').send(giftHtml.replace(/\{\{TITLE\}\}/g, esc(title)).replace(/\{\{DESC\}\}/g, esc(desc)));
});

// The page an invited person opens to add their memories to a song made together. public/join.js fills it in.
app.get('/join/:id', (req, res) => {
  const g = db.getGroup(req.params.id);
  const title = g ? `Add your memories to a song for ${g.recipient}` : 'Songpost';
  const desc = g ? `${g.organizer} is making a song for ${g.recipient} and would love your memories in it. It takes two minutes.` : 'Turn their story or theme into a song.';
  res.status(g ? 200 : 404).set('Cache-Control', 'no-store').type('html')
    .send(framed(title, title, '<div id="join"><p>Opening the invitation.</p></div><script src="/common.js"></script><script src="/join.js"></script>', { desc }));
});

/* ---------- a page for each occasion, so people searching for one can find the site ---------- */
// The words live in src/occasions.json. While the site is in private preview, search engines are asked to stay away.
const searchable = () => !cfg.accessCode;
const occasionHref = o => '/?occasion=' + encodeURIComponent(o.pick);
const usd0 = cents => '$' + (cents / 100).toFixed(2);
// Any occasion at all: the visitor types it, and the questions open with it filled in. Its spelling is checked there.
const ANY_OCCASION = `<form class="any-occasion" action="/" method="get">
    <label class="field">Don't see yours? Type any occasion
      <span class="hint">A work milestone, a team's own day, National Histology Day. Check the spelling: it appears on the record.</span>
      <input class="plain boxed" name="occasion" maxlength="40" required spellcheck="true" autocomplete="off" placeholder="Type the occasion"></label>
    <div class="row"><button class="btn primary" type="submit">Start this song</button></div></form>`;
function occasionBody(o) {
  const others = OCCASIONS.filter(x => x.slug !== o.slug).map(x => `<a href="/songs/${esc(x.slug)}">${esc(x.name)}</a>`).join(' · ');
  return `<p class="lede">${esc(o.intro)}</p>
  <p><a class="btn primary" href="${esc(occasionHref(o))}">${esc(o.button)}</a></p>
  <h2>What to tell us</h2>
  <p>A few plain sentences are all it takes. For ${esc(o.forWhat)}, these make the best songs:</p>
  <ul>${o.tell.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
  <h2>How it works</h2>
  <ul>
    <li><b>Tell us about them.</b> Answer a few short questions, typing or speaking.</li>
    <li><b>Hear it before you pay.</b> The lyrics are written and the song recorded while you wait, about five minutes in all. You listen to a ${cfg.previewSeconds}-second preview first.</li>
    <li><b>Send it.</b> They open a private page with their own gold record, your note and the lyrics. Send the link by text, WhatsApp or email.</li>
  </ul>
  <p>A Gold record is ${usd0(cfg.priceGoldCents)} and a Platinum record is ${usd0(cfg.pricePlatinumCents)}. Either comes with one free redo${cfg.redoDays > 0 ? ` within ${cfg.redoDays} days` : ''}. The lyrics and music are made with AI from the details you give.</p>
  <h2>Making it with others</h2>
  <p>${esc(o.together)} Start the song, send the invite link, and each person adds their own memories from their own phone. The song is written from everyone's answers and signed from all of you. It costs nothing extra.</p>
  <p><a class="btn primary" href="${esc(occasionHref(o))}">${esc(o.button)}</a></p>
  <h2>Songs for other occasions</h2>
  <p>${others}</p>
  ${ANY_OCCASION}`;
}
app.get('/songs', (req, res) => {
  const list = OCCASIONS.map(o => `<li><a href="/songs/${esc(o.slug)}">${esc(o.heading)}</a></li>`).join('');
  res.type('html').send(framed('Custom songs for every occasion - Songpost', 'A song for every occasion',
    `<p class="lede">Tell us about someone, and Songpost writes and records a song about them in minutes. Pick the occasion to see how it works.</p><ul>${list}</ul>
     ${ANY_OCCASION}`,
    { index: searchable(), desc: 'Custom songs for birthdays, anniversaries, weddings, retirements and more. Written and recorded from your story in minutes. Hear it before you pay.' }));
});
app.get('/songs/:slug', (req, res, next) => {
  const o = OCCASIONS.find(x => x.slug === req.params.slug);
  if (!o) return next();
  res.type('html').send(framed(o.title + ' - Songpost', o.heading, occasionBody(o), { index: searchable(), desc: o.desc }));
});
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(searchable()
    ? `User-agent: *\nDisallow: /g/\nDisallow: /join/\nDisallow: /admin\nDisallow: /api/\nDisallow: /reminders\nSitemap: ${cfg.baseUrl}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n');
});
app.get('/sitemap.xml', (req, res) => {
  const urls = ['/', '/songs'].concat(OCCASIONS.map(o => '/songs/' + o.slug));
  res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + (searchable() ? urls.map(u => `  <url><loc>${esc(cfg.baseUrl + u)}</loc></url>\n`).join('') : '') + '</urlset>\n');
});

/* ---------- stopping a reminder ---------- */
// The link in every reminder email comes here. Stopping takes a button press, so a mail scanner that
// opens links can't stop someone's reminders by accident.
app.use('/reminders', express.urlencoded({ extended: false }));
const reminderFrom = q => { const r = db.getReminder(parseInt(q.id, 10)); return r && sameText(String(q.t || ''), r.token) ? r : null; };
app.get('/reminders/off', (req, res) => {
  const r = reminderFrom(req.query);
  const body = r ? `<p>This reminder goes to ${esc(r.email)}${r.recipient ? `, and was set up when a song was made for ${esc(r.recipient)}` : ''}.</p>
    <form method="post" action="/reminders/off"><input type="hidden" name="id" value="${r.id}"><input type="hidden" name="t" value="${esc(r.token)}">
    <div class="row"><button class="btn primary" name="what" value="one">Stop this reminder</button>
    <button class="btn" name="what" value="all">Stop every Songpost reminder to this address</button></div></form>`
    : '<p>This reminder has already been stopped, or the link is incomplete. No more of these will be sent.</p>';
  res.set('Cache-Control', 'no-store').type('html').send(framed('Stop a reminder - Songpost', 'Stop a reminder', body));
});
app.post('/reminders/off', (req, res) => {
  const r = reminderFrom(req.body || {});
  if (r) { if (req.body.what === 'all') db.removeRemindersFor(r.email); else db.removeReminder(r.id); }
  res.set('Cache-Control', 'no-store').type('html').send(framed('Reminder stopped - Songpost', 'Reminder stopped',
    `<p>${r && req.body.what === 'all' ? 'You will get no more reminders from Songpost.' : 'You will not get this reminder again.'}</p><p><a href="/">Back to Songpost</a></p>`));
});

// The policy pages. Their text lives in src/legal.json and is a draft until a lawyer signs it off.
for (const slug of Object.keys(LEGAL)) {
  app.get('/' + slug, (req, res) => {
    const doc = LEGAL[slug];
    res.type('html').send(framed(doc.title + ' - Songpost', doc.title, doc.html.replace(/\{\{SUPPORT\}\}/g, () => esc(cfg.supportEmail))));
  });
}

/* ---------- admin ---------- */
// The admin key. Ten wrong tries from one address lock that address out for an hour, so the key can't be guessed by trying.
function adminOk(req) {
  if (!cfg.adminKey) return false;
  if (db.countEvents('admin-miss', 3600 * 1000, req.ip) >= 10) return false;
  const given = String(req.query.key || (req.body && req.body.key) || '');
  if (given && sameText(given, cfg.adminKey)) return true;
  if (given) db.addEvent(req.ip, 'admin-miss');
  return false;
}
app.use('/admin', express.urlencoded({ extended: false }));
// Example songs. One made on this site is added by its order; one made elsewhere is uploaded as an audio file.
app.post('/admin/sample', (req, res) => {
  if (!adminOk(req)) return res.status(404).end();
  const o = db.getOrder(String(req.body.id || ''));
  if (o && o.paid && !o.removed && o.takes[o.chosen] && !db.listSamples().some(s => s.order_id === o.id)) {
    db.addSample({ created_at: Date.now(), title: label(req.body.title, 80), caption: label(req.body.caption, 200) || FOUNDER_LINE, order_id: o.id });
  }
  res.redirect('/admin?key=' + encodeURIComponent(cfg.adminKey) + '#examples');
});
app.post('/admin/sample-remove', (req, res) => {
  if (!adminOk(req)) return res.status(404).end();
  db.removeSample(parseInt(req.body.id, 10));
  res.redirect('/admin?key=' + encodeURIComponent(cfg.adminKey) + '#examples');
});
// What kind of audio file this is, from its first bytes. Anything else is turned away.
function audioKind(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.toString('latin1', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { ext: 'mp3', mime: 'audio/mpeg' };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') return { ext: 'wav', mime: 'audio/wav' };
  if (buf.toString('latin1', 4, 8) === 'ftyp') return { ext: 'm4a', mime: 'audio/mp4' };
  return null;
}
// The admin page sends the file itself as the body of the request, with its title and caption in the address.
app.post('/admin/sample-upload', express.raw({ type: () => true, limit: '25mb' }), (req, res) => {
  if (!adminOk(req)) return res.status(404).end();
  const kind = audioKind(req.body), title = label(req.query.title, 80);
  if (!kind) return res.status(400).json({ error: 'That file is not an MP3, M4A or WAV recording.' });
  if (!title) return res.status(400).json({ error: 'Give the song a title.' });
  const id = db.addSample({ created_at: Date.now(), title, caption: label(req.query.caption, 200) || FOUNDER_LINE, mime: kind.mime, outside: req.query.outside === '0' ? 0 : 1 });
  const file = `sample-${id}.${kind.ext}`;
  fs.writeFileSync(path.join(db.mediaDir, file), req.body);
  db.setSampleFile(id, file);
  res.json({ ok: true });
});
app.post('/admin/remove', (req, res) => {
  if (!adminOk(req)) return res.status(404).end();
  db.updateOrder(String(req.body.id || ''), { removed: req.body.restore ? false : true });
  res.redirect('/admin?key=' + encodeURIComponent(cfg.adminKey));
});
// Deletes a song for good: its audio, its details, its replies, reports and messages. For privacy requests.
app.post('/admin/delete', (req, res) => {
  if (!adminOk(req)) return res.status(404).end();
  db.deleteOrder(String(req.body.id || ''));
  res.redirect('/admin?key=' + encodeURIComponent(cfg.adminKey));
});
// Shows a recipient's reply on the site as a testimonial, or takes it off again. Only replies marked "may be shared".
app.post('/admin/feature', (req, res) => {
  if (!adminOk(req)) return res.status(404).end();
  db.setReplyFeatured(parseInt(req.body.id, 10), !req.body.off);
  res.redirect('/admin?key=' + encodeURIComponent(cfg.adminKey));
});
// Partners: a shop, planner or other business that sends buyers through its own link, /?ref=<code>.
app.post('/admin/partner', (req, res) => {
  if (!adminOk(req)) return res.status(404).end();
  const name = clip(req.body.name, 60);
  const slug = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  let code = slug(req.body.code) || slug(name);
  if (name && code) {
    const base = code; let n = 1;
    while (db.partnerCodeTaken(code)) code = `${base}-${++n}`; // a code that is taken, or ever was, gets a number
    db.addPartner(code, name, clip(req.body.note, 120));
  }
  res.redirect('/admin?key=' + encodeURIComponent(cfg.adminKey) + '#partners');
});
// Takes a partner off the list. Their link stops counting; sales already counted stay in the totals.
app.post('/admin/partner-remove', (req, res) => {
  if (!adminOk(req)) return res.status(404).end();
  db.removePartner(String(req.body.code || ''));
  res.redirect('/admin?key=' + encodeURIComponent(cfg.adminKey) + '#partners');
});
/* ---------- is everything working? ---------- */
// One line per outside service: is it connected, and did it work the last time it was used.
// "failing" means three or more failures in a row with no success since.
function healthReport() {
  const h = db.healthAll();
  const connected = { claude: !!cfg.anthropicKey, music: cfg.musicEngine === 'mock' || (cfg.musicEngine === 'elevenlabs' ? !!cfg.elevenKey : !!cfg.sunoapiKey),
    stripe: !!stripe, messages: notify.live() };
  const names = { claude: 'Claude (lyrics, suggestions, content check)', music: `Music engine (${cfg.musicEngine})`, stripe: 'Stripe (payments)', messages: 'Email and text messages' };
  return Object.keys(names).map(key => {
    const r = h[key] || {};
    const state = !connected[key] ? 'off' : (r.fails_in_row >= 3 && (r.last_err_at || 0) > (r.last_ok_at || 0)) ? 'failing' : r.last_ok_at ? 'ok' : r.last_err_at ? 'trouble' : 'idle';
    return { key, name: names[key], state, lastOk: r.last_ok_at || null, lastErr: r.last_err_at || null, error: r.last_err || '', failsInRow: r.fails_in_row || 0 };
  });
}
// For an outside uptime monitor: answers 200 while everything connected is working and 503 when something is failing.
// It says which service, never why, and gives away nothing private.
app.get('/health', (req, res) => {
  const report = healthReport(), failing = report.filter(s => s.state === 'failing').map(s => s.key);
  res.status(failing.length ? 503 : 200).set('Cache-Control', 'no-store').json({ ok: !failing.length, failing, services: Object.fromEntries(report.map(s => [s.key, s.state])) });
});

// Costs and earnings for the admin page, worked out from what the site has counted and the prices in the settings.
function money(sinceDay) {
  const u = db.usageTotals(sinceDay), get = k => u[k] || { n: 0, amount: 0 };
  const recordings = get('rec_take').n + get('rec_redo').n + get('rec_second').n;
  const minutes = (get('rec_take').amount + get('rec_redo').amount + get('rec_second').amount) / 60;
  const music = minutes * cfg.costMusicPerMinute;
  const claude = get('claude_in').amount / 1e6 * cfg.costClaudeInPerMTok + get('claude_out').amount / 1e6 * cfg.costClaudeOutPerMTok;
  const sales = get('sale').n, revenue = get('sale').amount / 100;
  const fees = revenue * cfg.cardFeePercent / 100 + sales * cfg.cardFeeFixedCents / 100;
  const started = get('song_started').n, practice = get('sale_practice').n;
  return { started, recordings, minutes, music, claudeCalls: get('claude_in').n, claude, sales, revenue, fees, practice,
    costs: music + claude + fees, left: revenue - music - claude - fees,
    perStarted: started ? (music + claude) / started : null, perSale: sales ? (music + claude + fees) / sales : null,
    buyRate: started ? (sales + practice) / started : null };
}
app.get('/admin', (req, res) => {
  if (!adminOk(req)) return res.status(404).end();
  const key = esc(cfg.adminKey), when = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  const orders = db.listOrders(), totals = db.totals(), f = db.funnelTotals(30);
  // Costs and earnings: a few headline figures for the last 30 days, then the detail by period.
  const dayAgo = d => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
  const periods = [['Today', money(dayAgo(0))], ['Last 7 days', money(dayAgo(6))], ['Last 30 days', money(dayAgo(29))], ['Since counting began', money(null)]];
  const m30 = periods[2][1], usd = x => (x < 0 ? '-' : '') + '$' + Math.abs(x).toFixed(2), opt = (x, fn) => (x == null ? 'n/a' : fn(x));
  const moneyRow = (label, fn) => `<tr><td>${label}</td>${periods.map(([, m]) => `<td class="num">${fn(m)}</td>`).join('')}</tr>`;
  const tile = (label, value, note) => `<div class="tile"><div class="t-label">${label}</div><div class="t-value">${value}</div><div class="t-note">${note}</div></div>`;
  const costs = `<h2>Costs and earnings</h2>
    <div class="hero"><div class="t-label">Left after costs, last 30 days</div><div class="hero-value">${usd(m30.left)}</div>
      <div class="t-note">${usd(m30.revenue)} taken in, less ${usd(m30.costs)} for music, lyrics and card fees. Before the fixed costs of about ${usd(cfg.monthlyFixedCosts)} a month.</div></div>
    <div class="tiles">
      ${tile('Music and lyrics, last 30 days', usd(m30.music + m30.claude), `${m30.recordings} recordings, ${m30.minutes.toFixed(1)} minutes of music`)}
      ${tile('Cost per song started', opt(m30.perStarted, usd), 'Music and lyrics, whether or not it sold')}
      ${tile('Cost per sale', opt(m30.perSale, usd), 'Music, lyrics and card fees, spread over real sales')}
      ${tile('Songs that were unlocked', opt(m30.buyRate, x => Math.round(x * 100) + '%'), `${m30.sales} paid${m30.practice ? `, ${m30.practice} practice` : ''}, of ${m30.started} started`)}
    </div>
    <div class="wrap"><table class="money"><tr><th></th>${periods.map(([name]) => `<th class="num">${name}</th>`).join('')}</tr>
      ${moneyRow('Songs started', m => m.started)}
      ${moneyRow('Recordings made', m => m.recordings)}
      ${moneyRow('Minutes of music', m => m.minutes.toFixed(1))}
      ${moneyRow('Music cost', m => usd(m.music))}
      ${moneyRow('Claude requests', m => m.claudeCalls)}
      ${moneyRow('Claude cost', m => usd(m.claude))}
      ${moneyRow('Sales (real payments)', m => m.sales)}
      ${moneyRow('Money taken in', m => usd(m.revenue))}
      ${moneyRow('Card fees', m => usd(m.fees))}
      ${moneyRow('<b>Left after these costs</b>', m => `<b>${usd(m.left)}</b>`)}
      ${moneyRow('Practice unlocks (no money)', m => m.practice)}
    </table></div>
    <p>These are estimates: what the site counted, times the list prices in the settings ($${cfg.costMusicPerMinute} a minute of music, $${cfg.costClaudeInPerMTok} and $${cfg.costClaudeOutPerMTok} per million Claude tokens, ${cfg.cardFeePercent}% plus ${cfg.cardFeeFixedCents}¢ a sale).
      Check them against your ElevenLabs, Claude and Stripe accounts now and then. Refunds, advertising and the fixed monthly costs are not included.
      Counting began on ${esc(db.firstUsageDay() || 'the first song after this version went live')}; anything before that is not in these figures.</p>`;
  // How songs spread: from person to person, from partners, and what buyers say brought them.
  const d30 = dayAgo(29), u30 = db.usageTotals(d30), uAll = db.usageTotals(null);
  const cnt = (u, k) => (u[k] ? u[k].n : 0);
  const spreadRow = (label, k) => `<tr><td>${label}</td><td class="num">${cnt(u30, k)}</td><td class="num">${cnt(uAll, k)}</td></tr>`;
  const chain = db.longestChain();
  const heard30 = db.usageByPrefix('heard:', d30), heardAll = db.usageByPrefix('heard:', null);
  const heardRows = Object.keys(heardAll).sort((a, b) => heardAll[b].n - heardAll[a].n).map(k =>
    `<tr><td>${esc(k)}</td><td class="num">${heard30[k] ? heard30[k].n : 0}</td><td class="num">${heardAll[k].n}</td><td class="num">${usd(heardAll[k].amount / 100)}</td></tr>`).join('');
  const refV = db.usageByPrefix('ref_visit:', null), refS = db.usageByPrefix('ref_started:', null), refP = db.usageByPrefix('ref_sale:', null), refP30 = db.usageByPrefix('ref_sale:', d30);
  const partnerRows = db.listPartners().map(pt => { const c = pt.code, n = x => (x[c] ? x[c].n : 0);
    return `<tr><td>${esc(pt.name)}${pt.note ? `<br><span class="t-note">${esc(pt.note)}</span>` : ''}</td><td>${esc(cfg.baseUrl)}/?ref=${esc(c)}</td>
      <td class="num">${n(refV)}</td><td class="num">${n(refS)}</td><td class="num">${n(refP30)}</td><td class="num">${n(refP)}</td><td class="num">${usd((refP[c] ? refP[c].amount : 0) / 100)}</td>
      <td><form method="post" action="/admin/partner-remove" onsubmit="return confirm('Take this partner off the list? Their link will stop counting.')"><input type="hidden" name="key" value="${key}"><input type="hidden" name="code" value="${esc(c)}"><button>Remove</button></form></td></tr>`; }).join('');
  const reminders = db.listReminders(200);
  const spread = `<h2>How songs spread</h2>
    <div class="wrap"><table class="money"><tr><th></th><th class="num">Last 30 days</th><th class="num">Since counting began</th></tr>
      ${spreadRow('Visits from a gift page', 'via_gift_visit')}
      ${spreadRow('Songs started by those visitors', 'via_gift_started')}
      ${spreadRow('...and unlocked', 'via_gift_sale')}
      ${spreadRow('Invitations to make a song together', 'group_invite')}
      ${spreadRow('People who added their memories', 'group_part')}
      ${spreadRow('Songs recorded from several people', 'group_started')}
      ${spreadRow('...and unlocked', 'group_sale')}
      ${spreadRow('Visits from people who added to a group song', 'via_join_visit')}
      ${spreadRow('Songs they started of their own', 'via_join_started')}
      ${spreadRow('...and unlocked', 'via_join_sale')}
    </table></div>
    <p>${chain ? `The longest chain so far is ${chain + 1} songs in a row, each started from the one before.` : 'No song has yet led to another. When someone who was given a song, or helped make one, starts their own, it is counted here.'}
      "Unlocked" includes practice unlocks while the test checkout is on.</p>
    <h2>How buyers heard about Songpost</h2>
    <p>Asked once, after a buyer unlocks their first song. Someone who arrives from a gift page is counted as "Someone sent me a song" without being asked.</p>
    <div class="wrap"><table class="money"><tr><th>Answer</th><th class="num">Unlocked, last 30 days</th><th class="num">Unlocked, in all</th><th class="num">Money taken in</th></tr>${heardRows}</table></div>
    <h2 id="partners">Partners</h2>
    <p>Give each florist, planner or other partner their own link. Anyone who arrives by it and makes a song within 30 days is counted for that partner. Money shows real payments only.</p>
    <div class="wrap"><table><tr><th>Partner</th><th>Their link</th><th class="num">Visits</th><th class="num">Songs started</th><th class="num">Unlocked, last 30 days</th><th class="num">Unlocked, in all</th><th class="num">Money taken in</th><th></th></tr>${partnerRows}</table></div>
    <form method="post" action="/admin/partner" class="add"><input type="hidden" name="key" value="${key}">
      <label>Partner's name <input name="name" maxlength="60" required></label>
      <label>Link code (optional) <input name="code" maxlength="30" placeholder="made from the name"></label>
      <label>Note to yourself (optional) <input name="note" maxlength="120" placeholder="for example: 10% of sales"></label>
      <button>Add partner</button></form>
    <h2>Reminders people asked for</h2>
    <p>${reminders.length} set up. ${canSchedule() ? 'An email goes out a week before each date, once a year.' : '<b>Reminders are not offered to buyers yet, because no email service is connected.</b>'}</p>
    <div class="wrap"><table><tr><th>Goes to</th><th>Set up after a song for</th><th>Their date each year</th><th>Holidays too</th></tr>
    ${reminders.map(r => `<tr><td>${esc(r.email)}</td><td>${esc(r.recipient || '')}</td><td>${esc(r.month_day || '')}</td><td>${r.holidays ? 'Yes' : ''}</td></tr>`).join('')}</table></div>`;
  const steps = [['arrived', 'Arrived'], ['started', 'Started the questions'], ['lyrics', 'Got lyrics'], ['preview', 'Heard the preview'], ['clickpay', 'Clicked pay'], ['paid', 'Paid']];
  const funnel = steps.map(([k, label]) => `<tr><td>${label}</td><td>${f[k] || 0}</td></tr>`).join('');
  const cameBy = o => [o.group_id ? 'made together' : '', o.via === 'gift' ? 'from a gift page' : o.via === 'join' ? 'from a group song' : '', o.ref_code ? 'partner: ' + o.ref_code : ''].filter(Boolean).join(', ');
  const rows = orders.map(o => `<tr><td>${when(o.created_at)}</td><td>${esc(o.recipient)}</td><td>${esc(o.group_names || o.sender)}${cameBy(o) ? `<br><span class="t-note">${esc(cameBy(o))}</span>` : ''}</td><td>${esc(o.contact || '')}</td>
    <td>${esc(o.status)}${o.error ? ' (' + esc(o.error) + ')' : ''}${o.removed ? ' REMOVED' : ''}</td><td>${o.takes.length}</td>
    <td>${o.paid ? esc(tierName(o.tier)) + ' $' + (o.price_cents / 100).toFixed(2) : ''}</td>
    <td>${o.schedule_date ? esc(o.schedule_date) + (o.schedule_sent_at ? ' sent' : o.schedule_failed_at ? ' could not be delivered' : o.schedule_queued_at ? ' sending' : ' waiting') : ''}${o.redo_at ? '<br>redo used' : ''}</td>
    <td>${o.paid ? `<a href="/g/${esc(o.id)}">page</a>` : ''}</td>
    <td>${o.paid ? `<form method="post" action="/admin/remove"><input type="hidden" name="key" value="${key}"><input type="hidden" name="id" value="${esc(o.id)}">${o.removed ? '<input type="hidden" name="restore" value="1"><button>Restore</button>' : '<button>Remove</button>'}</form>` : ''}</td>
    <td><form method="post" action="/admin/delete" onsubmit="return confirm('Delete this song for good? Its audio and details cannot be brought back.')"><input type="hidden" name="key" value="${key}"><input type="hidden" name="id" value="${esc(o.id)}"><button>Delete</button></form></td></tr>`).join('');
  const replies = db.listReplies().map(r => `<tr><td>${when(r.at)}</td><td>${esc(r.recipient || '')}</td><td>${esc(r.body)}</td><td>${r.share_ok ? 'May be shared' : 'Private'}</td>
    <td>${r.share_ok ? `<form method="post" action="/admin/feature"><input type="hidden" name="key" value="${key}"><input type="hidden" name="id" value="${r.id}">${r.featured ? '<input type="hidden" name="off" value="1"><b>On the site.</b> <button>Take off the site</button>' : '<button>Show on the site</button>'}</form>` : ''}</td></tr>`).join('');
  const samples = db.listSamples(), sampleOrders = new Set(samples.map(s => s.order_id).filter(Boolean));
  const sampleRows = samples.map(s => { const src = sampleSource(s);
    return `<tr><td>${esc((src && src.title) || s.title || '')}</td><td>${esc(s.caption || '')}</td><td>${s.order_id ? 'Made on Songpost' : s.outside ? 'Uploaded: made with another tool' : 'Uploaded: made on Songpost'}${src ? `<br><span class="t-note">The page says: ${esc(src.note)}</span>` : ''}${src ? '' : '<br><b>Not showing: its song was removed.</b>'}</td>
      <td>${src ? `<audio controls preload="none" src="/sample/${s.id}"></audio>` : ''}</td>
      <td><form method="post" action="/admin/sample-remove"><input type="hidden" name="key" value="${key}"><input type="hidden" name="id" value="${s.id}"><button>Take off the page</button></form></td></tr>`; }).join('');
  const sampleChoices = orders.filter(o => o.paid && !o.removed && o.takes[o.chosen] && !sampleOrders.has(o.id))
    .map(o => `<option value="${esc(o.id)}">For ${esc(o.recipient)}: ${esc(shown(o).title)} (${when(o.created_at).slice(0, 10)})</option>`).join('');
  const examples = `<h2 id="examples">Example songs on the opening page</h2>
    <p>Up to ${MAX_SAMPLES} show under "Hear an example". Use only songs about people who have said yes. Each caption starts "${FOUNDER_LINE}", which tells visitors the song comes from the business itself without giving your name; add who it was for if you like ("..., for his wife").
      The best example is a song made on Songpost itself, because it is exactly what a customer gets; the page says it was recorded with the same music tool that will record their song. A file made with another music tool can be uploaded too; the page then says it was recorded with a different tool, so nobody is misled about how their own song will sound.</p>
    <div class="wrap"><table><tr><th>Title</th><th>Caption</th><th>Where it came from</th><th>Listen</th><th></th></tr>${sampleRows}</table></div>
    <form method="post" action="/admin/sample" class="add"><input type="hidden" name="key" value="${key}">
      <label>A song made on Songpost <select name="id" required style="display:block;font:inherit;padding:6px 8px;margin-top:3px;max-width:340px"><option value="">Choose one of your unlocked songs</option>${sampleChoices}</select></label>
      <label>Caption (add who it was for, if you like) <input name="caption" maxlength="200" style="min-width:340px" value="${FOUNDER_LINE}"></label>
      <button>Show as an example</button></form>
    <form class="add" id="sample-upload"><label>Or upload a recording (MP3, M4A or WAV) <input type="file" id="su-file" accept="audio/*,.mp3,.m4a,.wav" required></label>
      <label>Title <input id="su-title" maxlength="80" required></label>
      <label>Caption (add who it was for, if you like) <input id="su-caption" maxlength="200" style="min-width:340px" value="${FOUNDER_LINE}"></label>
      <label>Made with <select id="su-outside" style="display:block;font:inherit;padding:6px 8px;margin-top:3px"><option value="1">Another music tool</option><option value="0">Songpost</option></select></label>
      <button>Upload</button> <span id="su-note"></span></form>
    <script>document.getElementById('sample-upload').addEventListener('submit', async function (e) { e.preventDefault();
      var f = document.getElementById('su-file').files[0], note = document.getElementById('su-note'); if (!f) return;
      if (f.size > 24 * 1024 * 1024) { note.textContent = 'That file is over 24 MB. Use an MP3.'; return; }
      note.textContent = 'Uploading...';
      var q = new URLSearchParams({ key: ${JSON.stringify(cfg.adminKey).replace(/</g, '\\u003c')}, title: document.getElementById('su-title').value, caption: document.getElementById('su-caption').value, outside: document.getElementById('su-outside').value });
      try { var r = await fetch('/admin/sample-upload?' + q.toString(), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: f });
        if (r.ok) { location.hash = 'examples'; location.reload(); return; } var j = await r.json().catch(function () { return {}; }); note.textContent = j.error || 'The upload did not work. Try again.'; }
      catch (x) { note.textContent = 'The upload did not work. Check your connection and try again.'; } });</script>`;
  const reports = db.listReports().map(r => `<tr><td>${when(r.at)}</td><td><a href="/g/${esc(r.order_id)}">${esc(r.order_id)}</a></td><td>${esc(r.body)}</td></tr>`).join('');
  const outbox = db.listOutbox().map(m => `<tr><td>${when(m.created_at)}</td><td>${esc(m.to_contact)}</td><td>${esc(m.subject)}</td><td><pre>${esc(m.body)}</pre></td><td>${m.sent_at ? 'Sent' : m.failed_at ? (m.attempts ? 'Failed after ' + m.attempts + ' tries' : 'Not sent: texts are not connected') : m.attempts ? 'Will try again (' + m.attempts + ' so far)' : 'Not sent'}</td></tr>`).join('');
  res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Songpost admin</title>
    <style>body{font:15px system-ui;margin:24px}table{border-collapse:collapse;width:100%;margin-bottom:28px}td,th{border-bottom:1px solid #ccd;padding:6px 10px;text-align:left;vertical-align:top}.wrap{overflow-x:auto}pre{margin:0;white-space:pre-wrap;font:inherit}h2{margin-top:32px}
    .num{text-align:right;font-variant-numeric:tabular-nums}.money td:first-child{width:38%}
    .hero{margin:6px 0 18px}.hero-value{font-size:52px;font-weight:600;line-height:1.1}
    .tiles{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 22px}.tile{flex:1;min-width:190px;border:1px solid #ccd;border-radius:6px;padding:12px 14px}
    .t-label{font-size:13px;color:#445}.t-value{font-size:26px;font-weight:600;margin:2px 0}.t-note{font-size:13px;color:#556}
    .add{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:end;margin:0 0 28px}.add label{display:block;font-size:13px;color:#445}.add input{display:block;font:inherit;padding:6px 8px;margin-top:3px;min-width:200px}.add button{font:inherit;padding:7px 14px}</style>
    <h1>Songpost admin</h1>
    <p>${totals.songs} songs recorded, ${totals.paid} paid, $${(totals.cents / 100).toFixed(2)} in sales. Engine: ${esc(cfg.musicEngine)}. Messages: ${notify.live() ? 'being sent' : 'NOT being sent (no provider connected)'}.
    Private preview: ${cfg.accessCode ? 'ON (an invite code is needed to make a song)' : 'off (anyone can make a song)'}.</p>
    <p>The site sees you as visiting from <b>${esc(req.ip)}</b>. Every visitor should show their own address here. If two people on different networks see the same one, the free-preview limit is being shared: raise TRUST_PROXY by one.</p>
    <h2>Is everything working?</h2>
    <div class="wrap"><table><tr><th>Service</th><th>Now</th><th>Last worked (UTC)</th><th>Last problem (UTC)</th><th>What went wrong</th></tr>
    ${healthReport().map(s => `<tr><td>${esc(s.name)}</td><td>${{ ok: 'Working', failing: '<b>FAILING</b>', trouble: 'Had a problem, no success yet', idle: 'Connected, not used yet', off: 'Not connected' }[s.state]}</td>
      <td>${s.lastOk ? when(s.lastOk) : ''}</td><td>${s.lastErr ? when(s.lastErr) + (s.failsInRow > 1 ? ` (${s.failsInRow} in a row)` : '') : ''}</td><td>${esc(s.lastErr && (!s.lastOk || s.lastErr > s.lastOk) ? s.error : '')}</td></tr>`).join('')}
    </table></div>
    <p>This shows what happened the last time each service was used. To be told when something breaks, point a free uptime monitor at <b>${esc(cfg.baseUrl)}/health</b>: it answers "ok" while everything works and an error when a service has failed three times in a row.</p>
    ${costs}
    ${spread}
    <h2>Where visitors drop off (last 30 days)</h2><div class="wrap"><table><tr><th>Step</th><th>People</th></tr>${funnel}</table></div>
    ${examples}
    <h2>Songs</h2><p>The ${orders.length} most recent. Remove takes a paid song's page down and can be undone. Delete erases a song and everything about it.</p><div class="wrap"><table><tr><th>When (UTC)</th><th>For</th><th>From</th><th>Contact</th><th>Status</th><th>Takes</th><th>Paid</th><th>Send date</th><th></th><th></th><th></th></tr>${rows}</table></div>
    <h2>Reports</h2><div class="wrap"><table><tr><th>When</th><th>Song</th><th>What they said</th></tr>${reports}</table></div>
    <h2>Replies from recipients</h2><p>These are your testimonials. A reply marked "May be shared" can be shown on the site with one click: it appears beside the pay button, and the newest one on the opening page, signed with the person's first name. Up to three show at once. Private replies can never be shown.</p><div class="wrap"><table><tr><th>When</th><th>From</th><th>Words</th><th>Sharing</th><th>Testimonial</th></tr>${replies}</table></div>
    <h2>Messages</h2><div class="wrap"><table><tr><th>When</th><th>To</th><th>Subject</th><th>Body</th><th>Status</th></tr>${outbox}</table></div>`);
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

/* ---------- errors ---------- */
app.use((err, req, res, next) => {
  if (err instanceof PublicError) return res.status(err.status).json({ error: err.publicMessage });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'That is too much text. Shorten it and try again.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
});

/* ---------- timers ---------- */
// Songs scheduled for a date go out once that day reaches the send hour.
function sendDue() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - cfg.sendHourUtc * 3600 * 1000).toISOString().slice(0, 10); // today, once the send hour has passed
  for (const o of db.dueSchedules(cutoff)) {
    db.updateOrder(o.id, { schedule_queued_at: Date.now() }); // queued once; delivery and retries are the outbox's job
    notify.send(o.id, o.schedule_to, `${o.sender} made you a song`, `${o.recipient}, ${o.sender} made you a song. Press play: ${giftUrl(o.id)}`, 'schedule');
  }
}
// A scheduled song counts as sent only once its message has really gone out. The sender hears either way.
notify.hooks.delivered = row => {
  if (row.tag !== 'schedule') return;
  const o = db.getOrder(row.order_id);
  if (!o || o.schedule_sent_at) return;
  db.updateOrder(o.id, { schedule_sent_at: Date.now() });
  notify.send(o.id, o.contact, `Your song for ${o.recipient} was sent`, `We sent your song to ${o.schedule_to} today.\n${giftUrl(o.id)}`);
};
notify.hooks.failed = row => {
  if (row.tag !== 'schedule') return;
  const o = db.getOrder(row.order_id);
  if (!o || o.schedule_sent_at) return;
  db.updateOrder(o.id, { schedule_failed_at: Date.now() });
  notify.send(o.id, o.contact, `We couldn't send your song to ${o.schedule_to}`,
    `We tried to send your song for ${o.recipient} to ${o.schedule_to} and it didn't go through. Check the address or number and pick a new date here:\n${cfg.baseUrl}/?order=${o.id}&key=${o.key}\n\nOr send them the link yourself: ${giftUrl(o.id)}`);
};
// Reminders people asked for: an email a week before their own date, and before each gift holiday if they ticked that.
// Dates are for the United States. Mother's Day is the second Sunday of May, Father's Day the third Sunday of June.
const two = n => String(n).padStart(2, '0');
const nthSunday = (year, month, n) => (7 - new Date(Date.UTC(year, month, 1)).getUTCDay()) % 7 + 1 + (n - 1) * 7;
const holidays = year => [
  { key: 'valentines', name: "Valentine's Day", date: `${year}-02-14` },
  { key: 'mothers', name: "Mother's Day", date: `${year}-05-${two(nthSunday(year, 4, 2))}` },
  { key: 'fathers', name: "Father's Day", date: `${year}-06-${two(nthSunday(year, 5, 3))}` },
  { key: 'christmas', name: 'Christmas', date: `${year}-12-25` },
];
const REMIND_DAYS_AHEAD = 7;  // how long before the day the email goes
const REMIND_QUIET_DAYS = 14; // a reminder set up this close to its day waits for next year: the song they just made was for it
function sendReminders() {
  if (!canSchedule() || new Date().getUTCHours() < cfg.sendHourUtc) return;
  const today = new Date().toISOString().slice(0, 10), year = Number(today.slice(0, 4));
  const days = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
  const nice = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  // Someone with reminders on several songs gets one email per holiday, and one per date, not one per song.
  const all = db.listReminders().map(r => { let sent = []; try { sent = JSON.parse(r.sent_json) || []; } catch (e) { /* start again */ } return Object.assign(r, { sent }); });
  const told = new Set();
  for (const r of all) for (const k of r.sent) told.add(`${r.email.toLowerCase()}|${k}|${/-day$/.test(k) ? r.month_day : ''}`);
  for (const r of all) {
    const sent = r.sent;
    const made = new Date(r.created_at).toISOString().slice(0, 10), before = sent.length;
    const events = [];
    for (const y of [year, year + 1]) {
      if (r.month_day) events.push({ key: `${y}-day`, date: `${y}-${r.month_day}` });
      if (r.holidays) for (const h of holidays(y)) events.push({ key: `${y}-${h.key}`, date: h.date, name: h.name });
    }
    for (const e of events) {
      const left = days(today, e.date);
      if (!(left >= 1 && left <= REMIND_DAYS_AHEAD) || sent.includes(e.key)) continue;
      sent.push(e.key);
      const once = `${r.email.toLowerCase()}|${e.key}|${e.name ? '' : r.month_day}`;
      if (told.has(once)) continue;
      if (days(made, e.date) - REMIND_DAYS_AHEAD < REMIND_QUIET_DAYS) continue;
      told.add(once);
      const stop = `${cfg.baseUrl}/reminders/off?id=${r.id}&t=${r.token}`;
      const subject = e.name ? `${e.name} is on ${nice(e.date)}` : `A reminder you asked for: ${nice(e.date)}`;
      const lead = e.name ? `You asked Songpost to remind you before ${e.name}. This year it is on ${nice(e.date)}.`
        : `You asked Songpost to remind you about ${nice(e.date)}, the date you saved when you made a song${r.recipient ? ' for ' + r.recipient : ''}.`;
      notify.send(r.order_id, r.email, subject,
        `${lead}\n\nA song takes about five minutes to make, and you hear it before you pay:\n${cfg.baseUrl}/${e.name ? '?occasion=' + encodeURIComponent(e.name) : ''}\n\nTo stop this reminder: ${stop}${cfg.mailFooter ? '\n\n' + cfg.mailFooter : ''}`, 'reminder');
    }
    if (sent.length !== before) db.markReminderSent(r.id, sent);
  }
}
// Housekeeping: old rate-limit entries, the audio of previews nobody paid for, and invitations that never became a song.
function cleanUp() {
  db.pruneEvents();
  db.pruneGroups(Date.now() - 60 * DAY);
  if (cfg.unpaidKeepDays > 0) for (const o of db.staleUnpaid(Date.now() - cfg.unpaidKeepDays * DAY)) db.expireUnpaid(o.id);
}
setInterval(sendDue, 60 * 1000).unref();
setInterval(sendReminders, 15 * 60 * 1000).unref();
setInterval(() => notify.retryPending().catch(e => console.error('Message retry crashed:', e)), 60 * 1000).unref();
setInterval(cleanUp, 6 * 3600 * 1000).unref();

recoverInterrupted();

app.listen(cfg.port, () => {
  console.log(`Songpost running at ${cfg.baseUrl} (port ${cfg.port}), music engine: ${cfg.musicEngine}`);
  if (!cfg.anthropicKey) console.warn(cfg.devMocks ? 'DEV: using practice lyrics (no ANTHROPIC_API_KEY).' : 'WARNING: ANTHROPIC_API_KEY is not set. Lyric writing is off.');
  if (!stripe) console.warn(testCheckout ? 'DEV: test checkout is on. Songs unlock without payment.' : 'WARNING: STRIPE_SECRET_KEY is not set. Checkout is off.');
  if (stripe && !cfg.stripeWebhookSecret) console.warn('WARNING: STRIPE_WEBHOOK_SECRET is not set. Payments are only confirmed when the buyer returns to the site.');
  if (!notify.live()) console.warn('WARNING: no message provider is connected. Links, receipts and notices are queued but NOT sent, and "Send it for me on a date" is not offered. See src/notify.js.');
  if (cfg.musicEngine === 'sunoapi') console.warn('WARNING: the music engine is an unofficial Suno reseller. Checkout is off unless ALLOW_UNOFFICIAL_ENGINE=1.');
  if (cfg.devMocks) console.warn('DEV_MOCKS is on. Do not use this setting on the live site.');
  if (cfg.accessCode) console.log('Private preview is ON: an invite code is needed to make a song.');
  else if (testCheckout && !/localhost|127\.0\.0\.1/.test(cfg.baseUrl)) console.warn('WARNING: test checkout is on and there is no ACCESS_CODE. Anyone who finds this address can record songs for free.');
  sendDue();
  sendReminders();
  cleanUp();
});
module.exports = { sendDue, sendReminders, cleanUp };
