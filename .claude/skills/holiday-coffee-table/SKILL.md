---
name: holiday-coffee-table
description: Use when the family shares a briefing note, document, PDF or picture about a holiday, trip or tour (an itinerary, a booking list, a brochure, a screenshot of plans, a map or a hand-written list of places), or asks for a trip page, a holiday plan or a new version of one. It turns that intention into a super-luxury, interactive "coffee-table" trip page to the standard of the family's v15 page (7 November 2026), built from one private trip data file with the page kit in kit/, checked against the owner's rules, and reviewed by the owner before anything goes on the family site.
---

# Holiday coffee-table pages

Version 1, 7 November 2026. Rebuilt from the family's v15 trip page, which is the standard every new
trip page meets. The owner's words: "create a fresh construct template based on v15 ... I will give
you a briefing note about the next family holiday and you are to do the similar like v15".

A trip page is one self-contained HTML document, uploaded to the family site (hongjia.org) and
viewed in its locked-down document frame. Everything trip-specific lives in one data file (JSON).
The renderer, its style sheet and its script are generic and stay in this folder:

- `kit/build.py`: renders a data file and checks pages (`--check`). Python 3 standard library only.
- `kit/schema.md`: every field of the data file, and which are required.
- `kit/assets/kit.css`, `kit/assets/kit.js`: the approved design and the page's behaviour.
- `kit/example/trip.json`: a made-up eight-day trip shaped like v15 (two bases, two transfer days
  with a midway break, every section filled). Copy its shape; never its facts, which are fictional.
- `kit/test_kit.py`: the kit's tests (`python3 kit/test_kit.py`); the GitHub checks run them.
- `reference/subtypes.md`: what each kind of trip must cover, rebuilt from v15.

## What v15 has, so every new page has it

The owner chose "Everything v15 has". A new page leaves a part out only on the owner's word.

- **Opener:** full-screen hero slideshow, the trip in three TL;DR lines, alert chips (a public
  holiday goes here), the stay and can't-miss cards, a countdown and local time, the globe from home
  to the destination, and **Play the trip** (the tour). While the tour plays, the family site folds
  its right-hand buttons into a 🔭.
- **Legend** that lights up places on the page and the map by category (stays, transport, weather,
  food, drinks, snacks, shopping, fun, sights, worship).
- **Days**, one article each: the day's photo band, route line with every place linked, badges,
  Plan A stops with 2 to 4 credited photos each, timeline items pointing at their stops, the four
  info boxes (Getting around, Meals, Style & photo moments, Make it easier), **Plan B** (rain) and
  **Plan C** (heat, wind or storm) as swaps, nearby extras, "if it's closed or crowded"
  alternatives, the live forecast strip, **Meals** with four choices each (the planned place
  counted), **Taste of the day** and **Shop the day** with that day's trading hours, and Share
  this day.
- **Map centre:** a map per day with lettered pins and the road legs, relayed through the family site.
- **Calendar:** one column per day, an Add for each timed item and Add this day (needs `meta.tz` as `UTC±H`).
- **Taste & Shop:** by area, signature tastes, sweet stops, markets on the family's days, shopping,
  what to bring home, the trading-hours table, and Hungry? / Shop nearby.
- **Place panels:** every place name opens a panel in the page (photo and credit, what it is,
  address, hours and photo spot with sources, awards, Show on map, Share, official links, the venue's
  own Instagram).
- **Gallery** (Read / Gallery switch): a mosaic of credited photos and official accounts' posts per
  day, each picture and post once a day, one Facebook link per account a day, posts loaded only on a tap.
- **# links** beside every section, day and Gallery day: a tap shares a link to that very spot; the
  date bar follows the day you are reading or looking at.
- **Prose sections:** overview, audience (party or lenses), plans and their rules, concierge per area
  with emergency numbers, holidays and weather, stays (with places of worship near each base),
  transport, backups, checklist, upgrades (per area, never replacing the plan), credits, sources.

