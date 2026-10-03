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
const { writeLyrics, reviewContent } = require('./src/lyrics');
const { startGeneration, recoverInterrupted } = require('./src/jobs');
const { getEngine } = require('./src/engines');
const LEGAL = require('./src/legal.json');

const stripe = cfg.stripeKey ? require('stripe')(cfg.stripeKey) : null;
const testCheckout = !stripe && cfg.devMocks;

const app = express();
app.set('trust proxy', cfg.trustProxy);
app.disable('x-powered-by');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
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
  notify.send(id, o.contact, `Your song for ${o.recipient} is ready to send`,
    `Thank you. Your ${tierName(t)} record for ${o.recipient} is unlocked.\n\nSend them this link: ${giftUrl(id)}\n\nManage it here: ${cfg.baseUrl}/?order=${id}&key=${o.key}\n\nRedo and refund policy: ${cfg.baseUrl}/refunds`);
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
    .map(p => ({ q: clip(p && p.q, 120), a: clip(p && p.a, 600) })).filter(p => p.q && p.a);
  const brief = {
    recipient: clip(b.recipient, 40), sender: clip(b.sender, 40), relationship: clip(b.relationship, 40),
    occasion: clip(b.occasion, 40) || 'Just because', tone: clip(b.tone, 60) || 'Heartfelt',
    genre: clip(b.genre, 60) || 'Acoustic folk', voice: clip(b.voice, 40) || 'No preference',
    language: clip(b.language, 30) || 'English', sayName: clip(b.sayName, 40), inspiration: clip(b.inspiration, 120),
    contact: clip(b.contact, 120), answers,
  };
  if (!brief.recipient) throw new PublicError('Add their name so the song can use it.');
  if (!brief.sender) throw new PublicError("Add your name so they know who it's from.");
  if (answers.map(p => p.a).join(' ').length < 20) throw new PublicError('Answer at least one question, in a sentence or two.');
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
    recipient: o.recipient, sender: o.sender, occasion: o.occasion, genre: o.genre, tone: o.tone, title: o.title, lyrics: o.lyrics,
    note: o.note || '', sayName: o.say_name || '', contactKind: contactKind(o.contact),
    takes: o.takes.map((t, i) => ({ n: i, title: t.title, duration: t.duration, previewSection: t.previewSection || null })), chosen: o.chosen,
    takesLeft: Math.max(0, cfg.takesPerOrder - o.attempts), previewSeconds: cfg.previewSeconds,
    estimateSeconds: estimateSeconds(),
    elapsedSeconds: o.status === 'generating' && o.gen_started_at ? Math.max(0, Math.round((Date.now() - o.gen_started_at) / 1000)) : 0,
    giftUrl: o.paid ? giftUrl(o.id) : null, schedule: scheduleView(o),
    // after payment: which recording is under way, the free redo, and a Platinum second take still owed
    kind: o.status === 'generating' ? (o.gen_kind || 'take') : null, redo: redoView(o),
    secondTakeMissing: !!(o.paid && o.tier === 'platinum' && o.takes.length < 2 && o.status !== 'generating'),
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

/* ---------- public API ---------- */
app.get('/api/config', (req, res) => {
  res.json({ priceGoldCents: cfg.priceGoldCents, pricePlatinumCents: cfg.pricePlatinumCents, previewSeconds: cfg.previewSeconds,
    takesPerOrder: cfg.takesPerOrder, testCheckout, messaging: notify.live(), scheduling: canSchedule(), redoDays: cfg.redoDays,
    lyricsEstimateSeconds: lyricsEstimateSeconds() });
});

// The moments we count to see where visitors drop off. "paid" is counted on the server.
const TRACKED = ['arrived', 'started', 'lyrics', 'preview', 'clickpay'];
app.post('/api/track', (req, res) => {
  const kind = String(req.body && req.body.kind || '');
  if (TRACKED.includes(kind) && limits.allow(req.ip, 'track', 60)) db.bumpFunnel(kind);
  res.json({ ok: true });
});

// 1. Write the lyrics (free).
app.post('/api/lyrics', wrap(async (req, res) => {
  requireAccess(req);
  const brief = cleanBrief(req.body.brief);
  limits.checkLyrics(req.ip);
  const started = Date.now();
  const out = await writeLyrics(brief, clip(req.body.again, 80) || null);
  lyricTimes.push(Math.max(1, Math.round((Date.now() - started) / 1000)));
  if (lyricTimes.length > 20) lyricTimes.shift();
  res.json(out);
}));

