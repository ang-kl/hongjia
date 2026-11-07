# Trip data file (holiday-coffee-table, version 1, 7 November 2026)

One JSON object describes one trip. `build.py` turns it into one self-contained HTML page.

```bash
python3 kit/build.py trip.json -o trip.html     # render (also runs the check and prints any problem)
python3 kit/build.py --check trip.html          # check a finished page (or a .json, rendered first)
python3 kit/test_kit.py                         # the kit's own tests
```

`kit/example/trip.json` is a complete, fictional example that uses every field below: a made-up eight-day trip
shaped like the family's v15 page (two bases, two transfer days with a midway break). Copy its shape, never its facts.

Required fields are marked **(required)**. Everything else is optional; a section with no data is
left out of the page and out of the top navigation.

## Text fields

- **Plain** fields (names, titles, captions, alt text, labels) are shown exactly as written.
- **Rich** fields (marked *rich* below) are escaped too, then these tokens are expanded. No other
  markup is accepted: raw HTML in a rich field is shown as text.

| Token | Becomes |
|---|---|
| `[[src:KEY]]`, `[[src:KEY\|label]]` | a source tag for `sources.KEY` (gold when checked, grey when carried over) |
| `[[tel:+00 0000 0000\|shown text]]` | a phone link (digits, spaces, brackets, a leading +) |
| `[[link:https://…\|text]]` | a link (https, mailto, tel or an in-page `#anchor` only) |
| `[[place:KEY]]`, `[[place:KEY\|text]]` | the name of `places.KEY` (or `text`), underlined; it opens the place's panel in the page, never a new window. Use it in route lines such as "[[place:station\|Station]] → [[place:hotel\|Hotel]]" |
| `**words**` | bold |
| `[[added]] … [[/added]]` | a note set off with a gold rule ("added in this edition") |
| `[[br]]` | a line break (table cells) |

Titles (the masthead and opener title, section titles and day titles) may set one word in the
accent italic with single asterisks: `"Arrive, settle in, *exhale*"`.

Any link anywhere in the file must be `https://` (or `tel:`/`mailto:` where a phone or email link
makes sense). Pictures may also be `data:image/…` URIs. Plain `http://` is refused.

## Top level

| Key | Required | What |
|---|---|---|
| `kit` | | Format version, `1`. |
| `meta` | **yes** | Page facts (below). |
| `masthead` | **yes** | The cover (below). |
| `days` | **yes** | One entry per day, at least one. |
| `places`, `stops`, `photos`, `sources` | **yes** | Registries the days refer to (may be `{}` only if unused). |
| `legs`, `safety` | | Route lines and hospital/police pins for the map. |
| `areas`, `concierge`, `emergency` | | Concierge panels per area, and emergency numbers. |
| `overview`, `holidays`, `stays`, `transport`, `backups`, `checklist` | | Prose sections built from blocks. |
| `audience` | | Who the page is for: one party, or lenses. |
| `plans`, `weather` | | Plan A/B/C rules and live forecast places. |
| `upgrades` | | Optional luxury upgrades. |
| `opener` | | The first screen: hero photos, countdown, TL;DR, alerts, stay and highlight cards, the globe and the legend. |
| `worship` | | Places of worship near each base, shown in the stays section and on the map. |
| `map`, `days_section`, `credits`, `sources_page`, `footer` | | Texts for the fixed sections. |
| `page`, `nav`, `labels` | | Section order, navigation and any kit wording to override. |

### `meta` (required)

| Field | Required | What |
|---|---|---|
| `title` | **yes** | The browser title. |
| `lang` | **yes** | Page language, for example `en-GB`. |
| `id` | | Short id used to remember the reader's plan and lens choices on their device. |
| `description` | | Meta description. |
| `trip`, `status`, `tz` | | Trip name, booking status ("Proposed, not booked"), time zone note. Written as `UTC+8` (or `UTC-5:30`), `tz` also turns on the Calendar section: every timeline time is read in it. |

### `masthead` (required)

`title` **(required)**, `kicker`, `lede`, `edition` (the small line under the facts), and
`facts`: a list of `{label, value, status}`; `status: true` colours the value gold (use it for the
booking status).

### `page`, `nav`, `labels`

- `page.meal_choices`: when set (for example `4`), every meal in `days[].meals` must list exactly
  that many choices, the planned place counted; the check refuses the file otherwise.
