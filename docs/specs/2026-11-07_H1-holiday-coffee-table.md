# H1: Holiday coffee-table template

Version 1, 7 November 2026. Replaces the first travel template and its notes (T1, 6 to 7 November 2026), which
the owner asked to remove. Trip details stay out of this public repository, so the family's current trip is
called "v15" here.

## Owner requests and decisions

- **Request (7 November 2026):** "now remove the old template that i mentioned yesterday about itinerary/travel
  and create a fresh construct template based on v15. because i will give you a briefing note about the next
  family holiday and you are to do the similar like v15 / ask me till you understood".
- **Decisions, from the questions asked:**
  - Which template: the travel skill in the repository (instructions, page-building engine, sample, checklists).
  - How: "Delete all, rebuild new". The old folder is deleted; the new one, `.claude/skills/holiday-coffee-table/`,
    carries the same engine as v15 (only its generator tag renamed), with new instructions, sample, checklists and tests.
  - Where: in the repository, with every real trip detail stripped.
  - Contents: "Everything v15 has".
  - Name: `holiday-coffee-table`.
  - Sample: a made-up trip shaped like v15.
  - Old notes: "Remove them too" (T1 is deleted; these notes replace it).
  - Kinds of trip: "Rebuild them from v15".
  - Keeping a trip's private data file: "Attach it on hongjia.org", as a `.txt` attachment on the trip's document,
    after the owner's APPROVE for each upload.
- **Earlier decisions carried forward** (from T1, 6 and 7 November 2026):
  - "Super-luxury" and "wow" mean both the look and the content.
  - The document's owner decides whether a page is for one travelling group (`party`) or switchable kinds of
    traveller (`lenses`).
  - Weather from free Open-Meteo, through the site. Map pictures through the site ("server map").
  - A place panel inside the page rather than new windows; "link only" when a day or part is shared.
  - Instagram first for stays, worship and main stops; one photo spot per place, from official sources only.
  - "Food for meals should have 4 choices each": every meal, the planned place counted.
  - Food, snacks and shopping matter most: Taste & Shop, awards instead of star ratings, a Gallery of official
    accounts' posts. Live Google picks: "Later".
  - The Calendar: one column per day, Add for each timed item and for the day, through the site's `/calendar.ics`.
  - The tour folds the site's right-hand buttons into a 🔭; the plain "Near me" button is removed; "Hungry?" and
    "Shop nearby" stay.
  - A # link beside every section, day and Gallery day; the Gallery shows each picture and post once a day; the
    date bar follows the day being read or looked at.
  - No brand or chain accounts in place of a venue's own; no age-restricted accounts.

## The template (`.claude/skills/holiday-coffee-table/`)

- **`SKILL.md`:** when to use it (a briefing note or upload whose intention is a holiday or trip), what v15 has so
  every page has it, the workflow (intake and questions, the owner's choices, sourced research, the data file,
  render, check, a look in a local copy of the site, the owner's APPROVE, the live check, keeping the data file),
  versions, the quality bar, the page's limits, the site's services, Plan A/B/C, and privacy.
- **`kit/build.py`** (Python 3 standard library only) renders one data file into one self-contained page and checks
  pages (`--check`): no blank picture holders, a credit on every photo, a source for every fact, no plain `http://`,
  addresses on Google Maps, social links on their own platforms, four choices per meal where asked. Text from the
  data file is escaped; rich fields allow only a short list of tokens.
- **`kit/assets/kit.js`** builds the page with `textContent`, never `innerHTML`, and talks to the site only by
  messages; **`kit/assets/kit.css`** is the Atelier design.
- **`kit/example/trip.json`:** a made-up eight-day trip (Example Bay and Example Ridge), shaped like v15: two bases,
  two transfer days with a midway break, three meals a day with four choices, Taste & Shop for both areas, posts
  for the Gallery, a holiday alert, places of worship near both bases. Its pictures are CC0 illustrations made for it.
- **`kit/schema.md`:** every field of the data file.
- **`reference/subtypes.md`:** "Every trip (the v15 standard)", road trip and countryside (complete, proven on v15),
  and starters for city and culture, nature and wildlife, food and wine, cruise, faith and heritage, young family,
  gentle travel for seniors, and celebration.
- **Proof:** v15's private data file, rendered by the new template, gives the page now on the site, byte for byte,
  apart from the renamed generator tag.

## The site's services for trip pages

A trip page runs in the site's locked frame (an opaque origin: no same-origin access, no downloads, scripts only
from four pinned CDNs). It talks to the site by `postMessage`, and the site checks every field.