## Workflow

1. **Intake.** Read the briefing note or upload in full: dates, places, bookings, people,
   constraints, and what the owner wants from the trip. Note what is booked and what is only an
   idea. Say what could not be read. Restate your understanding and ask until it is clear (the owner:
   "ask me till you understood").
2. **The owner's choices.** Ask, or take from the request, before building:
   - **Audience mode**: one travelling group (`party`, as v15) or switchable kinds of traveller (`lenses`).
   - **Luxury level** of the optional upgrades (comfortable, premium, ultra).
   - **Kinds of trip** (one or more): open each checklist in `reference/subtypes.md`.
   - **Title** of the document on the site and the file's version number (see Versions).
3. **Research, with sources.** Every fact on the page is checked against a source the reader can
   open, recorded with the time it was opened: opening hours, prices, phone numbers, holiday dates
   and trading rules, access, distances, hospital and police details, climate averages. Prefer the
   venue's own website and official bodies. A fact that cannot be confirmed is left out, or shown as
   unconfirmed and listed under "Checked and left out". Where two official pages disagree, use the
   newer and say so on the page.
   - **Photos** need an author and a licence (open-licence libraries such as Wikimedia Commons, or
     the venue's own pictures from its website, credited to it). Never a picture without a credit,
     never an empty frame, never the same photo twice in a day's Gallery.
   - **Social accounts** are only the venue's own, linked from its own website or official listing.
     No chain or brand accounts in place of the venue (the owner: "drop the five brand"). No
     age-restricted accounts (alcohol venues), which do not show to people who are not logged in.
     Facebook is a link only (its embeds do not run in the frame).
   - **"Highest star"** means published awards and guide listings (`awards`), never Google or other
     star ratings in the page. Say "from the official accounts", not "most popular", unless
     popularity was measured.
4. **Build the data file** (`kit/schema.md`), copying the sample's shape: the opener first, then each
   day, each stop, each place, the legs (road distance and time per drive, cited), the forecast
   places, the areas, Taste & Shop, worship near each base, and the prose sections. Food, snacks and
   shopping matter most to this family. Every meal (breakfast, lunch, dinner) gets four choices open
   on that date (`page.meal_choices: 4`). One photo spot per place, only where an official source
   names one. Route lines and notes link their places with `[[place:key|text]]`.
5. **Render**: `python3 kit/build.py trip.json -o <Trip>-vNN-<dates>.html`.
6. **Check**: `python3 kit/build.py --check <page>.html`, and fix every problem it reports.
7. **Look at it as the family will.** Open the page in a local copy of the family site (a release
   build and a test database) at phone, iPad and desktop widths: the tour, the Gallery, the
   Calendar, a # link, Share, the map and the forecast. Send the owner the page and screenshots.
8. **The owner's approval.** Nothing goes on hongjia.org until the owner writes
   "APPROVE upload <Trip> vNN". A new trip is filed as a new document; a revision is filed as the
   next version of the trip's document, after checking the version count first. Sign in with the
   family password from the environment only, and sign out after every live check.
9. **Live check** after uploading: the version tag in the header, the map pictures through the site,
   the forecast, a place panel, Share, a # link, the Gallery and the Calendar, then sign out.
10. **Keep the data file safe** (the owner, 7 November 2026: "Attach it on hongjia.org"). The data
    file is private and lives outside the repository. After the owner's APPROVE for it, attach it to
    the trip's document on the family site as a `.txt` file (visible to signed-in family only), so
    the next version can start from it in a new session.

## Versions

- The file name carries the version: `…-v15-…html`. The site shows it in the header as
  "filing number · v.15 title", from the file name (or the site's own version count if the name has none).
- The page's edition line says the same: "Coffee Table edition v15 · <date>".
- Each version's changes are the owner's decisions, recorded in the private data-making script with
  the owner's words, never in this public folder.

## Quality bar

The owner wants both the look and the content to be super-luxury and to "wow".

- **Look:** the Atelier design: warm ivory and a deep green, Fraunces display headings with one
  italic accent word (`*word*` in titles), Inter text and letter-spaced labels, rounded photo cards
  with credits laid over the picture, a frosted top bar, a photo band opening each day, generous
  photography, nothing cramped, nothing wider than a 390 px phone. Do not restyle it; extend it.
  Movement uses the Web Animations API, is gentle and stops under reduced motion. Accessibility
  stays: 44 px targets, keyboard use, screen-reader labels, print mode.
- **Content:** a concierge's knowledge, not a brochure's. Each stop says why it is there, the best
  time, the photo moments, the easier version and what is nearby. Real distances and road times with
  buffers. Honest limits: "proposed, not booked", "estimate, not a quote". No filler, no unverified
  superlatives.
- **Pace:** one principal outing a day, rest built in, seated meals; transfer days are transfer
  days with one real midway break; "swap, don't stack": a backup replaces a stop, it is never added.

## The page's libraries and limits

The document runs in the site's locked frame (an opaque origin: no same-origin access, no downloads).
Scripts are inline or from cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com or cdn.tailwindcss.com,
with exact versions pinned; the page may fetch only from those CDNs; pictures must be https or
`data:`; frames only Google Maps and Instagram and TikTok embeds. No `innerHTML` with data. A full
eight-day page is about 1.8 MB (v15); the site accepts up to 10 MB.

## The family site's services for trip pages

The page talks to the family site only by messages from the frame (`window.parent.postMessage`), and
accepts answers only from `window.parent`. The site checks every message's fields.

- **Weather** (`hj:weather-want`, answered by `hj:weather`): up to 12 forecast places
  `{key, lat, lon, start, end}`; the site asks Open-Meteo (CC BY 4.0) itself, so family devices never
  contact it. Each day shows its strip with the suggested plan and "Weather data by Open-Meteo.com".
- **Map pictures** (`hj:tiles-want`, answered by `hj:tiles` with a short-lived ticket): the site relays
  OpenStreetMap tiles, because the locked frame sends no Referer. The page shows
  "© OpenStreetMap contributors" on the map. Away from the site, the map keeps its routes and pins.
- **Share** (`hj:share-want`): a place as its name, a line and an https link; the document only as
  its address on the site, optionally with a part name after a # (a letter then up to 60 letters,
  digits, `_` or `-`).
- **Hungry? / Shop nearby** (`hj:near-want`): the site asks the person first, takes one rough reading
  on the device, and answers with the nearest place keys and rough distances only.
- **The tour** (`hj:tour` open or closed): the site folds its right-hand buttons into a 🔭.
- **Add to calendar:** links to the site's `/calendar.ics`, signed-in only, which turns the event in
  the link into a calendar file.

## Plan A, B and C

- **Plan A** is the day as written. **Plan B** is for rain: covered, indoor, close to the base.
  **Plan C** is for heat, strong wind or storms: cooler, sheltered, shorter, earlier.
- Each alternative names what it replaces, and is researched and sourced like Plan A.
- The rules (for example "Rain chance 60% or more: Plan B") are in the data file and on the page; the
  first matching rule decides the suggestion. The page shows every plan; the forecast highlights the
  suggested one and never hides another.

## Privacy

This folder is in a public repository.

- Family names, travellers' details, trip destinations and dates, flights, bookings and any detail of
  a real trip never go into the repository: not in this skill, not in a commit message, a test or a
  pull request.
- Data files and rendered pages for real trips live outside the repository. They reach the family
  only as uploads to the private site, after the owner's approval.
- The sample in `kit/example/` is fictional; keep any new sample fictional too.
- Keys are never needed for the map or the weather. A key, if one is ever used, goes only in the
  private trip file, never in this folder.
- Health notes stay general ("ask their clinician about heat and medicines"); the page is a planning
  document, not medical advice.