- `page.order`: the sections in page order. Default:
  `overview, audience, plans, map, days, concierge, holidays, stays, transport, backups, checklist, upgrades, credits, sources`.
- `nav.days_label`: the small word before the day numbers in the top bar (a month, for example).
- `nav.items`: the top bar, in order; `"@days"` places the day numbers. Default: the sections in
  page order with the day numbers after the first one.
- `nav.labels`: `{section: label}`; a section's own `nav` field also sets its label.
- `labels`: any kit wording to replace, by key (see `LABELS` in `build.py`), for example a page in
  another language. `labels.marks` relabels suitability values: `{"walking": {"long": "Long walk"}}`;
  `labels.cats` relabels legend categories: `{"fun": "Fun & games"}`.

### Legend categories (`cat`)

Stops, nearby places, alternatives, places of worship, upgrades and prose sections may carry `cat`: one
category or a list of them (a winery restaurant is `["food", "drinks"]`; a chocolate maker is
`["snacks", "shopping"]`). The legend, in this order, lights every element that carries the
category, on the page and on the map:

| Key | Legend | For |
|---|---|---|
| `stays` | 🏨 Stays | hotels, apartments, resorts |
| `transport` | 🚗 Transport | airports, stations, piers, car hire, drivers |
| `weather` | 🌦️ Weather | lit automatically: each day's forecast bar and the holidays and weather section |
| `food` | 🍽️ Food | meals: restaurants, lunch and dinner places |
| `drinks` | ☕ Drinks | cafes, coffee, bars, breweries, wineries, cellar doors |
| `snacks` | 🍫 Snacks | bakeries, chocolate, ice cream, market food stalls, quick bites |
| `shopping` | 🛍️ Shopping | shops, malls, markets, boutiques |
| `fun` | 🎡 Fun | beaches, cruises, attractions, spas, play |
| `sights` | 🏛️ Sights | lookouts, museums, galleries, heritage, nature |
| `worship` | ⛪ Worship | churches, mosques, temples, synagogues, chapels |

