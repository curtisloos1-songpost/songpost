# Songpost

A self-serve song gift site. A customer tells the story, reads and edits the lyrics, hears a
preview, pays, and sends a page with the song. Nobody on your side touches an order.

This code matches the Songpost prototype: the same pages, look, wording and steps. Since 0.3.0
the code has one thing the prototype does not show: the "Record it again" section on the sender's
page after paying.

## What a customer does

1. **Opening page.** One button: "Start their song."
2. **Who it's for.** Names, how to say the name, and what the song is for (a memory, a life story, or an occasion).
3. **The story.** Four short questions that change with the kind of song. The tone: one, or two blended.
4. **The sound.** Style (one, or two blended), song language, who sings, and artists they like.
5. **Lyrics.** Claude writes them. The customer edits them and gives an email or mobile number.
6. **Preview.** The music engine records the song. The preview opens on the part where the name is sung, when the engine reports section timing.
7. **Pay.** Gold or Platinum, through Stripe Checkout.
8. **Send.** A link to share, or "send it for me on a date." The date option only appears once a message provider is connected.
9. **The gift page.** The record, a shape that opens when the song starts (set by the tone), the note, the lyrics, a save button, a reply box, and a report link.
10. **The free redo.** For 7 days after paying, the sender's page has "Record it again": once, with the lyrics changed or not. The new recording replaces the old one at the same link. Nobody on your side is involved.

## Gold and Platinum

- **Gold** (`PRICE_GOLD_CENTS`): the full song, the gift page, and a file to keep.
- **Platinum** (`PRICE_PLATINUM_CENTS`): both takes on the gift page, and a lyric sheet that prints cleanly. If the customer recorded only one take before paying, the second is recorded automatically right after payment.

Only describe what exists. A lyric video is not built, so it is not offered.

## Swapping the music engine

The site talks to music through one function, described at the top of `src/engines/index.js`.

```
MUSIC_ENGINE=elevenlabs   # official API, licensed for commercial use on paid plans
MUSIC_ENGINE=sunoapi      # unofficial Suno reseller: previews only, checkout stays off
MUSIC_ENGINE=mock         # plain tones, costs nothing, for testing the site
```

To add an engine, copy `src/engines/elevenlabs.js`, change the request, add one line to the list
in `src/engines/index.js`, and set `MUSIC_ENGINE`.

## Try it on your own computer

Needs Node.js 20.12 or newer.

```
npm install
npm run dev
```

Open http://localhost:3000. `npm run dev` uses practice lyrics, the tone engine and a fake
checkout, so the whole flow works with no accounts and no cost. Add `ADMIN_KEY=test` to see
`/admin?key=test`.

## A private test copy on Render

`render.yaml` sets this up. It creates one web service with a 2 GB disk for the songs, using
ElevenLabs and Claude for real and a test checkout that unlocks songs without a card.

1. Put this folder in a GitHub repository (private is fine).
2. In Render choose **New > Blueprint**, connect GitHub, and pick the repository.
3. Render asks for four values: `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `ACCESS_CODE` (an invite
   code you make up) and `ADMIN_KEY` (a password for the admin page).
4. When it finishes, open the `onrender.com` address it gives you and enter the invite code.

To invite someone, send them `https://YOUR-ADDRESS/?code=YOUR-INVITE-CODE`. Without the code nobody
can make a song. Gift pages need no code, so the people who receive songs can always open them.

Then open `/admin?key=YOUR-ADMIN-KEY` and check the line that says which address the site sees you
as. It should be your own. If it is the same for people on different networks, add `TRUST_PROXY=2`
in Render's Environment settings.

This costs about $8 a month (the smallest paid instance plus the disk). The free instance cannot
have a disk, so it would lose every song each time it restarts.

## Going live

