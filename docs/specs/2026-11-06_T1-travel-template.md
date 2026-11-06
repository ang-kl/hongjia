# T1: Travel template, Phase 1

Version 2, 6 November 2026. Follows the owner's requests of 6 November 2026. Trip details stay out of this public repository, so the owner's words name the trip as [the trip].

## Owner requests and decisions

- **Request:** "Next reflect the itinerary HTML file for [the trip], it has many elements which I want to create a template that each time a document or PDF or picture and the context or intention is a tour or related, it will expand into an interactive super-luxury super-rich with plan-b, plan-c (weather) webpages that wow different demographics (criteria) setup. These are skill template specify for such travel. It can also spawn into different sub-cateogry travel template."
- **Question:** "As well as this hongjia engine can include other web-tools and engine and API and connectors and skill generate, whether we should have other google API or Claude or CODEX API or x.com, you have to let me know"
- **Decisions:**
  - "what "super-luxury" and "wow" should mean both." Both the look and the content.
  - "owner of the document decide: whether each page is for one travelling group or lets you switch between kinds of traveller". Each trip's data file says which.
  - "proposed version 6 of [the trip]". The first trip is rebuilt on the kit as a draft for the owner's review before it is filed.
  - "proceed with Phase 1 now, using free Open-Meteo for the weather."

## Phases

- **Phase 1 (this work):**
  1. Weather for trip pages (the site change below).
  2. The travel skill and page kit in `.claude/skills/travel-coffee-table/`, with generic content only.
  3. The first trip rebuilt on the kit, kept outside the repository and reviewed by the owner before upload.
- **Phase 2 (not started):** the site would build a trip page from an upload itself, with the Claude API. It needs the owner's APPROVE for an Anthropic account, an API key stored in Railway, and a spend limit. It also needs a privacy line, because trip documents would be sent to Anthropic.

## Outside services (decision record, facts checked 5 November 2026)

| Service | Decision | Why |
|---|---|---|
| Claude API | Phase 2, the only AI | Reads PDFs and pictures; web search at US$10 per 1,000 searches, web fetch at no extra cost beyond tokens; runs the same skill through custom Agent Skills |
| Open-Meteo | Phase 1, weather | Free for private, non-commercial sites, with no key; 16-day forecast; CC BY 4.0; worldwide models only for Australia |
| Google Weather API | Backup, not used | 10-day forecast and alerts; 10,000 free calls a month, then US$0.15 per 1,000; needs billing, a key and Google's attribution |
| Google Places API (New) | No | Opening hours and ratings cost US$20 per 1,000; photos cannot be stored and must be fetched live; requires public terms and a privacy policy that include Google's |
| OpenAI API or Codex | No, at runtime | Codex is a coding product (it already reviews pull requests here); a second AI would add keys, bills and failure points with no new capability |
| X.com API | No; links only | Pay per use, with no free tier for new developers; embedding a post needs no key but would need a sandbox test and the owner's approval, as Instagram and TikTok did |
| Bureau of Meteorology | No | No public forecast API; feeds are for personal use, and scraping is not allowed |

## Weather for trip pages

- **Flow:**
  1. A trip page names up to 12 places, each with a key, latitude, longitude and the trip's first and last dates there. It sends `hj:weather-want` to the document page.
  2. The document page checks the message. The key must match `[a-z0-9-]`, up to 30 characters, with no repeats; latitude and longitude must be numbers in range; dates must be `YYYY-MM-DD`, with the end not before the start.
  3. It asks `GET /api/weather` once per place for each load of the document.
  4. The answer goes back into the frame as `hj:weather`.
- **Server:**
  - Only signed-in people may ask.
  - The ask is checked again. Coordinates are rounded to two decimals (about 1 km), dates must be real dates, and an ask covers at most 60 days.
  - The trip is cut to the forecast window, from yesterday to 15 days ahead.
  - Open-Meteo is asked for the daily weather code, maximum and minimum temperature, rain chance, rain total, wind, gusts and UV, in the place's own time zone.
  - Only those readings are passed on, each within a plausible range, otherwise null. Nothing else in Open-Meteo's answer reaches the page.
  - Answers are kept for an hour, up to 500 of them.
  - The server makes at most 60 calls a minute (Open-Meteo allows 600). Each call has an 8-second limit and a 64 KB answer limit.
- **Outside the window:**
  - A trip further ahead gets `available: false` and the day the forecast first reaches it.
  - A trip that is over gets `past: true`.
  - In both cases Open-Meteo is not asked.