`"dining"` (the first legend's single category) is still read, as `food`. The stays, transport
and holidays sections carry `stays`, `transport` and `weather` unless their own `cat` says otherwise.

## Registries

### `sources` (required)

`{key: source}`. Facts point at sources with `[[src:key]]`; the sources section lists them.

| Field | Required | What |
|---|---|---|
| `label` | **yes** | The tag text, for example `venue`, `gov`, `health`. |
| `url` | | https link. A source without a link shows as a tag without a link. |
| `title` | | Full title, listed under Sources. |
| `opened` | | When it was opened and checked, for example `3 May 2027, 10:00 local`. |
| `tier` | | `checked` (default, gold tag) or `carried` (grey tag: carried over from an earlier version). |
| `tooltip` | | Hover text; default `"{title}, opened {opened}"`. |

### `places` (required)

`{id: {name, lat, lng, q, note}}`. `name`, `lat`, `lng`, `q` **(required)**: `q` is the Google
Maps search text; `note` says how good the pin is ("Approximate: street-level match").

### `legs`

`{"a>b": {km, min, path}}` for consecutive places in a day's `route`. `path` is a list of
`[lat, lng]` points that follow the road. Every pair in a route needs a leg unless the day lists it
in `walk`.

### `safety`

List of `{kind, name, lat, lng}`; `kind` is `ed` (hospital emergency department) or `pol` (police).
Shown on the map when the reader ticks the safety box.

### `photos` (required)

`{id: photo}`. Every picture needs a picture, a description, a caption and a credit.

| Field | Required | What |
|---|---|---|
| `src` | **yes** | https URL or a `data:image/…` URI. |
| `alt` | **yes** | What the picture shows, for screen readers. |
| `cap` | **yes** | The caption. |
| `credit` | **yes** | Photographer, owner or "made for this page". |
| `credit_url` | | Link for the credit (the photo's page). |
| `host` | | Library name, for example `Wikimedia Commons`; with `credit_url` and `file` the credit reads like a library credit. |
| `file` | | The library's file name. |
| `licence`, `licence_url` | | The licence. Without `licence_url`, the tile also links the original picture. |
| `credit_prefix` | | Default `Photo`; for example `Illustration`. |
| `note` | | Added to the credits list. |

### `stops` (required)

`{id: stop}`. A stop can appear on several days and in Plan B or C.

| Field | Required | What |
|---|---|---|
| `name` | **yes** | Shown on the card. |
| `place` | **yes** | A `places` id (the pin, Google Maps and Google Earth links). |
| `area` | | An `areas` id: adds the concierge drawer. |
| `photos` | | Up to four `photos` ids, shown as the bento; the first is the large one. |
| `prompts` | | Photo prompts (three is the house style). |
| `links` | | The official links, shown without opening anything: `{kind, url, label, note}`. Kinds: 🌐 `web`, 📷 `ig` (Instagram), 📘 `fb` (Facebook), 🎵 `tt` (TikTok), ▶️ `yt` (YouTube), 📍 `addr` (the address as `label`; it links to a Google Maps search, or to `url` if that is on google.com/maps), 📞 `tel`, ⏰ `hours` (the hours as `label`, with their `source` key or `url`: hours are a fact), and `mail`, `book`, `x`. Social links must be https on instagram.com, facebook.com, tiktok.com or youtube.com. Google Maps (unless an address is given) and Google Earth are added from the place. With an Instagram link, the card also gets a drawer with the venue's own profile embed, loaded only when opened. **Layout**: one wrapping row of small single-line chips (website, socials, call, maps; text never wraps), then the address as a line of text linking to Google Maps (`note` names whose address it is), then the hours: one line when the text is 60 characters or less, otherwise a small "⏰ Hours ▸" disclosure with the quoted hours and their source. A `tel` chip shows the number on wide screens and "Call" on phones: put the number as written in `label` (or `note`) and a name such as "Reception" in the other; the name goes in the chip's title; when a stop has two venues, `short` (a short venue name, up to 24 characters) makes it "Café · 0000 000" and "Call Café". Notes never appear inside a chip: they become its title (hover text), so anything that matters belongs in the sources. When one stop has two venues, give each chip a short `label` that says which ("Café website", "Café Instagram"). |
| `cat` | | Legend category, or a list (see Legend categories). |
| `line` | | One plain line for the opener's cards and the trip tour (default: the stop's first role). |
| `nearby` | | "If it's closed or crowded": small cards under the stop, and pins on the map's Nearby options layer. Each `{name, cat, why, distance, distance_note, hours, website, lat, lng, q, source}`: `name` and `cat` required; `why` is *rich*; `hours` needs `source` (a source key or an https URL). `distance` is one plain line people read at a glance ("About 3 min walk", "About 5 min drive", "In the same park"); how it was worked out goes in `distance_note`, shown as its title. `lat` and `lng` go together: without them the card still shows, with a Google Maps link that searches `q` (default: the name) but no pin and no Show on map, for a place that has no fixed spot or no confirmed one. Places of worship come the same way, with `cat` `worship` and an optional `faith`. Optional `instagram` (the venue's own account, `https://www.instagram.com/<handle>/`, only when its own website links to it), `address`, `photo` (a `photos` id or a photo object) and `photo_spot` (as for stops). |
| `instagram_tag` | | Adds `#tag` (Instagram photos), letters and digits only. |
| `awards` | | Published awards or guide listings only, never star ratings: `[{award, year, body, source}]`; `award` and `source` (a source key or an https page, preferably the awarding body's) required. Shown as "🏆" chips on the card and in the panel. Also allowed on nearby alternatives and meal choices. |
| `social` | | Posts for the Gallery view, from official accounts only (the venue's own, linked from its website, or the official tourism body): `[{kind, url, by}]`. `kind` `instagram` (`https://www.instagram.com/p/<code>/` or `/reel/<code>/`), `tiktok` (`https://www.tiktok.com/@<handle>/video/<id>`) or `facebook` (any https facebook.com link, shown as a link only); `by` is the account's handle. Each post loads only when tapped. Never label posts "most popular" unless that was measured. |
| `photo_spot` | | The place's best photo spot, as an official source names it: `{spot, tip, source}`; `spot` and `source` (a source key or an https page) required. Shown on the card ("📸 Photo spot") and in the place's panel. Never from popularity or guesswork. |
| `tiktok_search` | | Adds a TikTok search. |
| `details` | | `{text, source}` or `{text, url}`: the "Details" links under the link row. |
| `clips` | | Videos: `{sources: [{src, type}], poster, alt, cap, credit, page, host, licence, licence_url}`; `poster`, `alt`, `cap`, `credit` and one source are required. |
| `embeds` | | Latest posts: `{kind: "instagram" \| "tiktok", handle}`. Only accounts the venue links from its own website. |
| `suits` | | Suitability marks: `{mark: value}`, see the table below. |
| `suits_note` | | *rich*: one access note under the marks. |
| `lens_notes` | | `{lens key: rich text}`: shown for that lens. |

Suitability marks:

| Mark | Values (good, mixed, poor) |
|---|---|
| `step_free` | `yes`, `partial`, `no` |
| `walking` | `short`, `moderate`, `long` |
| `shade` | `yes`, `some`, `no` |
| `seating` | `yes`, `some`, `no` |
| `toilets` | `yes`, `nearby`, `no` |
| `kids` | `yes`, `some`, `no` |
| `seniors` | `yes`, `some`, `no` |

## Days (required)

| Field | Required | What |
|---|---|---|
| `when` | **yes** | "Sat 12 Jun": the kicker, the rail and the nav. |
| `title` | **yes** | The day's headline. |
| `route` | **yes** | Place ids in order; the letters A, B, C… follow this order. |
| `stops` | **yes** | Plan A: `{stop, role}` items, at least one. |
| `iso` | with `weather` | The date, `YYYY-MM-DD`. |
| `route_label`, `sub`, `base`, `badge` | | Kicker route, dek line and the two pills. |
| `walk` | | `"a>b"` legs that are short walks (dashed on the map, no leg needed). |
| `timeline` | | `{time, title, text, stop, photos, links}`; `text` is *rich*. With `stop` (a stop id), the item links to its card and shows the stop's photos (up to three: a swipeable strip on phones, tap to enlarge, credited) and its official links; `photos` and `links` override or stand alone. |
| `info` | | Boxes under the timeline: `{title, text}`, *rich* (house style: Getting around, Meals, Style & photo moments, Make it easier). |
| `links` | | `{text, source}` or `{text, url}` under the boxes. |
| `plan_b` | | Plan B (rain): `{stop, role, replaces}` items. |
| `plan_c` | | Plan C (heat, wind or storm): `{stop, role, replaces}` items. |
| `plan_notes` | | `{"b": rich, "c": rich}`: one line under each plan's heading. |
| `weather` | | A `weather.places` key: the day's forecast strip. |
| `taste`, `shop` | | The day's two boxes, "Taste of the day" and "Shop the day": `{text, hours, items}`. `text` and `hours` are *rich* (`hours`, the shops' trading hours that day, is a fact and needs a source tag); `items` are cards like a stop's `nearby` (`cat` defaults to `food` and `shopping`). |
| `meals` | | The day's meals, each with its choices: `{meal, time, note, choices}`. `meal` is `breakfast`, `brunch`, `lunch`, `dinner` or `snack`; `note` is *rich*; each choice is `{stop, role}` (a planned stop, marked "Planned") or a card like a stop's `nearby` (`cat` defaults to `food`; `hours` need a `source`). With `page.meal_choices`, the count must match. |
| `nearby` | | Optional extras: `{id, name, kind, why, hours, hours_sources, lat, lng, q, links, photo}`; `id`, `name`, `why`, `lat`, `lng`, `q` required; `hours` is a fact, so give `hours_sources` (source keys or https URLs); `photo` is a `photos` id or a photo object; `cat` puts it in the legend and on the map's Nearby options layer. |

## Plans and weather

### `plans`

Plan A is each day's `stops`. Plans B and C are each day's `plan_b` and `plan_c`. The page shows
all plans; the reader chooses by hand, and the forecast only highlights the plan the rules suggest.

| Field | What |
|---|---|
| `kicker`, `title`, `intro` | The Plans section. |
| `labels` | `{"a": "As planned", "b": "If it rains", "c": "Heat, wind or storm"}` |
| `explain` | `{"a": rich, "b": rich, "c": rich}`: one line per plan in the Plans section. |
| `rules` | In order; the first rule that matches the day's forecast decides. Each: `plan` (`b` or `c`), `metric`, `op`, `value`, `text` **(all required)**, and `short` (the compact form shown beside each forecast). |

Metrics: `code` (WMO weather code), `tmax`, `tmin` (°C), `rain_pct` (%), `rain_mm`, `wind_kmh`,
`gust_kmh`, `uv`. Ops: `>=`, `>`, `<=`, `<`, and `in` with a list (for codes: thunderstorms are
`[95, 96, 99]`).

### `weather`

| Field | What |
|---|---|
| `title`, `intro` | The forecast part of the Plans section. |
| `places` | Up to 12 forecast places: `{key, lat, lon, start, end, label}`. `key` is lowercase letters, digits and `-`, up to 30 characters, unique; dates are `YYYY-MM-DD`, end not before start, at most 60 days. `label` stays in the page; only `key`, `lat`, `lon`, `start` and `end` are sent. |

The page asks the family site for the forecast once on load, and only inside its frame; see
SKILL.md for the messages. Until the forecast reaches a day, the strip says "Forecast from" the
day 15 days before it, with the rules.

## Audience

`audience.mode` is the owner's choice:

- `"party"`: one travelling group. `travellers`: `{label, name, detail}` (`detail` *rich*);
  `needs`: the marks that matter most to this group. Each stop then says what fits, what to check
  and what was not checked.
- `"lenses"`: the reader switches between kinds of traveller. `lenses`: `{key, label, icon, intro,
  needs}`, at least one. The chosen lens highlights its marks on every stop and shows its
  `lens_notes`.

Both take `kicker`, `title`, `intro` and `notes` (*rich* paragraphs).

## Concierge

- `areas`: `{id: {name, used, groups}}`. Each group is `{title, short_title, tone, items}`;
  `short_title` is used in the compact drawer, `tone: "med"` marks the medical group. Items are
  `{text}`, `{label, short_label, text}` or `{label, list: [...]}` (all text *rich*). Every item is
  treated as a fact: one that states hours, prices, phone numbers, percentages or distances needs a
  `[[src:…]]` tag.
- `concierge`: `kicker`, `title`, `intro`, `notes` (*rich*), `order` (area ids).
- `emergency`: `{tel, label, main}`; `main: true` is the red button.

## Prose sections

`overview`, `holidays`, `stays`, `transport`, `backups` and `checklist` share one shape:
`{nav, kicker, title, intro, alert, blocks}`. `alert` is `{title, text}` and comes first.
`intro` is one *rich* paragraph or a list of them.

Blocks (`type`):

| Type | Fields |
|---|---|
| `p` | `text` *rich*, `style`: `fine`, `quote`, `offer` or none, `facts` |
| `h3` | `text` (a ruled sub-heading) |
| `alert` | `title`, `text` *rich* |
| `list` | `items` *rich*, `style`: `mini` (default) or `principles`, `title`, `box` (wrapper class, for example `avoid`), `facts` |
| `bases` | `items`: `{label, name, text, note}` |
| `cards` | `items`: `{kicker, title, paras, place}`; `layout` `two` or `three`; `style` `stay`; with `place` (a `places` id) the title opens that place's panel |
| `anchors` | `items`: `{label, code, lines}` (flights, trains, ferries) |
| `details` | `summary`, `items` and/or `paras` (*rich*), `style: "howto"` |
| `cards` | `items`: `{kicker, title, paras}`, `layout`: `two` or `three`, `style: "stay"`, `facts` |
| `columns` | `columns`: a list of block lists, side by side |
| `table` | `caption`, `head`, `rows` (cells *rich*, or `{text, sub}`), `row_header`, `num` (column indexes), `style` (`wx` for climate, `taxi` for fares), `facts` |
| `checks` | `items`: `{name, title, text}` (the decision checklist) |
| `budget` | `items`: `{label, text}` |
| `emergency` | the emergency buttons |

`facts: true` marks the rendered items as facts for the check: each that states hours, prices,
phone numbers, percentages or distances must carry a source tag.

House style for the sections: `overview` (alert, bases, principles, travel anchors, how to read),
`holidays` (holiday calendar and a climate table), `stays` (stay cards, avoid list, quote request),
`transport` (three cards, fares table with its method, public transport, offers), `backups`
("Swap, don't stack": replacements, never additions), `checklist` (checks and budget).

## Upgrades

`upgrades`: `{kicker, title, intro, note, groups}`. Each group is `{area | title, items}`; each item
has `name`, `line`, `price`, `book_ahead`, `source` **(all required)**, and `photo`, `place`,
`links`, `cat`. The section is labelled optional and never replaces the plan; it is left out when there
are no groups.

## Fixed sections

- `map`: `kicker`, `safety_label`, `coordinates_source` (a source key shown on every pin note),
  `notes`: `{route, pin, dir}` (*rich*, under each map tab).
- `map.tiles`: where the route map's tiles come from (see "The route map's tiles" in SKILL.md).
  - `{"provider": "site"}`, the default when `map.tiles` is left out: OpenStreetMap tiles through
    the family site's relay, with a ticket the site gives the page (`hj:tiles-want` / `hj:tiles`).
    Opened anywhere else, the map keeps its routes and pins on a plain background with the notice
    "Map pictures load inside the family site." (label `tiles_notice`).
  - `{"provider": "carto", "style": "voyager", "key": "…"}` (style `voyager` or `light_all`): the
    family's free, revocable CARTO key. It belongs in the private trip file only, it is visible to
    anyone who opens the page, and it cannot be locked to the site.
  - `{"provider": "osm"}`: OpenStreetMap's own servers, which refuse pages in the site's locked
    frame because it sends no Referer. It is accepted, but `--check` reports "map blocked in the
    family site".

  The kit adds the credits itself ("© OpenStreetMap contributors", linked to its copyright page,
  plus "© CARTO" for CARTO) and keeps them visible on the map.
- `days_section`, `credits`, `sources_page`: `kicker`, `title`, `intro`; `intro_style: "fine"`.
  `credits.library_note` is added to library-credited photos; `sources_page.carried_summary` names
  the carried-over list, and `sources_page.blocks` follow the lists.
- `footer`: `kicker`, `text`, `fine`.

## Opener

`opener` makes the page start with a full-screen hero, before the masthead. Without it the page starts
with the masthead as before.

| Field | Required | What |
|---|---|---|
| `hero` | **yes** | 1 to 8 photo ids: they cross-fade and zoom slowly (still under reduced motion). |
| `title`, `kicker` | | Default: the masthead's. The hero title is the page's only `h1`. |
| `dates` | | The dates as shown, for example "Saturday 12 to Saturday 19 June 2027". |
| `start`, `end` | | `YYYY-MM-DD` for the countdown ("134 days to go", "Day 3 of 8" during, hidden after); default: the first and last day's `iso`. |
| `tz`, `tz_place` | | The destination's IANA time zone (`Europe/Lisbon`) and the place named with its local time. |
| `tldr` | | Three lines (*rich*): the trip at a glance. |
| `alerts` | | Chips: `{text, href, icon}`; `href` is an in-page `#anchor` (`#day-7`). A holiday warning goes here, not in a box. |
| `stays` | | Stop ids: "Where you'll stay" photo cards, each linking to the stop's card, with its website as a small second link. |
| `highlights` | | Stop ids: "Can't-miss" photo cards (6 to 8 is the house style). A swipeable row on phones. |
| `home` | | `{name, lat, lng}`: where the travellers start; the globe draws a gold great-circle arc from it. |
| `destination` | | `{name, lat, lng}`; default: the first stay's place. The arc continues to the bases (the stays' places). |

