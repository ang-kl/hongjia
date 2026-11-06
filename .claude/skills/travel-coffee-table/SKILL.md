---
name: travel-coffee-table
description: Use when the family uploads or shares a document, PDF or picture whose intention is a trip or tour (an itinerary, a booking list, a brochure, a screenshot of plans, a map or a hand-written list of places), or asks for a trip page, a holiday plan or a new version of one. It turns that intention into a super-luxury, interactive "coffee-table" trip page with day plans, photos with credits, maps, concierge panels, Plan A/B/C for weather, a live forecast on the family site, audience lenses and optional upgrades, built from one trip data file with the page kit in kit/ and checked against the owner's rules before the owner reviews it.
---

# Travel coffee-table pages

A trip page is one self-contained HTML document, uploaded to the family site and viewed in its
locked-down document frame. Its look is the owner's approved design: a white page, gold accents,
Playfair Display headings, mono kickers, photo bentos with zoom, a timeline rail, a sticky map
centre. Do not restyle it; extend it.

Everything trip-specific lives in one data file (JSON). The renderer, its CSS and its JS are
generic and stay in this folder:

- `kit/build.py`: renders a data file and checks pages (`--check`). Python 3 standard library only.
- `kit/schema.md`: every field of the data file, and which are required.
- `kit/assets/kit.css`, `kit/assets/kit.js`: the design and the page's behaviour.
- `kit/example/trip.json`: a fictional two-day trip that uses every component.
- `kit/test_kit.py`: the kit's tests (`python3 kit/test_kit.py`).
- `reference/subtypes.md`: checklists for the kinds of trip.

## Workflow

1. **Intake.** Read the upload in full: dates, places, bookings, people, constraints, and what the
   owner wants from the trip. Note what is booked and what is only an idea. Say what you could not
   read.
2. **The owner's choices.** Ask, or take from the request, before building:
   - **Audience mode**: one travelling group (`party`, the page says who is travelling and what
     suits them) or a page for different kinds of traveller (`lenses`: for example young family,
     gentle pace, step-free).
   - **Luxury level**: how far the optional upgrades go (comfortable, premium, ultra).
   - **Sub-type**: road trip and countryside, city and culture, nature and wildlife, food and
     wine, cruise, faith and heritage, young family, gentle travel for seniors, celebration, or a
     mix. Open its checklist in `reference/subtypes.md`.
3. **Research, with sources.** Every fact on the page is checked against a source the reader can
   open, and the source is recorded with the time it was opened: opening hours, prices, phone
   numbers, holiday dates and trading rules, access, distances, hospital and police details,
   climate averages. Prefer the venue's own website and official bodies. A fact that cannot be
   confirmed is left out, or shown as unconfirmed and listed under "Checked and left out". Social
   accounts are only those the venue links from its own website. Photos need an author and a
   licence (open-licence libraries such as Wikimedia Commons, or the venue's own pictures shown
   from its website and credited to it); never a picture without a credit, never an empty frame.
4. **Build the data file** (`kit/schema.md`). The opener first: the hero photos, the TL;DR in
   three lines, alert chips (a holiday warning goes here), the stay and can't-miss cards, home and
   destination for the globe. Each day: route, Plan A stops, timeline items pointing at their stops
   (so each shows photos and official links), the four info boxes, Plan B and Plan C, nearby
   extras, its forecast place. Each stop: its legend categories (`cat`), 2 to 4 credited photos,
   the official links (website, Instagram, Facebook, TikTok, YouTube, address, phone, hours) and
   "if it's closed or crowded" alternatives nearby, with places of worship near each base.
   Concierge panels per area. Prose sections: overview, holidays and weather, stays, transport,
   backups, checklist. Upgrades per area. The data file for a real trip is private: keep it outside
   the repository (see Privacy).
5. **Render**: `python3 kit/build.py trip.json -o trip.html`.
6. **Check**: `python3 kit/build.py --check trip.html`. Fix every problem it reports: blank
   picture holders, photos without credit, facts without a source, a map on blocked tiles, social
   links off their platform or addresses off Google Maps, http links.