- **Privacy:** family devices never contact Open-Meteo, and nothing about the person, the device or the document is sent. The "What we collect" page says so and credits Open-Meteo.
- **Libraries:** `ureq` 3 with `rustls` (the `ring` provider) and bundled `webpki-roots` makes the HTTPS call, and `serde_json` reads the answer. The server had no HTTP client before. This adds 24 crates.
- **Setting:** `HONGJIA_WEATHER_URL` defaults to `https://api.open-meteo.com`. Plain `http://` is accepted only off Railway, for the tests' stand-in service.
- **Licence:** the kit shows "Weather data by Open-Meteo.com", with a link, next to the data.

## Checks

- **Unit tests:**
  - strict dates and the round trip;
  - asks checked and rounded;
  - the forecast window (open, later, past);
  - only plausible readings passed on;
  - the outgoing address carrying only rounded places and dates;
  - the weather setting, including that plain http is refused on Railway.
- **Database test:** run against a stand-in Open-Meteo.
  - Strangers get 401.
  - A signed-in member gets the forecast with the credit, and the stand-in saw only rounded coordinates and the dates.
  - A second ask is answered from the hour's copy.
  - Trips too far ahead or already over get no call.
  - A bad ask gets 400.
  - The privacy page names Open-Meteo.
- **Page tests:** `hj:weather-want` accepts a good ask and refuses wrong keys, repeats, too many places, bad numbers and bad dates. The page never accepts `hj:weather` from the frame.
- **Browser check:** a sample trip page asks for two places. The near one gets the stand-in's forecast through the server; the far one gets the day its forecast starts. The stand-in is asked once, with rounded coordinates.

## Travel skill and page kit

The skill and kit live in `.claude/skills/travel-coffee-table/`, so a Claude session working on this repository finds the skill. Everything there is generic. Data files for real trips live outside the repository.

- **`SKILL.md`** covers:
  - when to use it: an upload whose intention is a trip or tour;
  - the workflow: intake, then the owner's choices (audience mode, luxury level, sub-type), research with every fact sourced, the data file, the render, `--check`, the owner's review, and only then filing as a new version;
  - the quality bar ("super-luxury" and "wow" in both look and content), Plan A/B/C, the weather protocol, and the privacy rules.
- **`kit/build.py`** (Python 3 standard library only) renders one data file into one self-contained page in the approved coffee-table design. `--check` refuses blank picture holders, photos without a credit, facts without a source, and plain `http://` links. Text from the data file is escaped, and rich fields allow only a short list of tokens.
- **`kit/assets/kit.js`** builds the page's behaviour with `textContent`, never `innerHTML`, and makes no network calls. It sends `hj:weather-want` only inside a frame, and accepts `hj:weather` only from the parent window.
- **Plan A/B/C:** each day has Plan A (its stops) and may list Plan B (rain) and Plan C (heat, wind or storm). The rules come from the data file. Inside the forecast window the page highlights the plan the rules suggest, and never hides the others. Before that, it shows "Forecast from" a date, with the rules.
- **Audience:** the document's owner chooses `party` (one travelling group) or `lenses` (switchable kinds of traveller, using stop suitability marks such as step-free, walking, shade, seating, toilets, children and seniors).
- **Upgrades:** an optional section of luxury upgrades per area, each with its price as sourced and how far ahead to book. Upgrades never replace the plan.
- **`kit/schema.md`** documents every field. **`kit/example/trip.json`** is a fictional two-day trip that uses every component.
- **`reference/subtypes.md`** has a complete checklist for road trip and countryside, and shorter ones for city and culture, nature and wildlife, food and wine, cruise, faith and heritage, young family, gentle travel for seniors, and celebration.
- **Checks:** `kit/test_kit.py` has 17 tests and runs in CI, in the browser-js job. It builds the example and checks every component, the weather places, the allowed script sources, that `innerHTML` is never used with data, that no photo slot is empty, that every photo has a credit, and both audience modes.

## Follow-up T2: map pictures through the site (6 November 2026)

- **Why:**
  - Live, the route map showed "Access blocked". OpenStreetMap's tile servers refuse requests without a Referer, and a page in the site's locked frame (an opaque origin) never sends one. A local test confirmed this: 12 of 12 tile requests went out with no Referer.
  - The owner weighed a free CARTO key, which needs a sign-up, and Google, which needs a Google Cloud account with billing for a custom map. The owner chose "server map".
