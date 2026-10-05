# Songpost

A self-serve song gift site. A customer tells the story, reads and edits the lyrics, hears a
preview, pays, and sends a page with the song. Nobody on your side touches an order.

This code matches the Songpost prototype: the same pages, look, wording and steps. Since 0.3.0
the code has one thing the prototype does not show: the "Record it again" section on the sender's
page after paying.

## What a customer does

1. **Opening page.** Two records, one for each kind of song: about the person, or about a theme or a feeling. Tapping a record, or the button for it ("Start their song", "Start a theme song"), starts that kind.
2. **Who it's for.** Names, how to say the name, and what the song is for: a memory, a life story, an occasion, or "a theme or feeling" (young love, growing old together), which is a song about a subject and not about the person's own story. A theme song sings the name once, as a dedication in the outro.
3. **The story.** Four short questions that change with the kind of song. Below them, "Making this with others?" lets the customer invite sisters, brothers, friends or a team to add their own memories (see "Songs made together").
4. **The sound.** (Since 0.8.6 this step also has "Instruments to feature", and the lyrics step shows "How it will sound", which the customer can edit.) Claude reads the story and suggests a tone and a style, which arrive already selected with a line saying why. Claude also suggests a tempo. The customer can change any of them (tone and style: one, or two blended; tempo: slow, medium, upbeat, or "let the song decide"), names artists whose sound they like in a boxed field under Style, and picks the song language and who sings.
5. **Lyrics.** Claude writes them. The customer edits them and gives an email or mobile number, in a panel of its own just above the Record button.
6. **Preview.** The music engine records the song. The preview opens on the part where the name is sung, when the engine reports section timing.
7. **Pay.** Gold or Platinum, through Stripe Checkout.
8. **Send.** A link to copy, or buttons that open a text message, WhatsApp or an email with the link ready. Or "send it for me on a date", which only appears once a message provider is connected. The same page shows when the song was first played and anything the recipient wrote back, and the opening page lists "Your songs" on the device they were made on, so the sender can always get back to it.
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

## Songs made together

One person starts the song and, on the story step, taps **Invite others to add memories**. That makes an
invite link to send by text, WhatsApp or email. Each person who opens it sees who is asking and who the
song is for, gives their first name, and answers the same short questions from their own phone. No account
and no invite code is needed to add memories.

- The organizer sees each person's answers as they arrive and can leave anyone's out.
- The lyrics are written from everyone's answers, in a shared voice ("we"), using at least one detail from each person.
- If someone adds memories after the lyrics were written, the organizer is told, and "Write different lyrics" brings them in. If the organizer records without doing that, the song is signed only from the people whose memories are in it, and what the latecomer wrote is not kept.
- The record, the gift page and the message to send are signed from everyone ("Anna, Beth and Carol"; a long list becomes "Anna and 5 others" in the heading, with every name underneath).
- Recording the song closes the invitation. Up to 8 people can add to one song.
- Once the song is unlocked, each person who added to it can open the same link on the same device to hear the song, and to see when it was first played and what the recipient wrote back. If they left an email and a message provider is connected, they are emailed when it is ready.
- The organizer pays. A group song costs the same to make as any other.
- An invitation that never becomes a song is deleted after 60 days, with what people wrote.

## How songs spread, and how you see it

- **From a gift page.** After the recipient writes back, the page asks once, "Is there someone you'd like to surprise the same way?" A quiet "Kindness travels" link sits at the foot of the page as well. A song made by someone who arrives that way is counted as coming from that gift. The sender's page then says "Kindness travels: one new song has been started because of this one." Nothing about the new song is shown to anyone.
- **From people who helped make a group song.** Their page has the same quiet link.
- **"How did you hear about Songpost?"** One tap, asked once per device after the first song is unlocked. Someone who arrived from a gift page is counted as "Someone sent me a song" without being asked.
- **Partners.** On the admin page, add a florist, planner or other partner by name. Each gets a link, `/?ref=their-code`. Anyone who arrives by it and makes a song within 30 days is counted for that partner: visits, songs started, songs unlocked, money taken in. Paying a partner is up to you; the site only counts. Removing a partner stops their link counting; their code is never given to anyone else.
- **Any occasion.** In the questions, "Another occasion" lets the customer type any day at all, and the occasion pages have the same box. The spelling is checked before they move on (see 0.8.1).
- **Occasion pages.** `/songs` and one page per occasion (`/songs/retirement`, `/songs/mothers-day`, and so on) for people searching for that kind of song. Each has a button that opens the questions with the occasion already chosen. Their words are in `src/occasions.json`; add or edit entries there. `/sitemap.xml` and `/robots.txt` tell search engines about them. While `ACCESS_CODE` is set (private preview) search engines are asked to stay away.
- **Reminders.** After unlocking, a buyer can ask for an email a week before a date of their own each year, and before Valentine's Day, Mother's Day, Father's Day and Christmas (US dates). Email only, never texts, and only to the address the buyer gave for their song. Every reminder has a link to stop it. Someone with reminders on several songs gets one email per holiday, not one per song. Reminders are only offered once a message provider is connected. A reminder set up within three weeks of its date waits for the next year, because the song they just made was for it.