1. **Keys.** Copy `.env.example` to `.env` (or set the same names in your host's settings): ElevenLabs (paid plan), Claude, Stripe.
2. **Stripe webhook.** Add an endpoint at `https://YOUR-DOMAIN/api/stripe/webhook` for `checkout.session.completed`, and set `STRIPE_WEBHOOK_SECRET`.
3. **Messages.** Connect an email and text provider in `src/notify.js` and set `MESSAGE_PROVIDER`. Until then nothing is sent: the link to a customer's song, receipts and "they played it" notices only queue on the admin page, and customers are not offered "send it for me on a date". A provider must throw an error when a message is not accepted; failed messages are tried again for about an hour.
4. **Hosting.** A Node server with a persistent disk for `DATA_DIR`. Run one instance.
5. **Address.** Set `BASE_URL` (https) and `SUPPORT_EMAIL`.
6. **Admin.** Set `ADMIN_KEY`, then open `/admin?key=YOUR-KEY`.
7. Leave `DEV_MOCKS` empty, and `ACCESS_CODE` empty so anyone can make a song.

## Built in for legal reasons

These are in the code because the business needs them. None is legal advice.

- **Policy pages** at `/terms`, `/privacy`, `/refunds`, `/content`. Their text is in `src/legal.json` and each is marked as a draft for a lawyer to review. Edit the text there.
- **Agreement at the pay step.** "By unlocking, you agree to the terms and the redo and refund policy."
- **The redo and refund promise** shown before paying, including that a song's page may be removed.
- **Contact with consent.** An email or mobile number is required before recording, with wording that giving a number agrees to texts about the song.
- **Content rules in the lyric writer.** It declines songs that harass, sexualize, expose private details, or defame.
- **The same rules for the customer's own words.** Lyrics and titles the customer typed or edited are checked by Claude before every recording, and the note is checked at the pay step. If the checker is unavailable, a recording waits and the customer is asked to try again; a note is let through so an outage never blocks a sale.
- **Artist names stay out of the music engine.** They are turned into a description of sound.
- **Reports and removal.** Every gift page has a report link. Reports show on the admin page, which has a Remove button. A removed song's page and file stop working.
- **Deletion.** The admin page also has a Delete button, for when someone asks for their details to be erased. It deletes the audio, the order, its replies, reports and messages, and cannot be undone.
- **Real testimonials only.** `public/testimonials.json` ships empty.
- **The unofficial engine can't take payments** unless `ALLOW_UNOFFICIAL_ENGINE=1`.
- **Sales tax.** `STRIPE_AUTOMATIC_TAX=1` hands it to Stripe Tax.
- **No ownership promise.** The terms say the song is for personal use and that AI-made music may not be protected by copyright.

## Testimonials

Up to three quotes show beside the pay button, and the first also shows on the opening page.

```
[
  { "quote": "I made a song for my mother. It moved her to happy tears, and she still listens to it.", "name": "Curtis, who started Songpost" },
  { "quote": "A real customer's words.", "name": "First name, city" }
]
```

Use only words a real person said about a real song, with their permission, and say so if they
have a connection to the business. Recipients who tick "may share my words" appear on the admin
page as candidates.

## The admin page

`/admin?key=...` shows sales, where visitors drop off (six steps, last 30 days), the 500 most
recent songs with Remove and Delete buttons, reports, replies from recipients, and the message
queue with each message's status (sent, waiting to be tried again, or failed).

Refunds are still done by hand: refund the payment in the Stripe dashboard, then press Remove.

## Money controls

| Setting | Default | Meaning |
| --- | --- | --- |
| `PREVIEW_SECONDS` | 30 | How much of the song plays before payment |
| `TAKES_PER_ORDER` | 2 | Recordings a customer can make per song before paying |
| `SONGS_PER_IP_PER_DAY` | 3 | Unpaid recordings per visitor per day. Failed recordings don't count, and paying for a song clears its recordings from the count |
| `DAILY_UNPAID_SONG_CAP` | 150 | Unpaid recordings across the whole site per day |
| `UNPAID_KEEP_DAYS` | 30 | Days before the audio of an unpaid preview is deleted (0 keeps it for ever) |
| `REDO_DAYS` | 7 | Days after paying that the free redo is available. Keep it in step with the refund policy page |
| `ELEVENLABS_MAX_SECONDS` | 210 | Longest song the ElevenLabs engine will make |

## What has and hasn't been tested

Tested end to end with the practice engine and fake checkout: the questions, lyric writing,
recording with the progress bar, the preview cut at the name, a second take, both tiers, the
ready-to-send screen, scheduling, the gift page with its reveal, both takes and printing on
Platinum, saving, replying, reporting, removal and restore, the policy pages, the visitor counts
and the admin page. Version 0.3.0 added tests of the free redo, the automatic Platinum second
take, the free-preview limits, message retries, scheduled sending, deletion, and clean-up of old
previews.

Tested against stand-ins only (a pretend Stripe and a pretend Claude API): closing an old
checkout when a new one is opened, taking the tier from the checkout that was paid, and the
content check on the customer's own words.

**Not yet run against the live services**, because that needs your keys: ElevenLabs, the Claude
requests (lyric writing and the content check), Stripe payments and tax, and any message provider. The preview cut inside a real
ElevenLabs MP3, sung pronunciation of names, and songs in languages other than English all need
checking by ear. Do the first live run with Stripe in test mode.

## Before you take real money

- A lawyer reviews the four policy pages, the texting consent wording, and sales tax.
- The Songpost name is cleared as a trademark and the domain is bought.
- ElevenLabs' terms are confirmed to cover selling songs to consumers.
- A message provider is connected and tested.
- `DATA_DIR` is backed up.

## What changed in 0.3.0

Fixes from the first full code review:

- Added for the private test: an invite-code lock (`ACCESS_CODE`), a Render set-up file (`render.yaml`), and a check of the visitor's address on the admin page.
- A stray tag that showed two extra buttons on every step and pushed the record below the form.
- Failed recordings no longer use up a visitor's free previews, and paying for a song clears its recordings from the count.
- The sender playing the song on their own gift page no longer sends "they played it".
- The free redo is built (see step 10 above).
- Platinum bought with one take gets its second take recorded automatically.
- The tier and price are taken from the Stripe checkout that was paid, and only one checkout stays open per song.
- The customer's own lyrics, title and note are checked against the content rules.
- Scheduled sending is offered only when messages can be sent, a song is marked sent only after delivery, failed messages are retried, and "today" is judged by the customer's date.
- The admin page has Delete, correct totals beyond 500 songs, and message statuses. Old unpaid previews are cleaned up.

## Files

```
server.js              every route: lyrics, recording, preview, checkout, sending, gift page, policies, admin
src/config.js          settings from the environment
src/db.js              SQLite: songs, replies, reports, message queue, visitor counts
src/lyrics.js          the Claude request that writes the song
src/jobs.js            runs a recording and cuts the preview
src/notify.js          messages to customers (connect a provider here)
src/limits.js          rate limits
src/legal.json         the text of the policy pages
src/page.html          the frame the policy pages are poured into
src/engines/           the music engines (index.js explains the contract)
public/                the site: index.html + make.js (making a song), gift.html + gift.js, common.js, styles.css
```