The globe is drawn by the kit's own orthographic projection over Natural Earth 1:110m land (the
world-atlas TopoJSON in `assets/land-110m.json`, decoded at build time and inlined, so the page fetches
nothing). It spins slowly to the destination when it comes into view, turns when dragged sideways or
with the arrow keys, and stands still under reduced motion. The credits section names Natural Earth.

"Play the trip" opens a guided tour: the globe flies from home to the destination, then the route map
goes day by day, stop by stop, with each stop's photo and `line` in a caption card. It pauses, steps
with Back and Next, closes with Esc, and under reduced motion does not play by itself.

## Worship

`worship`: `[{base, title, items}]`, where `base` is an area id (its name heads the group) or `title`
names it, and `items` are like a stop's `nearby` (`cat` defaults to `worship`; add `faith`). They show
in the stays section and on the map's Nearby options layer.

## Taste & Shop

`taste_shop` (in `page.order` after `days`): `{nav, kicker, title, intro, areas, blocks}`. Each area is
`{area, title, intro, signature, sweets, markets, shopping, bring_home}`: `area` is an `areas` id (or give
`title`); `signature` lists local things to taste, `{name, where, why, season, source}` with `name` and
`source` required; `sweets`, `markets` and `shopping` are cards like a stop's `nearby` (with their hours
and sources on the family's day there); `bring_home` is `{what, where, note, source}`. `blocks` hold the
trading-hours table for the trip's days (a `table` block whose rows each carry a source tag). The section
has "Hungry?" and "Shop nearby" buttons: Near me filtered to food, snacks and drinks, or to shops.