// 2. Record the song. Costs us money, so it needs a contact and is rate limited.
app.post('/api/orders', wrap(async (req, res) => {
  requireAccess(req);
  const brief = cleanBrief(req.body.brief);
  if (!contactKind(brief.contact)) throw new PublicError('Add your email or mobile number so we can send you the link to your song.');
  const lyrics = clip(req.body.lyrics, 4500);
  if (lyrics.length < 40) throw new PublicError('The song needs lyrics before it can be recorded.');
  const title = clip(req.body.title, 80) || `A Song for ${brief.recipient}`;
  getEngine(); // fail early if the engine name is wrong
  limits.peekSong(req.ip); // refuse before doing any work if today's free previews are used up
  // The customer may have rewritten the lyrics, so they are checked against the content rules before recording.
  await reviewContent({ title, lyrics });
  const id = newId(9);
  const order = {
    id, key: newId(18), created_at: Date.now(), status: 'generating', price_cents: cfg.priceGoldCents,
    gen_kind: 'take', gen_event_id: limits.checkSong(req.ip, id),
    recipient: brief.recipient, sender: brief.sender, relationship: brief.relationship, occasion: brief.occasion,
    tone: brief.tone, genre: brief.genre, voice: brief.voice,
    details: brief.answers.map(p => `${p.q} ${p.a}`).join('\n'),
    title, lyrics,
    style: clip(req.body.style, 600) || `${brief.genre}, warm, clear lead vocal`,
    note: '', attempts: 1, ip: req.ip, language: brief.language, say_name: brief.sayName, contact: brief.contact, gen_started_at: Date.now(),
  };
  db.createOrder(order);
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
  const lyrics = clip(req.body.lyrics, 4500), title = clip(req.body.title, 80);
  if (lyrics.length >= 40) patch.lyrics = lyrics;
  if (title) patch.title = title;
  let now = o;
  if ((patch.lyrics && patch.lyrics !== o.lyrics) || (patch.title && patch.title !== o.title)) {
    await reviewContent({ title: patch.title || o.title, lyrics: patch.lyrics || o.lyrics });
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
  const session = await stripe.checkout.sessions.create(params);
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
  res.json({ id: o.id, paid: o.paid, paidAt: o.paid_at || null, tier: o.tier || 'gold', recipient: o.recipient, sender: o.sender, title: shown(o).title,
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + 'T00:00:00Z'))) throw new PublicError('Pick the date to send it.');
  // The customer's "today" can be a day behind the server's (UTC) date, so yesterday in UTC is still allowed.
  if (date < new Date(Date.now() - DAY).toISOString().slice(0, 10)) throw new PublicError('Pick today or a later date.');
  db.updateOrder(o.id, { schedule_to: to, schedule_date: date, schedule_queued_at: null, schedule_failed_at: null });
  res.json({ schedule: scheduleView(db.getOrder(o.id)) });
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
    title: words.title, lyrics: words.lyrics, note: o.note || '', paidAt: o.paid_at, audioUrl: `/media/${o.id}` };
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

/* ---------- pages ---------- */
const pageHtml = fs.readFileSync(path.join(__dirname, 'src', 'page.html'), 'utf8');
// The policy-page frame, filled in. body is trusted HTML written in this file or in legal.json.
const framed = (title, heading, body) => pageHtml.replace(/\{\{TITLE\}\}/g, () => esc(title)).replace(/\{\{DESC\}\}/g, () => esc(heading))
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
  const desc = live ? `"${shown(o).title}" - press play to hear it.` : 'Turn their story into a song.';
  res.status(live ? 200 : 404).type('html').send(giftHtml.replace(/\{\{TITLE\}\}/g, esc(title)).replace(/\{\{DESC\}\}/g, esc(desc)));
});

// The policy pages. Their text lives in src/legal.json and is a draft until a lawyer signs it off.
for (const slug of Object.keys(LEGAL)) {
  app.get('/' + slug, (req, res) => {
    const doc = LEGAL[slug];
    res.type('html').send(framed(doc.title + ' - Songpost', doc.title, doc.html.replace(/\{\{SUPPORT\}\}/g, () => esc(cfg.supportEmail))));
  });
}