- **OpenStreetMap's tile usage policy** (operations.osmfoundation.org/policies/tiles, read 6 November 2026):
  - It "generally" does not recommend a caching relay.
  - A relay must send a clear, contactable User-Agent identifying the service, must not strip the Referer, and must honour caching headers or "cache each tile for at least 7 days".
  - Bulk downloading and offline use are not allowed.
  - The credit "© OpenStreetMap contributors" must be clearly on the map.
- **Design:**
  1. The trip page sends `hj:tiles-want`.
  2. The document page asks `GET /api/tile-ticket` (signed-in people only) and passes `hj:tiles` back into the frame, with the tile base and a ticket. The ticket lasts 12 hours, is signed with the site's internal key, and opens map tiles only.
  3. The page loads `/tiles/{z}/{x}/{y}.png?t=ticket`. The frame cannot send the sign-in cookie, so the ticket is what admits it.
- **The server:**
  - It checks the address (zoom 0 to 19, inside the grid) and the ticket.
  - It serves the tile from the `map_tiles` table if it is still within its keeping time. Otherwise it fetches the tile once from OpenStreetMap, with the User-Agent "hongjia.org family site map relay (+https://hongjia.org/privacy)" and the Referer `https://hongjia.org/`.
  - It keeps each tile for at least 7 days, or longer if the caching headers say so, and keeps at most 3,000 tiles, dropping the oldest first.
  - It makes at most 120 requests a minute and two at a time, never prefetches, and serves a stale copy if OpenStreetMap is unreachable.
  - Tiles are served with `Cross-Origin-Resource-Policy: cross-origin`, so the locked frame can show them.
- **Privacy:**
  - Family devices never contact OpenStreetMap. Only tile addresses leave the server.
  - The "What we collect" page says so and credits OpenStreetMap.
- **Setting:** `HONGJIA_TILES_URL` defaults to `https://tile.openstreetmap.org`. Plain http is accepted only off Railway, for the tests' stand-in.
- **Open point for the owner:** OpenStreetMap asks for a contactable User-Agent. The relay names the site and its public privacy page; adding a contact email would follow the policy more closely, if the owner agrees to publish one.
- **Checks:**
  - **Unit tests:** ticket signing and expiry; tile addresses; tiles kept for at least a week.
  - **Database test, against a stand-in tile server:**
    - a ticket only for signed-in people;
    - 403 without a ticket or with a forged one, and 404 beyond zoom 19;
    - the tile served with the cross-origin header, with the User-Agent and Referer as designed and no cookie;
    - a second request served from the database;
    - the tile kept for at least 7 days although the header said an hour;
    - the privacy page updated.
  - **Page tests:** `hj:tiles-want` is accepted with no other fields, and `hj:tiles` is never accepted from the frame.
  - **Browser check:** a trip page receives the ticket; the tile is fetched once and then kept; the headers are as designed.

## Follow-up T3: places in the page, Share, Near me and the Atelier look (6 November 2026)

- **Owner requests and decisions:**
  - "incorporate more IG links … rather than open windows and hard to go back especially tablet or phone. think UI.UX" Decision: option A, a place panel inside the page.
  - "critic" of the Geolocation API. Decision: "near me yes".
  - "incorporate Web Animations API (WAAPI) and Web Share API". Decision for a day: "link only".
  - Instagram first for "stays worship main stops".
  - "sub-header like "MAKE IT EASIER" should be larger font size".
  - A route line such as "[place] → [place]" should link both places.
  - "each place should list top IG place to take photo". Decision: one spot per place, from official sources only.
  - "Food for meals should have 4 choices each". Decision: every meal, four in total, the planned place counted.
  - A "wow" feeling like a luxury travel atelier, "without reducing any of the content".
- **Place panel (kit):**
  - Every place name is underlined and opens one panel in the page: from the bottom on a phone (drag down to close), from the right on wider screens.
  - It shows the photo with its credit, what the place is, address, hours and photo spot with their sources, Show on map and Share, then the outside links marked ↗, and the venue's own Instagram posts, loaded only when it opens.
  - Escape, × or a tap outside closes it, and focus returns to the name that opened it.
  - `[[place:key|text]]` links a place from any rich text, including the day's route line; stay cards may name their place.
- **Meals and photo spots (kit):** `days[].meals` lists each meal's choices, and `page.meal_choices` makes the check refuse a meal with a different count. `photo_spot` needs its source.
- **Share (site and kit):**
  - The locked frame cannot share, so it sends `hj:share-want`. A place goes as its name, a line and an https link; a day goes as the document's link on the site only.
  - The document page checks the message and opens the device's share menu. If the browser refuses, the site's own bar offers Share or Copy link.
  - `web-share` is left at its default (`self`); naming it made browsers without Web Share warn.
