---
flow: spec
title: "D2 - Drawing over documents: Draw, Sketch, Shapes, Eraser and Undo"
act: "directive"
force: "MUST"
status: "Built on the owner's instruction \"continue to build until it's finished\" (5 November 2026), on top of D1 (PR #10). Merge needs the owner's go-ahead."
scope:
  - "crates/web/**"
  - "db/migrations/0007_d2_ink_and_shapes.sql"
  - "web/assets/ink.mjs"
  - "web/assets/doc-view.mjs"
  - "web/assets/frame-helper.js"
  - "web/assets/site.css"
  - "web/test/ink.test.mjs"
  - "tests/browser/p1-flow.mjs"
  - "docs/specs/2026-11-05_D2-ink-and-shapes.md"
  - "README.md"
---

# D2 - Drawing over documents

Version 0.1 · 5 November 2026 · Asia/Singapore · follows D1 (annotation tools).

## Owner request

These items come from the owner's list in chat (5 November 2026):

- "Drawing & Sketching: Sketch tool (which auto-approximates shapes like circles and ovals) or the Draw tool for freehand lines."
- "Shapes & Arrows: Insert rectangles, ovals, lines and arrows."
- "Drawing & Freehand: Use pencil/swirl tools to draw freehand markups or free-form shapes."
- The earlier Apple Pencil request.

D1's rules apply unchanged: any member may draw, only a drawing's author edits it, and its author or the owner deletes it. D3 (signatures, magnifier and pictures) and D4 (redaction and attachments) are not part of this.

## What is built

- **Entering drawing.** The annotation menu (right-click, a long press, two Pencil taps, or Shift+F10) gains these items: Draw, Sketch, Shapes ▸ (Rectangle, Oval, Line, Arrow) and Eraser.
- **The toolbar.** Choosing one of those items opens a floating toolbar at the top of the window, with these controls:
  - the seven tools;
  - the five D1 colours;
  - three line widths (2, 4 and 8 px);
  - Undo and Done.

  Every control is at least 44 px. The toolbar wraps onto more rows on narrow screens and stays inside the window on all seven device classes. Done or Escape leaves drawing.
- **The drawing surface.** While drawing, a transparent surface covers the document frame, so pointer input goes to the page and never to the document.
  - Strokes use Pointer Events, including `getCoalescedEvents`, for smooth lines.
  - Apple Pencil pressure varies the line from 0.35 to 1.65 times its width.
  - Palm rejection: once a Pencil has been seen on the page, fingers scroll the document instead of drawing.
  - On a phone without a Pencil, one finger draws, and Done gives scrolling back.
  - A mouse or trackpad draws with its main button held. The wheel scrolls the document.
  - Each stroke is simplified (Ramer-Douglas-Peucker) and capped at 600 points.
- **Sketch.** When a sketch is finished, `recognise()` decides whether it was a line, an arrow (a line with a hook at its end), a rectangle or a circle or oval. If it is confident, the sketch becomes the clean shape; otherwise the freehand stroke is kept. The decision is deterministic, from the stroke's straightness, how closed it is, how close it comes to its box's corners, and how well it fits an ellipse.
- **Undo and the Eraser.**
  - Undo deletes the person's own most recent drawing on the document.
  - The Eraser deletes each drawing its path touches, if the person may delete it (its author or the owner). For other people's drawings it says "You can erase only your own drawings" and sends nothing; the server would refuse anyway.
- **The panel.** Drawings are listed as Drawing, Rectangle, Oval, Line or Arrow, with the colour and author, and Delete where allowed. Clicking an entry scrolls the document to the drawing and flashes it. Clicking a drawing opens its entry.

## Data

Migration `0007` extends `annotations`, without adding a table:

- two new kinds: `ink` (tool `draw`, or `sketch` when no shape was recognised) and `shape` (tool `rectangle`, `oval`, `line` or `arrow`);
- `tool`, `points`, `stroke_width` (1 to 24) and `ref_width`.

A check constraint makes a drawing carry all four values and a place, and every other mark carry none of them.

Drawings stay in the same table because they share everything other marks have: the rights, the list and delete endpoints, the audit log, the per-document limit of 1000, the "last change" time and the panel order. A separate table would have duplicated those paths for no gain.