/* ---------- admin ---------- */
const adminOk = req => cfg.adminKey && (req.query.key === cfg.adminKey || (req.body && req.body.key === cfg.adminKey));
app.use('/admin', express.urlencoded({ extended: false }));
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
app.get('/admin', (req, res) => {
  if (!adminOk(req)) return res.status(404).end();
  const key = esc(cfg.adminKey), when = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  const orders = db.listOrders(), totals = db.totals(), f = db.funnelTotals(30);
  const steps = [['arrived', 'Arrived'], ['started', 'Started the questions'], ['lyrics', 'Got lyrics'], ['preview', 'Heard the preview'], ['clickpay', 'Clicked pay'], ['paid', 'Paid']];
  const funnel = steps.map(([k, label]) => `<tr><td>${label}</td><td>${f[k] || 0}</td></tr>`).join('');
  const rows = orders.map(o => `<tr><td>${when(o.created_at)}</td><td>${esc(o.recipient)}</td><td>${esc(o.sender)}</td><td>${esc(o.contact || '')}</td>
    <td>${esc(o.status)}${o.error ? ' (' + esc(o.error) + ')' : ''}${o.removed ? ' REMOVED' : ''}</td><td>${o.takes.length}</td>
    <td>${o.paid ? esc(tierName(o.tier)) + ' $' + (o.price_cents / 100).toFixed(2) : ''}</td>
    <td>${o.schedule_date ? esc(o.schedule_date) + (o.schedule_sent_at ? ' sent' : o.schedule_failed_at ? ' could not be delivered' : o.schedule_queued_at ? ' sending' : ' waiting') : ''}${o.redo_at ? '<br>redo used' : ''}</td>
    <td>${o.paid ? `<a href="/g/${esc(o.id)}">page</a>` : ''}</td>
    <td>${o.paid ? `<form method="post" action="/admin/remove"><input type="hidden" name="key" value="${key}"><input type="hidden" name="id" value="${esc(o.id)}">${o.removed ? '<input type="hidden" name="restore" value="1"><button>Restore</button>' : '<button>Remove</button>'}</form>` : ''}</td>
    <td><form method="post" action="/admin/delete" onsubmit="return confirm('Delete this song for good? Its audio and details cannot be brought back.')"><input type="hidden" name="key" value="${key}"><input type="hidden" name="id" value="${esc(o.id)}"><button>Delete</button></form></td></tr>`).join('');
  const replies = db.listReplies().map(r => `<tr><td>${when(r.at)}</td><td>${esc(r.order_id)}</td><td>${esc(r.body)}</td><td>${r.share_ok ? 'May be shared' : 'Private'}</td></tr>`).join('');
  const reports = db.listReports().map(r => `<tr><td>${when(r.at)}</td><td><a href="/g/${esc(r.order_id)}">${esc(r.order_id)}</a></td><td>${esc(r.body)}</td></tr>`).join('');
  const outbox = db.listOutbox().map(m => `<tr><td>${when(m.created_at)}</td><td>${esc(m.to_contact)}</td><td>${esc(m.subject)}</td><td><pre>${esc(m.body)}</pre></td><td>${m.sent_at ? 'Sent' : m.failed_at ? 'Failed after ' + m.attempts + ' tries' : m.attempts ? 'Will try again (' + m.attempts + ' so far)' : 'Not sent'}</td></tr>`).join('');
  res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Songpost admin</title>
    <style>body{font:15px system-ui;margin:24px}table{border-collapse:collapse;width:100%;margin-bottom:28px}td,th{border-bottom:1px solid #ccd;padding:6px 10px;text-align:left;vertical-align:top}.wrap{overflow-x:auto}pre{margin:0;white-space:pre-wrap;font:inherit}h2{margin-top:32px}</style>
    <h1>Songpost admin</h1>
    <p>${totals.songs} songs recorded, ${totals.paid} paid, $${(totals.cents / 100).toFixed(2)} in sales. Engine: ${esc(cfg.musicEngine)}. Messages: ${notify.live() ? 'being sent' : 'NOT being sent (no provider connected)'}.
    Private preview: ${cfg.accessCode ? 'ON (an invite code is needed to make a song)' : 'off (anyone can make a song)'}.</p>
    <p>The site sees you as visiting from <b>${esc(req.ip)}</b>. Every visitor should show their own address here. If two people on different networks see the same one, the free-preview limit is being shared: raise TRUST_PROXY by one.</p>
    <h2>Where visitors drop off (last 30 days)</h2><div class="wrap"><table><tr><th>Step</th><th>People</th></tr>${funnel}</table></div>
    <h2>Songs</h2><p>The ${orders.length} most recent. Remove takes a paid song's page down and can be undone. Delete erases a song and everything about it.</p><div class="wrap"><table><tr><th>When (UTC)</th><th>For</th><th>From</th><th>Contact</th><th>Status</th><th>Takes</th><th>Paid</th><th>Send date</th><th></th><th></th><th></th></tr>${rows}</table></div>
    <h2>Reports</h2><div class="wrap"><table><tr><th>When</th><th>Song</th><th>What they said</th></tr>${reports}</table></div>
    <h2>Replies from recipients</h2><div class="wrap"><table><tr><th>When</th><th>Song</th><th>Words</th><th>Sharing</th></tr>${replies}</table></div>
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
// Housekeeping: old rate-limit entries, and the audio of previews nobody paid for.
function cleanUp() {
  db.pruneEvents();
  if (cfg.unpaidKeepDays > 0) for (const o of db.staleUnpaid(Date.now() - cfg.unpaidKeepDays * DAY)) db.expireUnpaid(o.id);
}
setInterval(sendDue, 60 * 1000).unref();
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
  cleanUp();
});
module.exports = { sendDue, cleanUp };
