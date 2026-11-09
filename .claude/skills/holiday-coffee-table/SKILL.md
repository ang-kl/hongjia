---
name: holiday-coffee-table
description: Use when the family shares a briefing note, document, PDF or picture about a holiday, trip or tour (an itinerary, a booking list, a brochure, a screenshot of plans, a map or a hand-written list of places), or asks for a trip page, a holiday plan or a new version of one. It turns that intention into a super-luxury, interactive "coffee-table" trip page to the standard of the family's v15 page (7 November 2026), built from one private trip data file with the page kit in kit/, checked against the owner's rules, and reviewed by the owner before anything goes on the family site.
---

# Holiday coffee-table pages

Version 3, 8 November 2026: the family's swaps at each stop (Plans B, C and D). Version 2, the same day:
Direction A, "River" (the owner's redesign: "A"). Version 1, 7 November
2026, was rebuilt from the family's v15 trip page, which is the standard every new trip page meets for
content. The owner's words: "create a fresh construct template based on v15 ... I will give you a
briefing note about the next family holiday and you are to do the similar like v15".

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

- **Opener:** the v15 opening screen in today's type (the owner, 8 November 2026: "I prefer the v15
  landing screen", then "v15 layout, today's type"): the photo slideshow fills the screen, with the
  trip's title, the water line, the dates, a countdown and local time and **Play the trip** (the tour)
  on it, and the credit at the top right. Then the trip in three lines, alert chips (a public holiday
  goes here), **Where we stay** cards, **Can't-miss, day by day** (one row per day in date order; a day
  with nothing marked says what the day is; under each day's picks, its Plan B, C and D, one of each
  at most, each with its photo and credit and a "Plan B" link that opens that swap at its stop), and
  the globe from home to the destination. While the tour plays, the family site folds its right-hand buttons into a 🔭.
- **A # link on every place, plan and part** (the owner, 8 November 2026: every key point should have a
  link on an ID, "to share the link, to create jump easily"; they chose "Places, plans and parts"):
  each section, day and Gallery day, each stop, each Plan B, C and D, each Can't-miss day, the
  opening's three parts and every titled part inside a section. A tap shares the family site's full
  address for that point (or offers Copy link); opened, it lands there, and a swap's link opens it.