- **Points.**
  - Ink is stored as `x,y,p x,y,p …`, where p is the pressure from 0 to 1. A shape is stored as `x1,y1 x2,y2`.
  - The server accepts numbers only, each with at most 6 digits and 2 decimals, within ±100000. It accepts 2 to 600 points for ink and exactly 2 for a shape, and a shape must have a size.
  - Before storing, the server writes the points back in one form: one decimal for positions and two for pressure.
- **Undo endpoint.** `POST /documents/{key}/annotations/undo` accepts a fetch request only (the form token in a header, plus the Origin check). It deletes the person's own latest drawing, replies with its id or 404, and is audit-logged like any other delete.

## Positioning, and its limits

- **Anchoring.** A drawing is anchored to the block element under its first point, using D1's element path. Its points are pixels from that element's top-left corner, recorded when the element was `ref_width` pixels wide. When drawn, they are scaled by the element's current width over `ref_width`, and the frame reports where the element is now. So a drawing follows its paragraph when the page scrolls, reflows or is opened on another device.
- **Limit 1: strokes across elements.** A stroke that crosses several elements follows the first one.
- **Limit 2: vertical drift.** Scaling follows the element's width, but text does not change size with width. So when an element becomes much narrower, its lines wrap differently, and marks drawn far below that element's top can drift relative to the words. Anchoring to the nearest block, usually a paragraph, keeps this small. A stroke started in a margin anchors to the larger element around it, so it drifts more.
- **Limit 3: changed documents.** If a later version changes the document's structure, a drawing may not find its element. It then stays listed in the panel and is not drawn.

## Security

- **Drawings stay out of the frame.** Drawings are drawn by the page in an SVG layer over the frame. Their points never enter the document, which receives only each drawing's kind and anchor, as with D1's notes. The drawing surface belongs to the page, so a document cannot draw, erase or undo.
- **Frame messages are checked.** The frame may add an element's size to `hj:positions` and an element's box to `hj:located`. Both are checked by `validMessage` as bounded numbers. The new `hj:scrollby` message, from the page to the frame, is clamped to ±5000 px.
- **Policies are unchanged.** All text is set with `textContent`, and SVG attributes are set with `setAttribute`, never with style attributes. The family CSP, `DOCUMENT_CSP` and the iframe sandbox are unchanged.

## Invariants and checks

| Invariant | Check |
|---|---|
| Points are numbers only and within limits; tools fit the kind; drawings need a place; other marks carry no drawing values | `drawing_points_are_numbers_within_limits` and `drawings_need_a_tool_points_and_a_place` (unit); `drawings_round_trip_within_limits` (database) |
| Undo removes only the person's own latest drawing; the Eraser follows the delete rights; only the author edits; drawings are not moved | `undo_and_eraser_follow_the_rules` (database) |
| Sketch recognition, simplification, scaling, palm rejection and eraser reach | `web/test/ink.test.mjs` (8 tests) |
| Points never enter the frame | code read: `anchors()` sends kind, colour and anchor fields only; frame-helper reports boxes only |
| Drawings keep their place after a reload and at another width; toolbar inside the window with 44 px targets on every device class; no CSP breach; no sideways scroll | `tests/browser/p1-flow.mjs` |

## Evidence (local, 5 November 2026)

- `cargo test --locked --features db-tests`: 43 unit tests (2 new), 28 database tests (2 new), 2 Dockerfile tests and 12 placeholder parity tests pass. `cargo clippy --all-targets --all-features -- -D warnings` and `cargo fmt --check` are clean.
- `node --test "web/test/**/*.test.mjs"`: 45 of 45 pass, 8 of them new.
- `tests/browser/p1-flow.mjs` (release build): 154 of 154 checks pass (11 pages × 7 classes × light and dark). Before the device loop it also covers:
  - a freehand line drawn with the mouse;
  - a sketched circle that becomes an oval, and a sketched arrow that becomes an arrow;
  - a rectangle from Shapes, then Undo removing it;
  - the Eraser removing the line;
  - a simulated Pencil stroke whose pressure is kept, with at least three different values;
  - on a touch tablet, a finger that scrolls the document and does not draw after a Pencil stroke;
  - on a phone without a Pencil, a finger that draws;
  - the oval keeping its place after a reload, and at 820 px wide relative to its paragraph, within 3% of the paragraph's width.

  In the device loop, the sketch page shows every drawing, and the toolbar opens inside the window with 44 px targets. The drawing surface covers the frame, and Escape leaves drawing.
- Touch and Pencil input were simulated in Chromium (Chrome DevTools Protocol), not tried on a real iPad. The owner's check on a real device is still needed.