The admin page shows all of this under **How songs spread**, **How buyers heard about Songpost**, **Partners** and **Reminders people asked for**.

## A private test copy on Render

`render.yaml` sets this up. It creates one web service with a 2 GB disk for the songs, using
ElevenLabs and Claude for real and a test checkout that unlocks songs without a card.

1. Put this folder in a GitHub repository (private is fine). If GitHub's upload page drops every file into one place
   with no folders, that is fine: `arrange.js` moves them into `src`, `src/engines` and `public` when the site is built.
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
3. **Messages.** Email is built in through Resend (resend.com). Create an account, verify your domain there, make an API key, then set `MESSAGE_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM` (for example `Songpost <hello@your-domain.com>`) and, for reminder emails, `MAIL_FOOTER` with your postal address. This sends email only: while it is the provider the site asks customers for an email address and does not accept mobile numbers. Until a provider is set nothing is sent: the link to a customer's song, receipts and "they played it" notices only queue on the admin page, and customers are not offered "send it for me on a date" or reminders. To add texts or another email service, add a provider in `src/notify.js`; it must throw an error when a message is not accepted, and failed messages are tried again for about an hour.
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
- **Reminders are opt-in, email only, and stoppable.** Nobody is sent one unless they asked, each has a stop link that needs a button press, and `MAIL_FOOTER` is where your postal address goes. Reminders are never sent by text.
- **People who add to a group song** are told before they write that the organizer sees their words, and agree to the terms and content rules. Their names are checked with the rest of the song before recording.
- **The unofficial engine can't take payments** unless `ALLOW_UNOFFICIAL_ENGINE=1`.
- **Sales tax.** `STRIPE_AUTOMATIC_TAX=1` hands it to Stripe Tax.
- **No ownership promise.** The terms say the song is for personal use and that AI-made music may not be protected by copyright.

## Example songs

The opening page shows "Hear an example" once at least one example is set up. On the admin page, under
**Example songs on the opening page**:

- **A song made on Songpost.** Choose one of your unlocked songs, write a caption, press "Show as an example". This is the best kind of example, because it is exactly what a customer gets. If that song is later removed or deleted, its example goes with it.
- **A recording made elsewhere.** Upload an MP3, M4A or WAV (up to 24 MB) with a title and a caption. Unless you mark it as made on Songpost, the page adds: "Recorded with a different music tool from the one Songpost uses, so your song may sound different." An example made on Songpost says instead: "Recorded on Songpost, with the same music tool that will record your song." Keep that honest: an example that sounds unlike what the buyer receives is a reason for refunds and complaints.

Use only songs about people who have agreed. Every caption starts "Made by the founder of Songpost", so visitors
know the song comes from the business itself; the owner's name is not given. Add who it was for if you like. Check that you have the right to use a recording for business: for example, Suno's terms
allow commercial use only of songs made while on a paid plan.

## Testimonials

Up to three quotes show beside the pay button, and the first also shows on the opening page.

The easy way: on a gift page, the recipient can write back to the sender and tick "Songpost may
share my words and first name with others". Those replies appear on the admin page marked "May be
shared", each with a **Show on the site** button. One click makes it a testimonial, signed
"First name, who was given a song"; another click takes it off. Replies not marked for sharing
can never be shown.

You can also type quotes into `public/testimonials.json`. Those are listed first.

```
[
  { "quote": "I made a song for my mother. It moved her to happy tears, and she still listens to it.", "name": "The founder of Songpost" },
  { "quote": "A real customer's words.", "name": "First name, city" }
]
```

Use only words a real person said about a real song, with their permission, and say so if they
have a connection to the business. Recipients who tick "may share my words" appear on the admin
page as candidates.

## The admin page

Three things sit at the top of it:

- **Is everything working?** One line for each outside service (Claude, the music engine, Stripe,
  messages): whether it is connected, when it last worked, and what went wrong the last time it
  didn't. For alerts, point a free uptime monitor at `/health`. It answers 200 while everything
  works and 503 when a service has failed three times in a row.
