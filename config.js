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

  adminKey: str('ADMIN_KEY'),
  devMocks: on('DEV_MOCKS'),
};

module.exports = cfg;
