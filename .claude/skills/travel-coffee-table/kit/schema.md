# Trip data file (kit 1)

One JSON object describes one trip. `build.py` turns it into one self-contained HTML page.

```bash
python3 kit/build.py trip.json -o trip.html     # render (also runs the check and prints any problem)
python3 kit/build.py --check trip.html          # check a finished page (or a .json, rendered first)
python3 kit/test_kit.py                         # the kit's own tests
```

`kit/example/trip.json` is a complete, fictional example that uses every field below.

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
| `**words**` | bold |
| `[[added]] … [[/added]]` | a note set off with a gold rule ("added in this edition") |
| `[[br]]` | a line break (table cells) |

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
| `map`, `days_section`, `credits`, `sources_page`, `footer` | | Texts for the fixed sections. |
| `page`, `nav`, `labels` | | Section order, navigation and any kit wording to override. |

### `meta` (required)

| Field | Required | What |
|---|---|---|
| `title` | **yes** | The browser title. |
| `lang` | **yes** | Page language, for example `en-GB`. |
| `id` | | Short id used to remember the reader's plan and lens choices on their device. |
| `description` | | Meta description. |
| `trip`, `status`, `tz` | | Trip name, booking status ("Proposed, not booked"), time zone note. |

### `masthead` (required)

`title` **(required)**, `kicker`, `lede`, `edition` (the small line under the facts), and
`facts`: a list of `{label, value, status}`; `status: true` colours the value gold (use it for the
booking status).

### `page`, `nav`, `labels`

- `page.order`: the sections in page order. Default:
  `overview, audience, plans, map, days, concierge, holidays, stays, transport, backups, checklist, upgrades, credits, sources`.
- `nav.days_label`: the small word before the day numbers in the top bar (a month, for example).
- `nav.items`: the top bar, in order; `"@days"` places the day numbers. Default: the sections in
  page order with the day numbers after the first one.
- `nav.labels`: `{section: label}`; a section's own `nav` field also sets its label.
- `labels`: any kit wording to replace, by key (see `LABELS` in `build.py`), for example a page in
  another language. `labels.marks` relabels suitability values: `{"walking": {"long": "Long walk"}}`.

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
| `links` | | Link row: `{kind, url, label, note}`; `kind` is `web`, `tel`, `mail`, `book`, `ig`, `fb`, `tt`, `yt` or `x`. Google Maps and Google Earth are added from the place. |
| `instagram_tag` | | Adds `#tag` (Instagram photos), letters and digits only. |
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
| `timeline` | | `{time, title, text}`; `text` is *rich*. |
| `info` | | Boxes under the timeline: `{title, text}`, *rich* (house style: Getting around, Meals, Style & photo moments, Make it easier). |
| `links` | | `{text, source}` or `{text, url}` under the boxes. |
| `plan_b` | | Plan B (rain): `{stop, role, replaces}` items. |
| `plan_c` | | Plan C (heat, wind or storm): `{stop, role, replaces}` items. |
| `plan_notes` | | `{"b": rich, "c": rich}`: one line under each plan's heading. |
| `weather` | | A `weather.places` key: the day's forecast strip. |
| `nearby` | | Optional extras: `{id, name, kind, why, hours, hours_sources, lat, lng, q, links, photo}`; `id`, `name`, `why`, `lat`, `lng`, `q` required; `hours` is a fact, so give `hours_sources` (source keys or https URLs); `photo` is a `photos` id or a photo object. |

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
`links`. The section is labelled optional and never replaces the plan; it is left out when there
are no groups.

## Fixed sections

- `map`: `kicker`, `safety_label`, `coordinates_source` (a source key shown on every pin note),
  `notes`: `{route, pin, dir}` (*rich*, under each map tab).
- `map.tiles`: where the route map's tiles come from. `{"provider": "carto", "style": "voyager", "key": "…"}`
  (style `voyager` or `light_all`) for every page that goes on the family site; without it the map
  uses OpenStreetMap's tile servers, which refuse pages in the site's locked frame (it sends no
  Referer), and `--check` reports "map blocked in the family site". The key is the family's free,
  revocable CARTO key: it belongs in the private trip file only, it is visible to anyone who opens
  the page, and it cannot be locked to the site. The credits ("© OpenStreetMap contributors
  © CARTO") are added by the kit.
- `days_section`, `credits`, `sources_page`: `kicker`, `title`, `intro`; `intro_style: "fine"`.
  `credits.library_note` is added to library-credited photos; `sources_page.carried_summary` names
  the carried-over list, and `sources_page.blocks` follow the lists.
- `footer`: `kicker`, `text`, `fine`.

## The check (`--check`)

A page fails when it has:

1. **a blank picture holder**: an `<img>` with no picture, an empty photo frame, a photo grid
   whose count does not match, a placeholder without a picture, or a video without a source;
2. **a photo without credit**: a picture or video without a credit in its caption;
3. **a fact without a source**: a fact (hours, prices, phone numbers, percentages, distances) with
   no source tag. Kit pages mark their facts; for other pages every paragraph, list item and cell
   is read;
4. **an http link**: any `http://` link, picture, frame or stylesheet (`data:` pictures and
   namespaces such as `xmlns` are not links).