- **Share and 🤙🏼 everywhere** (the owner, 9 November 2026: "Share replaces #"; "every place has the ability
  to whatsapp for OWNER Account only. emoji is 🤙🏼"; "everyone signed in sees 🤙🏼 but gray off"; "everywhere
  including calendar post"; "Pick a chat each time"): the # is drawn as Share (three joined dots), with 🤙🏼
  beside it on every place, plan and part, every timed calendar card, every booking, every Near here place,
  every Gallery picture and in each place's panel. For the owner's account 🤙🏼 opens WhatsApp's chat picker
  with the part's name, time, address, map link and page link typed in; nothing is sent until they press
  Send. For everyone else it is greyed, and a tap says why.
- **Legend** that lights up places on the page and the map by category (stays, transport, weather,
  food, drinks, snacks, shopping, hair, nails, massage, nature, fun, sights, worship), with **exact emoji, the same on
  every trip** (the owner, 9 November 2026): 💇 hair, 💅 pedicure and nails, 💆 massage, 🛍️ shopping, 🍽️ food,
  🌳 nature (Plan B, hiking and nature, carries 🌳). A salon is `hair`, never `shopping`; a park or a walk is
  `nature`. Hair, nails, massage and nature show in the legend only when the page uses them.
- **Hair, nails and massage** (a day's `services`), shown like meals with their choices, prices, dated Google
  ratings, hours on the dates and the places' own Instagram and TikTok posts; never Google Maps photos copied in
  (they belong to their uploaders): link the place on Google Maps instead.
- **Days**, one article each: the day's photo band, route line with every place linked, badges,
  Plan A stops with 2 to 4 credited photos each, timeline items pointing at their stops, the four
  info boxes (Getting around, Meals, Style & photo moments, Make it easier), the weather swaps
  ("If it rains"; "If it's hot", for heat, wind or storms), **the family's swaps at each stop**
  (Plan B hiking and nature, Plan C shopping, Plan D early or late; see below), nearby extras, "if it's closed or crowded"
  alternatives, the live forecast strip, **Meals** with four choices each (the planned place
  counted), **Taste of the day** and **Shop the day** with that day's trading hours, and Share
  this day.
- **Map centre:** a map per day with lettered pins and the road legs, relayed through the family site.
- **Calendar:** one column per day, an Add for each timed item and Add this day (needs `meta.tz` as `UTC±H`).
- **Before we go** (the owner, 9 November 2026: "if we need to reserve ahead like salon, you need to indicate a
  pre-trip activity"; a template rule for every trip): everything to book ahead (tables, classes, salons,
  coaches, tickets, a booking to cancel) is a `pretrip` item with its book-by date, our own date set early enough,
  with the reason. It is the Calendar's first column, with a reminder to add, and a "Book ahead by …" mark on
  its stop or meal; the page recounts the days left from today each time it opens.
- **Two parts** (the owner, 9 November 2026): the opening screen and its glance, stays and Can't-miss are **Part
  1**; the details start with a deep band, **Part 2 · The plan in detail**, and the trip's title is not repeated.
- **Taste & Shop:** by area, signature tastes, sweet stops, markets on the family's days, shopping,
  what to bring home, the trading-hours table, and Hungry? / Shop nearby.
- **Place panels:** every place name opens a panel in the page (photo and credit, what it is,
  address, hours and photo spot with sources, awards, Show on map, Share, official links, the venue's
  own Instagram).
- **Gallery** (Read / Gallery switch): a mosaic of credited photos and official accounts' posts per
  day, each picture and post once a day, one Facebook link per account a day, posts loaded only on a tap.
- **Share links** (three joined dots) beside every section, day and Gallery day: a tap shares a link to that
  very spot; the date bar follows the day you are reading or looking at.
- **Near here, for every area** (the owner, 9 November 2026; they chose "Each area", "Panel + map
  pins" and "a template rule"): the nearest two hospitals (at least one with a full 24-hour emergency
  department), the nearest airport, two police stations, at least two clinics open on the dates, a
  supermarket, a store open 24 hours or late (7-Eleven or the local equivalent, which differs by state
  and city), a pharmacy, one or two parks, one or two zoos, wildlife parks or aquariums (if none is
  near, the nearest, with its distance) and one or two attractions people built. Each with its
  distance from the area's anchor, its hours on the dates (holidays checked) and its source; shown in
  the area's panel, in the drawer under each stop, and on the map's **Near here** layer.
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
   - **Wikimedia thumbnails** load from `thumb.wikimedia.org`. Wikimedia limits the older
     `upload.wikimedia.org/…/thumb/` address (seven pictures of a real trip came back "too many
     requests" on 8 November 2026), so the kit moves those addresses by itself and `--check` flags any
     left. Before an upload, fetch every picture once, slowly, and fix any that fail.
   - **Social accounts** are only the venue's own, linked from its own website or official listing.
     No chain or brand accounts in place of the venue (the owner: "drop the five brand"). No
     age-restricted accounts (alcohol venues), which do not show to people who are not logged in.
     Facebook is a link only (its embeds do not run in the frame).
   - **"Highest star"** means published awards and guide listings (`awards`), never Google or other
     star ratings in the page. The one exception is where the owner asks for a rating (for example the
     salons on one trip, 8 November 2026): then show it dated, with its review count and where it was read. Say "from the official accounts", not "most popular", unless
     popularity was measured.
   - **A full trip is researched in parts** (8 November 2026): food; shopping and groceries;
     services the family asked for (for example salons); logistics, holidays and the season; places and
     the swaps. Each part writes a sourced JSON in the schema's shape, with a shared brief (the trip, the
     owner's choices, the Plan A stop ids, the rules on sources, photos and words) and its own `notes`.
     One assembly script then builds the data file, so it can be run again. Use one exchange rate for
     every budget, with its source and date.
4. **Build the data file** (`kit/schema.md`), copying the sample's shape: the opener first, then each
   day, each stop, each place, the legs (road distance and time per drive, cited), the forecast
   places, the areas, Taste & Shop, worship near each base, and the prose sections. Every leg needs its
   road route (`path`, for example from OSRM, cited); the kit refuses a leg without one, because the map
   would draw a straight line across the city. Food, snacks and
   shopping matter most to this family. Every meal (breakfast, lunch, dinner) gets four choices open
   on that date (`page.meal_choices: 4`). One photo spot per place, only where an official source
   names one. Route lines and notes link their places with `[[place:key|text]]`.
5. **Render**: `python3 kit/build.py trip.json -o <Trip>-vNN-<dates>.html`.
6. **Check**: `python3 kit/build.py --check <page>.html`, and fix every problem it reports.
7. **Look at it as the family will.** Open the page in a local copy of the family site (a release
   build and a test database) at phone (the site's frame is 357 px wide on an iPhone), iPad and desktop
   widths, and check nothing makes the page wider than the screen (long unbroken words, long link
   labels: `--check` flags link labels over 28 characters): the tour, the Gallery, the
   Calendar, a # link, Share, the map and the forecast. Send the owner the page and screenshots.
8. **The owner's approval.** Nothing goes on hongjia.org until the owner writes
   "APPROVE upload <Trip> vNN". A new trip is filed as a new document; a revision is filed as the
   next version of the trip's document, after checking the version count first. Sign in with the
   family password from the environment only, and sign out after every live check.
9. **Live check** after uploading: the version tag in the header, the map pictures through the site,
   the forecast, a place panel, Share, a # link, the Gallery and the Calendar. With the family's swaps,
   also: a "Plan B" under Can't-miss opens its swap in view (then close it again, so no choice is left
   on the owner's profile), a stop's # gives the full address (Copy link), and a swap's own address
   opens it. Look at the opening screen and the data pins on an iPad and a phone, then sign out.
10. **Keep the data file safe** (the owner, 7 November 2026: "Attach it on hongjia.org"). The data
    file is private and lives outside the repository. After the owner's APPROVE for it, attach it to
    the trip's document on the family site as a `.txt` file (visible to signed-in family only), so
    the next version can start from it in a new session.
    - **Where the pin goes** (the owner, 8 and 9 November 2026): on the opening photo, pinned to the
      photo itself, at a spot **measured on that page**: clear of the title, the dates, the buttons, the
      photo credit and the site's ☰ and 🔭 at the site's phone frame (357 px wide), an iPad and a wide
      screen. A pin keeps its place as a share of what it is pinned to, so one spot does not suit every
      page: one trip's short title left room below the buttons (about 30% across, 86% down), while
      another's title ran to three lines on a phone and the clear spot was between the credit and the
      title (about 30% across, 12% down). Older data pins go under the newest. Show the owner the spot (a preview at
      iPad and phone size) unless they say to just attach, and check it on both after.

## Versions

- The file name carries the version: `…-v15-…html`. The site shows it in the header as
  "filing number · v.15 title", from the file name (or the site's own version count if the name has none).
- The page's edition line says the same: "Coffee Table edition v15 · <date>".
- Each version's changes are the owner's decisions, recorded in the private data-making script with
  the owner's words, never in this public folder.

## Quality bar

The owner wants both the look and the content to be super-luxury and to "wow".

- **Look:** Direction A, "River". The family's name, 洪, means "flood; big, vast" and is written
  with the water element, so one fine water line is the only ornament (under the trip's title) and
  the river teal is the one colour. Text sits on paper; the one exception is the opening screen,
  where the title sits on the full-screen photo with the v15 soft shade (the owner's choice). The site's two
  typefaces (Source Serif 4 for headings, Source Sans 3 for everything else), four heading sizes
  that differ at a glance (the trip's title, sections, days, places), labels in plain words (no
  capitals, no labels above section titles), photos above their words with the credit under the
  picture, at most four cards a row, the whole width of the screen with prose kept to a readable
  line, nothing wider than a 390 px phone. Do not restyle it; extend it. Nothing floats in or
  breathes on scroll; movement is only what the reader asked for (the tour, a map flight, a panel)
  and stops under reduced motion. Accessibility stays: 44 px targets, keyboard use, screen-reader
  labels, print mode.
- **Content:** a concierge's knowledge, not a brochure's. Each stop says why it is there, the best
  time, the photo moments, the easier version and what is nearby. Real distances and road times with
  buffers. Honest limits: "proposed, not booked", "estimate, not a quote". No filler, no unverified
  superlatives.
- **Pace:** one principal outing a day, rest built in, seated meals; transfer days are transfer
  days with one real midway break; "swap, don't stack": a backup replaces a stop, it is never added.

## Writing: the family, plainly

The owner chose "The family, plainly" (8 November 2026): the page reads as the family talking to
itself, not as a brochure.

- "We", plain words, short sentences, one idea each. Facts first: the time, the place, the distance,
  what to book. A number or a name beats an adjective.
- Labels say what they are in the family's words: "Where we stay", "Can't-miss, day by day".
- No pet words or inflated descriptors ("delve", "captivating", "rich heritage", "stunning",
  "nestled", "hidden gem", "curated", "iconic" and the like). A venue's own name or its own words in
  quotation marks are fine.
- No "It's not X, it's Y", "not just X but Y" or "more than just". Say what the thing is.
- No line that could sit on any other family's trip page unchanged. Each sentence is about this
  place, this day and these people.
- `--check` fails a page with these words or framings ("wording that reads as AI"). Fix the words;
  never weaken the check.

## The owner's checklist of AI tells, and how a page answers it

The owner asked (8 November 2026) to remove every "AI effect" in this list. A page passes only if it
answers each one.

| Tell (the owner's list) | How the page answers it |
| --- | --- |
| Layer 1: dark gradient hero | The owner chose the v15 full-screen photo for the opening (8 November 2026). Its soft shade is the only one on the page, and its words are in today's type and plain lettering. |
| Layer 1: dotted eyebrow headings | No label above a section's title; the title says it. A line above a day's or a card's title only when it carries facts (the date and route), in plain words, never capitals. |
| Layer 1: uniform float-up animations | Nothing moves on scroll. |
| Layer 1: pet words, inflated prose | The writing rules above, and `--check`. |
| Layer 1: "It's not X, it's Y", hollow polish | The writing rules above, and `--check`. |
| Layer 2: disconnected sections | One water line and one teal across the page; Can't-miss rows lead to their days; every place name opens the same panel. |
| Layer 2: unintentional whitespace | Related things sit together; a day with one pick lays its card on its side; the whole width is used. |
| Layer 2: flattened type hierarchy | Four heading sizes that differ at a glance. |
| Layer 2: generic wireframes | The trip's own structure: days, bases, plans for rain and heat, the family's meals. |
| Layer 3: literal or absent symbolism | The water line from the family's name, 洪. |
| Layer 3: incoherent writing | Plain sentences about real things; read every line aloud once. |
| Layer 3: no human presence | The family's own words and choices, real places with credited photos, the owner's decisions recorded in the data-making script. |

The 30-second test (the owner's): scroll from top to bottom and ask of every choice, crop and
sentence, "Could this exist for only this family's trip?" Change anything that answers no.

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

## Plan A, the weather swaps, and the family's swaps

- **Plan A** is the day as written.
- **The weather swaps** (data keys `plan_b` and `plan_c`) go by their words, never a letter: **If it
  rains** (covered, indoor, close to the base) and **If it's hot** (heat, strong wind or storms:
  cooler, sheltered, shorter, earlier). Each names what it replaces and is researched and sourced like
  Plan A. The rules ("rain 60%+ → ☔ If it rains") are in the data file and on the page; the first
  matching rule decides the suggestion. The forecast highlights; it never hides.
- **The family's swaps at each stop** (the owner, 8 November 2026): **Plan B** hiking and nature,
  **Plan C** shopping, **Plan D** very early, night or overnight. At every Plan A stop where they make
  sense; none at an airport or a check-in. Choosing B and C at once means the family splits up and
  meets again: every swap says when and where (`meet`).
  - The owner's rules so far (ask again for another trip): with one car, the car goes with the
    shoppers, so a Plan B walk is reachable on foot or by taxi; with rideshare only (no car), each group
    books its own ride, and every ride shows its time and an estimated fare ("estimate, not a quote",
    with the method); someone walking alone gets only short,
    busy, well-marked walks, each with a check-in time; Plan D never drives country roads at dusk or at
    night. "Well-marked" includes a formed path with information signs. A walk with no waymarkers stays
    only when it is flat and busy and the owner agrees: its `trail` says `marked: false`, so the page
    shows "not marked", with a check-in time (the owner, 8 November 2026). Ask the owner about every
    walk taken alone before the upload. Who each swap is for goes in the private data file (`plans.family`), never in this folder.
  - Every swap is a researched place with its own photo, credit, links, hours on that date (public
    holidays checked) and, for a walk, its `trail` facts with their source. Where nothing fits, the
    stop has no swap for that plan: never force one.
  - A day runs from the normal 8am to 8pm, to about 18 hours, or overnight (out late, back to that
    night's base). Give swaps clock `start` and `end` times so the Calendar shows them and stretches
    the day when they are chosen.

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