## The Gallery view

One switch in the top bar, Read or Gallery, turns the page into a picture book and back. Each day opens
on its title, then a mosaic of three shapes: wide photos, portrait cards (Instagram posts) and tall cards
(Reels and TikTok videos), each with the place's name (it opens the panel), the page's own line about it
and the photo's credit. Posts come from `stops[].social` and load only when tapped, from the embed
addresses `https://www.instagram.com/(p|reel)/<code>/embed/captioned/` and
`https://www.tiktok.com/embed/v2/<id>`; Facebook posts open Facebook. Reading mode keeps every word.
Posts on a Plan B or Plan C stop come after the day's main plan, marked with their plan ("Plan B · If it
rains"), and a post shown twice in a day appears once. A playing post keeps a small link to the post itself,
in case the service shows an error or a limit in place of the post.

## The calendar

With `meta.tz` written as `UTC+H` and at least one timeline item with a clock time, the page gets a
**Calendar** section after Days: one column per day, each timeline item drawn at its time on an hour grid,
side by side where items overlap. The columns scroll sideways inside the section on a phone; the page never
does. Times are read from each item's `time`: `09:15` and `Around 18:30` or `From 14:00` (30 minutes from
then), `By 15:00` (the 30 minutes before), and `10:15 to 11:30` or `11:25 → 16:35` (a span; one that ends
past midnight ends the next day). Anything else ("Morning") has no set time: it is drawn dashed between its
neighbours, labelled with its own words, and is never added to a calendar or given a time.

