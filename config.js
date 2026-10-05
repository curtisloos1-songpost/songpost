'use strict';
const path = require('path');

// Load .env if present (Node 20.12+). Real hosts set environment variables directly.
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch (e) { /* no .env file */ }

const int = (name, fallback) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) ? n : fallback;
};
const str = (name, fallback = '') => (process.env[name] || fallback).trim();
const on = name => str(name) === '1';
const num = (name, fallback) => {
  const n = parseFloat(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
};

const cfg = {
  port: int('PORT', 3000),
  // The site's public address. On Render it is filled in automatically until you set your own domain here.
  baseUrl: (str('BASE_URL') || str('RENDER_EXTERNAL_URL') || 'http://localhost:' + int('PORT', 3000)).replace(/\/+$/, ''),
  // How many proxies sit between visitors and the site (the host's own, plus any CDN). Decides which address counts as the visitor's.
  trustProxy: int('TRUST_PROXY', 1),
  // Private preview: when set, only people with this code can make songs. Gift pages stay open to anyone with their link.
  accessCode: str('ACCESS_CODE'),
  dataDir: path.resolve(str('DATA_DIR', './data')),
  supportEmail: str('SUPPORT_EMAIL', 'the Songpost support address'),

  musicEngine: str('MUSIC_ENGINE', 'elevenlabs').toLowerCase(),
  allowUnofficialEngine: on('ALLOW_UNOFFICIAL_ENGINE'),
  elevenKey: str('ELEVENLABS_API_KEY'),
  elevenModel: str('ELEVENLABS_MODEL', 'music_v2_5'),
  elevenMaxSeconds: int('ELEVENLABS_MAX_SECONDS', 210),
  elevenSecondsPerLine: parseFloat(process.env.ELEVENLABS_SECONDS_PER_LINE) || 4.5,
  // Mureka (https://platform.mureka.ai): the second engine. With both keys set, each stands in when the other cannot record.
  murekaKey: str('MUREKA_API_KEY'),
  murekaModel: str('MUREKA_MODEL', 'mureka-9').toLowerCase(),
  murekaPollMs: int('MUREKA_POLL_MS', 5000),
  // The Mureka model a Platinum record is recorded on after payment. "off" for none. Can be changed on the admin page.
  premiumModel: str('PREMIUM_MODEL', 'mureka-9.5').toLowerCase(),
  // A premium recording that could not be made is tried again by itself after each of these waits, in milliseconds.
  premiumRetryMs: str('PREMIUM_RETRY_MS', '120000,600000').split(',').map(s => parseInt(s, 10)).filter(n => n > 0),
  // "off" for no backup engine; otherwise the other of ElevenLabs and Mureka is the backup when it has a key.
  musicBackup: str('MUSIC_BACKUP').toLowerCase(),
  sunoapiKey: str('SUNOAPI_KEY'),
  sunoapiModel: str('SUNOAPI_MODEL', 'V6'),
  sunoapiDuration: int('SUNOAPI_DURATION', 180),

  anthropicKey: str('ANTHROPIC_API_KEY'),
  anthropicModel: str('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),
  // The model that checks a customer's own words against the content rules. Defaults to the lyric-writing model.
  anthropicReviewModel: str('ANTHROPIC_REVIEW_MODEL') || str('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),

  stripeKey: str('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: str('STRIPE_WEBHOOK_SECRET'),
  stripeAutomaticTax: on('STRIPE_AUTOMATIC_TAX'),
  priceGoldCents: int('PRICE_GOLD_CENTS', 2499),
  pricePlatinumCents: int('PRICE_PLATINUM_CENTS', 3999),

  previewSeconds: int('PREVIEW_SECONDS', 30),
  takesPerOrder: int('TAKES_PER_ORDER', 2),
  songsPerIpPerDay: int('SONGS_PER_IP_PER_DAY', 3),
  dailyUnpaidSongCap: int('DAILY_UNPAID_SONG_CAP', 150),
  lyricsPerIpPerHour: int('LYRICS_PER_IP_PER_HOUR', 20),

  // How many days after paying the one free redo stays available. Keep it in step with the refund policy page.
  redoDays: int('REDO_DAYS', 7),
  // The audio of a preview nobody paid for is deleted after this many days. 0 keeps it for ever.
  unpaidKeepDays: int('UNPAID_KEEP_DAYS', 30),

  // Scheduled songs go out at this hour, in UTC. 15 is mid-morning in US Central time.
  sendHourUtc: int('SEND_HOUR_UTC', 15),
  // Which service sends emails and texts. "log" only queues them for the admin page.
  messageProvider: str('MESSAGE_PROVIDER', 'log').toLowerCase(),
  // Email through Resend (https://resend.com). Set MESSAGE_PROVIDER=resend with these two filled in.
  resendKey: str('RESEND_API_KEY'),
  mailFrom: str('MAIL_FROM'),          // who emails come from, on a domain verified with Resend: Songpost <hello@your-domain.com>
  mailReplyTo: str('MAIL_REPLY_TO'),   // where replies go, if different
  // Added to the end of reminder emails. US law expects promotional email to carry the sender's postal address.
  mailFooter: str('MAIL_FOOTER'),

  // What things cost, for the "Costs and earnings" figures on the admin page. These are the suppliers' list
  // prices; change them here if your plan's prices differ. They only affect what the admin page reports.
  costMusicPerMinute: num('COST_MUSIC_PER_MINUTE', 0.15),            // ElevenLabs, dollars per minute of music
  costMurekaPerSong: num('COST_MUREKA_PER_SONG', null),              // Mureka, dollars a song; unset uses Mureka's list price for the model
  costClaudeInPerMTok: num('COST_CLAUDE_INPUT_PER_MTOK', 2),         // Claude, dollars per million tokens read
  costClaudeOutPerMTok: num('COST_CLAUDE_OUTPUT_PER_MTOK', 10),      // Claude, dollars per million tokens written
  cardFeePercent: num('CARD_FEE_PERCENT', 2.9),                      // Stripe, percent of each sale
  cardFeeFixedCents: num('CARD_FEE_FIXED_CENTS', 30),                // Stripe, cents per sale
  monthlyFixedCosts: num('MONTHLY_FIXED_COSTS', 14),                 // hosting and plans, dollars a month

  adminKey: str('ADMIN_KEY'),
  devMocks: on('DEV_MOCKS'),
};

module.exports = cfg;