- **Weather:** the page names up to 12 places (key, latitude, longitude, first and last date) in `hj:weather-want`.
  The signed-in server asks Open-Meteo once per place, with coordinates rounded to two decimals, cut to the forecast
  window (yesterday to 15 days ahead), keeps answers for an hour (up to 500), at most 60 calls a minute, and passes on
  only the daily readings within plausible ranges. Further ahead the answer is `available: false` with the day the
  forecast first reaches the trip; after the trip, `past: true`; in both cases Open-Meteo is not asked. Setting:
  `HONGJIA_WEATHER_URL` (plain http only off Railway, for the tests).
- **Map pictures:** OpenStreetMap refuses requests without a Referer, and the locked frame sends none. The page sends
  `hj:tiles-want`; the site answers `hj:tiles` with a 12-hour ticket signed with its internal key; tiles load from
  `/tiles/{z}/{x}/{y}.png?t=ticket`. The relay identifies itself ("hongjia.org family site map relay
  (+https://hongjia.org/privacy)", Referer `https://hongjia.org/`), keeps each tile at least 7 days (at most 3,000),
  makes at most 120 requests a minute, never prefetches, serves a stale copy if OpenStreetMap is down, and sends
  `Cross-Origin-Resource-Policy: cross-origin`. The page shows "© OpenStreetMap contributors". Setting:
  `HONGJIA_TILES_URL`. Open point for the owner: OpenStreetMap asks for a contactable User-Agent; a contact email
  would follow its policy more closely, if the owner agrees to publish one.
- **Share:** `hj:share-want` shares a place (its name, a line and an https link) or the document by its address on the
  site only, optionally with a part name after a # (a letter, then up to 60 letters, digits, `_` or `-`). The site
  opens the device's share menu, or offers Share or Copy link in its own bar. A # that names nothing on the site's own
  page is passed to the frame, so a shared link opens at that part.
- **Hungry? and Shop nearby:** `hj:near-want` names up to 200 places. The site asks the person in its own words, takes
  one low-accuracy reading on the device, and answers `hj:near` with the 20 nearest keys and distances to the nearest
  half kilometre. Coordinates never go into the frame or to the server.
- **The tour:** `hj:tour` (open or closed) folds the site's right-hand buttons into the 🔭 while the tour is open.
- **Add to calendar:** `/calendar.ics` (signed-in only) turns the event or events in the link into an RFC 5545 file
  (escaped text, lines folded at 75 bytes, stable identifiers, times as UTC), linking back only to trip-page paths.
  Nothing is stored.
- **Privacy page:** names Open-Meteo, OpenStreetMap, Instagram and TikTok panels and posts, Hungry? and Shop nearby,
  and what a calendar link holds.

## Outside services (decision record, facts checked 5 November 2026)

| Service | Decision | Why |
|---|---|---|
| Claude API | Phase 2, the only AI | Reads PDFs and pictures; would run the same template; needs the owner's APPROVE for an account, a key and a spend limit, and a privacy line |
| Open-Meteo | Weather | Free for private, non-commercial sites, with no key; 16-day forecast; CC BY 4.0 |
| Google Weather API | Backup, not used | Needs billing, a key and Google's attribution |
| Google Places API (New) | No | Ratings must be fetched live with Google's attribution and may not be stored or shown with a non-Google map |
| OpenAI API or Codex | No, at runtime | A second AI would add keys, bills and failure points with no new capability |
| X.com API | No; links only | Pay per use, with no free tier for new developers |
| Bureau of Meteorology | No | No public forecast API; feeds are for personal use |

**Phase 2 (not started):** the site would build a trip page from an upload itself, with the Claude API.

## Privacy

- No family names, travellers' details, destinations, dates, flights or bookings in the repository: not in the
  template, a commit message, a test or a pull request.
- Real trip data files and pages live outside the repository, reach the family only as uploads to the private site
  after the owner's approval, and are kept as private attachments on the trip's document.

## Checks

- **Template tests** (`kit/test_kit.py`, 51, run by the GitHub checks in the browser-js job): every component on the
  sample, the data rules, escaping, no `innerHTML`, pinned libraries and page weight, credits on every picture, both
  audience modes, the map relay protocol in a browser, the place panel, Taste & Shop, awards, the Gallery (each picture
  and post once a day, one Facebook link per account a day), the Calendar, the tour message, # links, and the date bar
  in the Gallery and in reading, at desktop and phone widths.
- **Site tests:** the message checks (`web/test/doc-view.test.mjs`), the weather, tiles and calendar unit and
  database tests, and the release browser walk (`tests/browser/p1-flow.mjs`), unchanged by this replacement.
- **This replacement:** the template's tests pass on the new sample; v15's data renders to the page on the site apart
  from the generator tag.

## Amendment, 8 November 2026: Direction A, "River", and the family's plain voice

**The owner's request:** "'Where you'll stay' & 'Can't-miss' - should better design layout ... have max 4 per row.
'Can't-miss' should be separate by date", "The font size in the whole website is a big issue", and "remove all these
'AI' effect" from their checklist (Layers 1 to 3 and the 30-second test). They chose a look built on the family's name
洪, the voice "The family, plainly", Can't-miss "A row per day", and Direction "A" from three clickable drafts.

**The template now:**
- **Look:** the family's name, 洪, means "flood; big, vast" and is written with the water element, so one fine water
  line under the trip's title is the only ornament and a river teal the one colour. The opening is light: the title
  and dates on paper beside the photo, its credit under it. The site's two typefaces (Source Serif 4, Source Sans 3).
  Four heading sizes that differ at a glance: 48, 32, 24 and 18 px on a wide screen (36, 26, 20 and 18 on a phone),
  text 17 px. Labels in plain words, never capitals. No label above a section's title. The whole width, prose at a
  readable line, at most four cards a row. A day's photo sits above its words, never behind them.
- **Where we stay** and **Can't-miss, day by day:** cards with the words under the photo. Can't-miss has one row per
  day in date order, each pick under the day whose plan has it (Plan A first, then B and C); a day with one pick lays
  its card on its side, and a day with none says what the day is. A pick on no day's plan is refused when the page is
  built.
- **No motion on scroll:** nothing floats in and no photo breathes; the photo viewer's Escape no longer reaches the
  family site.
- **Writing:** SKILL.md sets the family's plain voice and maps each item of the owner's checklist to how a page answers
  it. `--check` now fails a page with a pet word or inflated descriptor, or "It's not X, it's Y", "not just X but Y" or
  "more than just" (place names and a venue's quoted words are not read).
- **Tests:** 55 (four new: Can't-miss by day, no labels above section titles, the wording check, and the type and
  fonts). Older data files still render; their `kicker` fields are read but not shown.

## Amendment, 8 November 2026: the family's swaps at each stop (Plans B, C and D)

**The owner's request:** "how about Plan B be built as well. for each day each period ... hiking and nature. And able to
swap ... shopping as Plan C. similar for the night and super earlier morning or overnight as Plan D". Their choices: keep
the weather swaps; a swap at every stop; split up and meet; one car goes with the shoppers; a walk may be done alone
(short, busy, well marked, with a check-in); Plan D per stop; the template first, then the trip.

**The template now:**
- **The weather swaps** keep their data keys (`plan_b`, `plan_c`) but go by their words and an icon: ☔ "If it rains"
  and ☀️ "If it's hot". The rules read "rain 60%+ → ☔ If it rains"; an older rule ending "→ B" reads the same.
- **The family's swaps at a stop:** a Plan A item may carry `swaps` for B (hiking and nature 🥾), C (shopping 🛍️) and
  D (early or late 🌙). Each is a button under the stop's name; each opens its own panel with the place's photo and credit,
  its line, a walk's facts (`trail`: length, time, grade, marked, busy, shade, toilets, phone, with their source), when,
  getting there, a check-in time and where and when the family meets again. B and C open together when the family splits.
  The choice is remembered on the device; the day's map shows the chosen places as dashed pins with their letter; the
  timeline says "Swapped: B, C"; a place used only as a swap opens that swap from its panel or a # link.
- **Checks:** a swap names a known stop that is not the stop itself; `meet` needs a time and a place; a walk's `trail`
  needs a number of km, a grade and a source.
- **Tests:** 58 (three new: the swaps' markup and data, their checks, and a browser run at 1180 and 390 px: open B and C,
  the timeline note, the two pins, remembered after a reload, undone, and opened from a # link).
- Who each swap is for, and the owner's rules for a particular family, stay in the private data file.
- **The Calendar stretches to fit** (the owner: a day can run from the normal 8am to 8pm, to about 18 hours, or overnight; they
  chose "Stretch to fit" and overnight as "out late, sleep at base"): each day shows at least 08:00 to 20:00 and Plan A's
  own hours; a chosen swap with clock `start` and `end` times appears as a dashed card and stretches the day earlier,
  later or past midnight, with its own Add to calendar. A day with more than two cards side by side gets a wider column.
- **The v15 opening screen, in today's type** (the owner: "I prefer the v15 landing screen as the landing"; they chose
  "v15 layout, today's type"): the photo fills the first screen and the title, dates, countdown, local time and buttons
  sit on it, centred, with the v15 soft shade so they stay readable and the credit at the top right. The words keep
  Source Serif 4 and Source Sans 3 and plain lettering (no small-capitals line, no capital-letter buttons); the photos
  stay still, and the one water line sits under the title in white. This is the one place where words sit on a photo.
- **Plan B, C and D under Can't-miss** (the owner: "the 'Can't-miss, day by day' should include Plan B, Plan C, Plan D
  picture with the hyperlink 'Plan B' etc."; they chose one of each a day, and a link that goes to the stop and opens the
  swap): under each day's picks, at most one Plan B, one Plan C and one Plan D, a Can't-miss stop's own first, then the
  day's order. Each shows the swap's photo and credit, a "Plan B" link and the place's name; the link opens that swap at
  its stop, as the stop's own button does, so it is remembered on the device and shown on the map and in the Calendar.
- **The shade stays** (the owner, 8 November 2026: "Keep the shade as it is"): the v15 soft shade under the opening's
  words is kept as it is.
- **A # link on every place, plan and part** (the owner: "every key points should have either: Placing Hyperlinks on the
  Anchor Element (<a>); Placing Hyperlinks with Flexible Paths (Relative vs. Absolute Links); Placing Hyperlinks on an
  ID (In-Page / Jump / Anchor Links). These can help humans to share the link, to create jump easily"; they chose
  "Places, plans and parts"). Besides the sections, days and Gallery days, each stop, each Plan B, C and D, each
  Can't-miss day, the opening's three parts and every titled part inside a section has its own ID and a small # link
  (an `<a>`) beside its title. In the page the link is relative (`#d1-harbour`); a tap on the family site shares the
  full address of that point (`https://` the site, the document, `#d1-harbour`), or offers Copy link, and opening
  it after signing in lands on the point. A swap's address also opens the swap. A titled part's ID is `p-` and its
  title in plain letters, so it lasts as long as the title does.
- **The afternoon's lessons** (the owner, 8 November 2026: "update the template"; they chose all four):
  - Wikimedia thumbnails load from `thumb.wikimedia.org`: the kit moves `upload.wikimedia.org/…/thumb/` addresses there
    by itself (Wikimedia limits the older address), and `--check` flags any left.
  - The trip's data file is pinned on the lower part of the opening photo, older data pins under it, shown to the owner
    first: a pin beside a heading that fits on an iPad covers the words or the # on a phone.
  - The walk rules: a formed path with information signs counts as well-marked; a walk with no waymarkers stays only
    when flat, busy and agreed by the owner, shown as "not marked", with a check-in.
  - The live check also opens a swap from Can't-miss, copies a stop's # address, opens a swap's own address, and looks
    at the opening screen and the data pins on an iPad and a phone.
- **The second trip's lessons** (the owner, 9 November 2026: "update the template"; they chose all four):
  - The data pin's spot is measured on each page, clear of every word and button at the site's phone frame, an iPad
    and a wide screen; a longer title moves the buttons, so one fixed spot does not suit every page.
  - Phone fit: Commons file names show with spaces in the credits (so they wrap), the credits and sources lists may
    break long words, and `--check` flags a link chip's label over 28 characters.
  - Every map leg needs its road route (`path`); the kit refuses a leg without one.
  - The instructions add rideshare-only trips (each group books its own ride, with an estimated fare), a rating
    only where the owner asks for one (dated, with its count), and research in parts with one assembly script.
- **Near here, for every area** (the owner, 9 November 2026; they chose "Each area", "Panel + map pins", "a template
  rule" and "merge when green"):
  - Each area lists its essentials: two hospitals (at least one with a full 24-hour emergency department), the nearest
    airport, two police stations, at least two clinics open on the dates, a supermarket, a store open 24 hours or late
    (the local chain for that state or city), a pharmacy, one or two parks, one or two zoos, wildlife parks or aquariums,
    and one or two attractions people built; each with its distance from the area's anchor, its hours on the dates and
    its source.
  - They show in the area's full panel (emergency first), as one short line each in the drawer under every stop in
    the area, and on the map's own Near here layer (each place once).
  - The kit refuses an essential without a known source or coordinates, an unknown kind, and, once one area has its
    essentials, any area missing one of them.