- **Near me (site and kit):**
  - The trip page sends `hj:near-want`: up to 200 place keys with their coordinates.
  - The document page asks the person in its own words, once per load: "Your rough location is used on this device only … it is not sent to the site or kept."
  - It then takes one low-accuracy reading (no high accuracy, a cached reading up to five minutes old, 15 seconds at most).
  - It answers `hj:near` with the 20 nearest keys and distances to the nearest half kilometre. Coordinates never go into the frame or to the server.
- **Geolocation API critique (MDN, read 6 November 2026):**
  - There is no option for approximate location only, so the site rounds and keeps the reading on the device.
  - How long a "yes" lasts is the browser's choice.
  - Accuracy is a 95% radius.
  - High accuracy and continuous tracking cost battery, so the site takes one reading on a tap.
  - The API is blocked in the locked frame by design.
- **Motion:** the Web Animations API, through one helper that does nothing under reduced motion.
  - It covers the panel, the reveal on scroll, the legend's pulse, and Play the trip's progress, which now pauses and resumes.
  - No animation is left filling: the panel is closed by setting its end state first.
- **Atelier look:**
  - Type and colour: Fraunces with an italic accent word (`*word*` in titles), Inter text and letter-spaced labels, ivory and a deep green.
  - Cards: rounded and lifted, with photo credits laid over the picture; highlight cards are photo cards.
  - A frosted top bar, a photo band opening each day, and larger sub-headers. No content was removed.
- **Privacy page:** new lines for Instagram panels (Instagram sees the device's network address when one opens) and Near me.
- **Checks:**
  - Page tests: the share and near messages accepted and refused, nearest and rough distances, and that answers never come from the frame.
  - The database test covers the privacy lines.
  - Kit tests (41):
    - panels and place links;
    - meals counted;
    - photo spots and venue Instagram;
    - accents;
    - motion only through the helper;
    - the message protocol;
    - a browser test of the panel with and without reduced motion, and of Near me and Share inside a frame.
  - The release browser check covers sharing a place and the document's link through the site's bar, and Near me answering with keys and rough distances only.

## Follow-up T4: Taste & Shop, awards and the Gallery view (7 November 2026)

- **Owner requests and decisions:**
  - "food/eatery/snack, shopping is important to me. research how to incorporate them."
  - A coffee-table "one switch" view of Instagram, Facebook and TikTok posts, in the mix of picture shapes of the owner's reference site.
  - Decisions: "1 yes, 2 awards, 3 yes, 4 later". gia's live Google picks (best food rated 4 or more, hidden gems with few reviews): "Later".
- **Research (6 November 2026):**
  - Shop trading: the state's retail trading rules (shops closed on some public holidays, towns with their own hours, cafés, restaurants and day markets outside the rules) come from the state's consumer protection and public holiday pages, and go into the trip's trading-hours table.
  - Google Places: ratings must be fetched live with "Google Maps" attribution and may not be stored or shown with a non-Google map. So the page shows awards and guide listings instead.
  - Meta and TikTok:
    - Official embeds work without a key.
    - Popularity for Instagram needs the owner's Business Discovery setup (later).
    - TikTok popularity for other accounts is not available.
    - Facebook embeds did not run in the locked frame, so Facebook is links only.
- **Kit:**
  - Day `taste` and `shop` boxes.
  - The `taste_shop` section, by area, with the trading-hours table.
  - "Hungry?" and "Shop nearby": Near me filtered by category.
  - `awards` chips, also shown in the panel.
  - The Gallery view: a Read / Gallery switch, a mosaic of wide, portrait and tall tiles with credits and place links, and posts loaded only on a tap from two checked embed addresses.
    - Posts on Plan B and Plan C stops are shown after the main plan, marked with their plan, once each.
    - A playing post keeps a link to the post itself. In a local check, TikTok answered "ratelimit triggered" in place of a video; the link is the way out.
- **Site:** the privacy page now covers TikTok and the Gallery.
- **Checks:**
  - Kit tests (45):
    - Taste & Shop rendering and rules;
    - awards rules, and no stars in the page;
    - the Gallery's markup and shapes, Plan B posts and the link to each post;
    - credits on every picture;
    - no post loading before a tap;
    - a browser test of the switch and tap-to-load at desktop and phone widths.
  - The database test covers the privacy line.
