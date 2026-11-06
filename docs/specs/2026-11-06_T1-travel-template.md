# T1: Travel template, Phase 1

Version 1, 6 November 2026. Follows the owner's requests of 6 November 2026. Trip details stay out of this public repository, so the owner's words name the trip as [the trip].

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