7. **Review.** Open the page at phone and desktop widths. Then the owner reviews it; only after
   the owner's approval is it uploaded and filed as a new version of the trip's document.

## Quality bar

The owner wants both the look and the content to be super-luxury and to "wow".

- **Look**: the approved design (white page, gold, Playfair Display headings, mono kickers), a
  full-screen opening that makes the reader want to go now, generous photography (up to four per
  stop, the best first, and photos on every schedule item), clips where they exist, live posts
  from official accounts, the globe, a map for every day, a legend that lights places up, nothing
  cramped, nothing wider than a 390 px phone. Movement is gentle and stops under reduced motion.
  Accessibility stays: 44 px targets, keyboard use, screen-reader labels, print mode.
- **Content**: a concierge's knowledge, not a brochure's. Each stop says why it is there, the best
  time, the photo moments, the easier version, and what is nearby. Real distances and road times
  with buffers. Honest limits: "proposed, not booked", "estimate, not a quote". No filler, no
  unverified superlatives.
- **One principal outing a day**, rest built in, seated meals; "swap, don't stack": a backup
  replaces a stop, it is never added on top.

## The page's libraries and limits

The document runs in the site's locked frame (no same-origin access). Scripts are inline or from
cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com or cdn.tailwindcss.com, with exact versions
pinned; the page may fetch only from those CDNs; pictures must be https or `data:`; frames only
Google Maps and Instagram and TikTok embeds. No `innerHTML` with data. Keep a typical trip page
under 1.5 MB (the globe's land data is the 1:110m version).

## Plan A, B and C

- **Plan A** is the day as written. Every day has one.
- **Plan B** is for rain: covered, indoor, close to the base.
- **Plan C** is for heat, strong wind or storms: cooler, sheltered, shorter, earlier.
- Each alternative names what it replaces. Alternatives are researched and sourced like Plan A.
- The rules are written in the data file (for example "Rain chance 60% or more: Plan B",
  thunderstorm codes, a maximum temperature, gusts) and shown on the page. The first matching
  rule decides the suggestion.
- The page shows every plan. The forecast highlights the suggested plan; it never hides or
  replaces another. The reader switches plans by hand.

## Weather protocol

Open-Meteo's free forecast (CC BY 4.0), asked by the family site's server so family devices never
contact it.

- The data file names up to 12 forecast places: `{"key", "lat", "lon", "start", "end"}`. The key
  is lowercase letters, digits and `-`, up to 30 characters, with no repeats; dates are
  `YYYY-MM-DD`, the end not before the start.
- Once on load, and only when it is inside a frame (`window.parent !== window`), the page sends
  `parent.postMessage({type: 'hj:weather-want', places: [...]}, '*')`.
- It accepts only messages where `event.source === window.parent` and
  `event.data.type === 'hj:weather'`. Each answer is for one place: `key`, `ok`; when `ok`:
  `available`, `from` (when the forecast does not reach the trip yet), `past`, `days` (`date`,
  `code` (WMO), `tmax`, `tmin`, `rain_pct`, `rain_mm`, `wind_kmh`, `gust_kmh`, `uv`; any may be
  null), `source`, `link`; when not `ok`: `error`.
- Each day shows a small strip: an icon from the WMO code, maximum and minimum, rain chance,
  wind, the suggested plan, and "Weather data by Open-Meteo.com" linked, with the licence, next to
  the data. Before the forecast reaches the day it shows "Forecast from" a date, and the rules.
- Every value in an answer is untrusted: the page checks types and ranges and builds the strip
  with `textContent`, never `innerHTML`.

## Privacy

This folder is in a public repository.

- Family names, travellers' details, trip dates, flights, bookings and any detail of a real trip
  never go into the repository: not in this skill, not in a commit message, not in a test.
- Data files and rendered pages for real trips live outside the repository and reach the family
  only as uploads to the private site.
- The example in `kit/example/` is fictional; keep any new example fictional too.
- The route map's tiles come from CARTO with the family's key (`map.tiles` in the trip file, never
  in this folder). OpenStreetMap's own tile servers refuse pages in the site's locked frame, which
  sends no Referer.
- Health notes stay general ("ask their clinician about heat and medicines"); the page is a
  planning document, not medical advice.