- **Costs and earnings.** What the site has spent on music and Claude and taken in from sales,
  today, over 7 and 30 days, and since counting began, with cost per song started and per sale.
  These are estimates from what the site counted and the list prices in the settings; check them
  against the suppliers' own accounts now and then.
- **Where visitors drop off.**

Below those: **How songs spread** (songs started from gift pages and by people who helped make a
group song, group songs and how many people added to them, and the longest chain of songs so far),
**How buyers heard about Songpost**, **Partners** (add one, copy their link, see their numbers),
and **Reminders people asked for**.

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

Version 0.8.0 added browser tests of a song made by four people on four phones, the chain from a
gift page to a new song, the "how did you hear" question, partner links, the occasion pages, and
reminders (with the site's clock moved forward through a year). Email through Resend was tested
against a stand-in only, not the real service. The group-song lyric instructions have not yet been
run through the real Claude API; the practice lyric writer stood in for it.

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

## What changed in 0.8.6

- **A fuller sound description.** Claude now writes 9 to 12 descriptors for the studio, in a set order: genre, tempo as a number, groove, instruments, the voice and its character, mood, production, and up to two cues for a part of the song ("stripped bridge", "big final chorus").
- **Each cue goes to its own part of the song.** A descriptor about the bridge, the chorus, the final chorus, the verses, the intro or the outro is sent with that part only. The tempo is sent with every part. A style with no such cues is sent exactly as before.
- **Buyer's options.** On the sound step: **Instruments to feature** (none, or up to three), and the sound field now invites a description ("laid-back groove, 808s, 95 bpm") as well as artists. On the lyrics step: **How it will sound** shows what the studio will be told, and the buyer can change it. It can be changed again for the second take.
- **The sound description is checked** with the lyrics before recording, so one that names a real artist or song is turned down with a request to describe the sound instead.
- **Every example says who made it**, without a name: "Made by the founder of Songpost". The caption box on the admin page starts with those words, and they are used if it is left empty.
- **Every example says how it was recorded.** A song made on Songpost: "Recorded on Songpost, with the same music tool that will record your song." An upload made elsewhere keeps its "different music tool" line.
- Not yet heard: these changes alter what ElevenLabs is asked for, and have only been checked in what is sent, not by ear. Make two or three songs and listen before relying on them.

## What changed in 0.8.5

- **Example songs on the opening page.** "Hear an example" shows up to three songs, each with a title, a caption and a play button. They are managed on the admin page under **Example songs on the opening page**: pick one of your own unlocked Songpost songs, or upload an MP3, M4A or WAV made elsewhere. An upload marked as made with another music tool carries a line on the page saying so. See "Example songs".

## What changed in 0.8.4

- The headline on the opening page, and the page title, now read "Turn their story or theme into a song."
- **Label writing always fits.** Every record measures its own label and makes any line that is too wide smaller until it fits, so a long name, occasion or song title can no longer run past the edge of the label. This applies on the opening page, in the steps, and on the gift page.

## What changed in 0.8.3

- **Two records on the opening page**, one for each kind of song: "Their story" and "A theme or feeling", each with a caption. Tapping a record starts that kind of song, the same as the two buttons beneath ("Start their song", "Start a theme song"). Once a song is started, the page goes back to the one record for that song.

## What changed in 0.8.2

- **Two kinds of song, said on the opening page.** Under the main button: "A song doesn't have to be about their life. Send one about a theme or a feeling instead", with **Start a theme song**, which opens the questions with "A theme or feeling" already chosen. The first step explains what a theme song is when that choice is selected. There is also an occasion page for it, `/songs/theme-or-feeling`.

## What changed in 0.8.1

- **Any occasion, from the occasion pages too.** `/songs` and every occasion page have a box, "Don't see yours? Type any occasion", which opens the questions with it filled in.
- **Spelling check on a typed occasion.** It is printed on the record and the gift page, so before the customer moves on Claude checks it. Capital letters are put right without asking. A spelling correction is offered ("Did you mean National Histology Day?") and the customer chooses. If the check can't be done, they carry on. The field also has the browser's own spell check switched on.
- The record's placeholder title keeps the capitals of a named day and says "An anniversary song", not "A anniversary song".

## What changed in 0.8.0

- **Songs made together.** An organizer invites others to add their own memories from their own phones; one song is written from everyone's and signed from all of them. See "Songs made together".
- **The invitation after the song.** After the recipient writes back, the gift page asks if there is someone they would like to surprise the same way. Songs started that way are counted, and the original sender is told their song led to another.
- **"How did you hear about Songpost?"** One tap after unlocking, asked once per device.
- **Partner links** with their own numbers on the admin page.
- **Occasion pages** at `/songs`, with a sitemap, for people searching.
- **Reminders by email**, opt-in, for a yearly date and the four gift holidays.
- **Email through Resend**, switched on with three settings. With an email-only provider the site stops accepting mobile numbers, so nobody is promised a text that can't be sent.
- The admin page has four new sections for all of the above.
- New files: `public/join.js` and `src/occasions.json`. `arrange.js` knows where they go.

## What changed in 0.7.0

- **Costs and earnings** and **Is everything working?** on the admin page, and a `/health` address for an uptime monitor.
- **Protection:** protective headers on every response; ten wrong admin keys from one address lock that address out for an hour.
- **Order reference** on the "ready to send" page and in the message sent after payment.

## What changed in 0.6.3

- **What it says in English.** For a song in another language, the lyric writer also returns a plain English meaning, line for line. It shows under the lyrics on the "Read it through" step, so a sender who can't read the language can check what the song says before recording. It is never sung.

## What changed in 0.6.2

- The content check before recording now also covers the names and occasion shown on the gift page, and the sounds-like spelling of the name. That spelling is what the singer is given in place of the name and never appears in the written lyrics, so it was a way to have something sung that the check had not seen.

- The three Claude requests (lyrics, content check, suggestion) now allow much longer answers. The model thinks before answering and that thinking counted against a tight limit, so now and then an answer was cut off: a customer would have seen "We couldn't check the words just now" or "The lyrics did not come through" for no good reason. Found in live testing.

## What changed in 0.6.1

- **More occasions.** Retirement, Work anniversary and Boss's Day are on the list, and "Another occasion" lets the customer type any day at all (National Histology Day, Administrative Professionals Day). Whatever they type is what the lyric writer is told the song is for.

## What changed in 0.6.0

- **Hear it said.** Under "How do you say their name?", a button reads the name aloud using the device's own voice, from the sounds-like spelling when one is given. It checks the spelling, not the singer: the music engine may still sing it differently.
- **Speak your answer.** Where the browser can turn speech into text, each story question has a button for it. Where it can't (many in-app browsers), there are no buttons and a tip points to the keyboard's microphone. The speech is processed by the customer's browser maker (Apple or Google), not by Songpost; the privacy page should say so.

Both rely on features of the customer's own phone or browser and were tested here only with stand-ins. They need trying on a real iPhone and a real Android phone.

## What changed in 0.5.0

More from the family test:

- **Theme songs.** "A theme or feeling" is a new choice for what the song is for, with its own four questions. Two words ("Young love") are enough to go on.
- **Tempo.** Slow, Medium, Upbeat, or "Let the song decide". The choice is written into the style sent to the music engine, ahead of everything else, and any other tempo in the style is dropped.
- **Artists field.** It was a bare line at the bottom of the sound step and was being missed. It is now a box with an example in it, directly under Style.
- When the name is only sung in the outro, the preview opens on the chorus instead of the last seconds of the song.

## What changed in 0.4.0

From the first family test:

- The email or mobile number field was easy to miss. It now sits in its own panel above the Record button, and tapping Record without it jumps to the field with the message beside it.
- The record on the opening page showed "Rachel" as an example, which read as if the song had to be for Rachel. It now shows a blank, "their name".
- Claude suggests the tone and style from the story (`/api/suggest`). The customer can change them. If the suggestion is slow or fails, the usual defaults stay and nothing is held up.
- A WhatsApp button beside "Text it" and "Email it".
- Replies and the first play now show on the sender's own page, and the opening page lists "Your songs". Until a message provider is connected, nothing is emailed or texted, so this is the only way a sender sees a reply. The gift page now tells the recipient their words were saved for the sender, not "sent".
- One-click testimonials from the admin page (see Testimonials).
- `arrange.js` (0.3.1): files uploaded to GitHub with no folders are sorted into place when the site is built.

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
arrange.js             puts files into their folders if they were uploaded without them (runs by itself)
render.yaml            the set-up file Render reads
server.js              every route: lyrics, recording, preview, checkout, sending, gift page, policies, admin
src/config.js          settings from the environment
src/db.js              SQLite: songs, replies, reports, message queue, visitor counts, group songs, partners, reminders, example songs
src/lyrics.js          the Claude request that writes the song
src/jobs.js            runs a recording and cuts the preview
src/notify.js          messages to customers (connect a provider here)
src/limits.js          rate limits
src/legal.json         the text of the policy pages
src/occasions.json     the words of the occasion pages at /songs
src/page.html          the frame the policy, occasion and invitation pages are poured into
src/engines/           the music engines (index.js explains the contract)
public/                the site: index.html + make.js (making a song), gift.html + gift.js, join.js (adding memories to a group song), common.js, styles.css
```