Every timed item has **Add**, and each day **Add this day** (up to 12 events). Each opens the family site's
`/calendar.ics` with the event in its address (title, local start and end, `tz`, place with its address,
the item's text and `meta.status`); the site turns it into a calendar file for the reader's device and keeps
nothing. On the site the link also names the trip page, so each event links back. Away from the site (a
saved copy of the page) the buttons are hidden and a note says why. Optional `calendar`: `{kicker, title,
intro, nav}`.

Every place name on the page (stop cards, nearby alternatives, places of worship, meal choices, the
day's extras, stay cards and `[[place:…]]`) is underlined and opens one panel inside the page: from
the bottom on a phone (drag it down to close), from the right on a wider screen. It shows the photo
with its credit, what the place is, its address, hours and photo spot with their sources, Show on
map and Share, then the outside links (website, Google Maps, Instagram), each marked ↗ because it
opens a new tab, and the venue's own Instagram posts, loaded only when the panel opens. Escape, ×,
or a tap outside closes it, and the reader is back where they were.

- **Share**: on the family site the locked page cannot share, so it asks the site
  (`hj:share-want`): a place by its public facts and an https link; a day only by the document's
  link on the site (the owner, 6 November 2026: "link only"). Opened elsewhere, it uses the
  browser's share menu or copies the link.
- **Hungry? and Shop nearby** (the plain "📍 Near me" button was removed, the owner, 7 November 2026):
  on the family site the site asks the person in its own words, takes a rough reading
  (never high accuracy) and sends back only the nearest places' keys and distances to the nearest
  half kilometre (`hj:near-want` and `hj:near`); the page never receives coordinates.
- **Motion** uses the Web Animations API through one helper, and none at all when the reader asks
  for reduced motion; no animation is left filling after it ends.

## The check (`--check`)

A page fails when it has:

1. **a blank picture holder**: an `<img>` with no picture, an empty photo frame, a photo grid
   whose count does not match, a placeholder without a picture, or a video without a source;
2. **a photo without credit**: a picture or video without a credit in its caption;
3. **a fact without a source**: a fact (hours, prices, phone numbers, percentages, distances) with
   no source tag. Kit pages mark their facts; for other pages every paragraph, list item and cell
   is read;
4. **a map blocked in the family site**: a route map on OpenStreetMap's own tile servers (leave
   `map.tiles` out so the site relays the tiles, or use CARTO with the family's key), or a `site`
   map whose script never asks the site for a ticket;
5. **an official link off its platform**: an Instagram, Facebook, TikTok or YouTube link that is not
   https on that platform, or an address that does not link to Google Maps;
6. **an http link**: any `http://` link, picture, frame or stylesheet (`data:` pictures and
   namespaces such as `xmlns` are not links).
