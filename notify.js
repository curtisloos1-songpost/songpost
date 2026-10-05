'use strict';
/*
  Messages to customers: the link to their song, the receipt, a scheduled song, "they played it", a reply.

  Every message is written to the outbox table first, so nothing is lost. What happens next depends on
  MESSAGE_PROVIDER:

    log      (default) Nothing is sent. Messages wait in the outbox and show on the admin page.
    resend   Email through Resend (https://resend.com). Needs RESEND_API_KEY and MAIL_FROM. Sends email only:
             while it is the provider, the site asks customers for an email address and does not take mobile numbers.
    console  Local testing only (needs DEV_MOCKS=1). Prints each message to the server log and counts it as delivered.

  To add another service, add a provider below that takes { to, subject, body } and delivers it, then set
  MESSAGE_PROVIDER to its name. A provider must throw (or reject) when the message was not accepted, so it can
  be tried again. Give it `.texts = true` if it can also send to mobile numbers.
  Texting needs the customer's consent, which the site asks for where the number is typed.

  A message that fails is tried again after 2, 4, 8, 16 and 32 minutes, then marked as failed.
  hooks.delivered(row) and hooks.failed(row) are called when a message finally goes out or is given up on.
*/
const cfg = require('./config');
const db = require('./db');

const PROVIDERS = {
  // example: async ({ to, subject, body }) => { ...call your email or SMS service... }
};
if (cfg.resendKey && cfg.mailFrom) {
  PROVIDERS.resend = async ({ to, subject, body }) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.resendKey },
      body: JSON.stringify(Object.assign({ from: cfg.mailFrom, to: [to], subject, text: body }, cfg.mailReplyTo ? { reply_to: cfg.mailReplyTo } : {})),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) return;
    const err = new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    // 400, 404, 422: this one message was refused (a bad address, say). Trying again won't help, and the service is fine.
    err.permanent = [400, 404, 422].includes(res.status);
    throw err;
  };
}
if (cfg.devMocks) {
  PROVIDERS.console = async ({ to, subject }) => { console.log(`PRACTICE MESSAGE (not really sent) to ${to}: ${subject}`); };
  PROVIDERS.console.texts = true;
}

const MAX_TRIES = 6;
const hooks = { delivered: null, failed: null };
const inFlight = new Set();

const live = () => !!PROVIDERS[cfg.messageProvider];
// Whether the connected service can send to mobile numbers as well as email addresses.
const canText = () => live() && !!PROVIDERS[cfg.messageProvider].texts;
const isEmail = to => /^\S+@\S+\.\S+$/.test(to);

async function attempt(row) {
  const provider = PROVIDERS[cfg.messageProvider];
  if (!provider || !row || row.sent_at || row.failed_at || inFlight.has(row.id)) return;
  inFlight.add(row.id);
  try {
    await provider({ to: row.to_contact, subject: row.subject, body: row.body });
    db.markMessageSent(row.id);
    db.noteOk('messages');
    if (hooks.delivered) hooks.delivered(row);
  } catch (e) {
    const attempts = (row.attempts || 0) + 1;
    if (!(e && e.permanent)) db.noteErr('messages', e && e.message);
    console.error(`Message ${row.id} to ${row.to_contact} failed (try ${attempts} of ${MAX_TRIES}):`, e && e.message);
    if (attempts >= MAX_TRIES || (e && e.permanent)) {
      db.markMessageTried(row.id, attempts, null, Date.now());
      if (hooks.failed) hooks.failed(row);
    } else {
      db.markMessageTried(row.id, attempts, Date.now() + Math.pow(2, attempts) * 60 * 1000, null);
    }
  } finally {
    inFlight.delete(row.id);
  }
}

// Queues a message and tries to deliver it. tag marks messages that something else is waiting on.
function send(orderId, to, subject, body, tag) {
  to = String(to || '').trim();
  if (!to) return null;
  const id = db.queueMessage(orderId, to, subject, body, tag);
  // A mobile number, with a service that only sends email: there is nothing to retry and nothing wrong with the service.
  if (live() && !isEmail(to) && !canText()) {
    db.markMessageTried(id, 0, null, Date.now());
    if (hooks.failed) hooks.failed(db.getMessage(id));
    return id;
  }
  attempt(db.getMessage(id)).catch(e => console.error('Message', id, 'crashed:', e));
  return id;
}

// Called every minute: another try for messages that failed earlier.
async function retryPending() {
  if (!live()) return;
  for (const row of db.retryableMessages(Date.now())) await attempt(row);
}

module.exports = { send, live, canText, retryPending, hooks, MAX_TRIES, PROVIDERS };
