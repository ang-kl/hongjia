---
flow: spec
title: "D1 - Annotation tools: right-click, long press and Pencil menu"
act: "directive"
force: "MUST"
status: "Built on the owner's instruction \"build\" (5 November 2026), with D1's open choices at the recommended defaults. Merge needs the owner's go-ahead."
scope:
  - "crates/web/**"
  - "db/migrations/0006_d1_annotation_tools.sql"
  - "web/assets/frame-helper.js"
  - "web/assets/doc-view.mjs"
  - "web/assets/site.css"
  - "web/test/annotation-tools.test.mjs"
  - "tests/browser/p1-flow.mjs"
  - "docs/specs/2026-11-05_D1-annotation-tools.md"
  - "README.md"
---

# D1 - Annotation tools

Version 0.1 · 5 November 2026 · Asia/Singapore · follows P2b (C) annotations.

## Owner request and decisions

- Owner request (chat, 5 November 2026): annotations should be "sophisticated using right-click and pencil hover (double-click) or press on using touch screen". The owner listed these tools: highlight, underline and strikethrough in colours; text boxes and movable colour sticky notes; replacement and insertion proofreading marks; comments and sticky notes with @mention; and stamps, checkmarks and sign-offs.
- The owner said "build" after the plan in chat № 38 and № 42. D1's open choices were not answered one by one, so they were taken **at the recommended defaults**:
  1. Apple Pencil: hovering shows a ring in the active tool's colour, and two quick taps on the screen with the Pencil open the menu. Safari does not give websites the Pencil's own double-tap or squeeze gestures.
  2. Everyone may add marks. Only a mark's author edits or moves it, and its author or the owner deletes it. This matches comments in P2b (C).
  3. @mentions appear inside the site only, under "Mentioned you" on Home. Nothing is sent by email, SMS or push.
- These stay out of D1: D2 (ink and shapes), D3 (signatures, magnifier and pictures) and D4 (redaction and attachments). D4 still needs the owner's explicit answers.

## What is built

- **One annotation menu, drawn by the page** (`doc-view.mjs`) at the pointer and kept inside the window on every device class. It opens on:
  - a right-click in the document (Shift+right-click still gives the browser's own menu);
  - a long press of about 550 ms on a touch screen, without moving more than 10 px (the iOS callout is suppressed; text selection still works);
  - two Pencil taps within 350 ms and 30 px;
  - Shift+F10 or the ContextMenu key.

  It has `role="menu"`, works with the arrow keys, Home and End, and Escape closes it and returns focus. Its items:
  - Highlight, with five colour swatches: yellow, green, blue, pink and orange.
  - Underline and Strikethrough, in the current colour.
  - Insert text: a proofreading caret at the end of the selection, or at the point if nothing is selected.
  - Replace: the selection is struck through and the new words are shown.
  - Comment: the existing composer.
  - Sticky note and Text box, each with a colour, placed at the point.
  - Stamp ▸: ✓, ✗, Approved, Reviewed, and Signed off (the author's name and the date, set by the server).
  - Copy, because the browser's menu is suppressed.

  Items that need a selection are disabled when nothing is selected.
- **Data.** Migration `0006` extends `annotations` with:
  - `kind`, one of nine kinds, and `color`, one of five;
  - `text`, which holds inserted or replacement words or a stamp's name, up to 500 characters;
  - `anchor_path`, `anchor_x` and `anchor_y` for placed marks: an element path from `<html>` such as `body:1/section:2/p:3`, plus the point as fractions of that element's box, so marks stay attached when the page reflows;
  - `updated_at`.

  Existing rows become `comment`. The body may now be empty, for marks such as highlights; comments, notes and text boxes still require one. A new table, `annotation_mentions`, records who is mentioned.
- **Server** (`family/review.rs`).
  - `check_mark` validates each kind: fixed kinds, colours and stamps, length limits, path syntax, fractions from 0 to 1, a place for placed kinds only, and whatever text each kind needs.
  - `POST …/annotations/{id}/update` (`op=edit` or `op=move`) accepts the author only and fetch requests only (form token in a header, plus the Origin check).
  - `GET /api/handles` lists the family handles for @mentions, to members only.
  - Mentions are parsed from comments, notes and text boxes. They match the family's handles only, never inside a word, and never the author.
  - Deletes are audit-logged, as in C.
- **In the document frame** (`frame-helper.js`). The helper:
  - draws coloured highlights, underlines and strikethroughs on the document's own text, and an insertion caret;
  - reports where each placed mark and each inserted or replacement word sits (`hj:positions`), on scroll, resize, layout change and load;
  - answers where a dragged mark landed (`hj:locate` / `hj:located`);
  - shows the Pencil hover ring.
- **Over the frame** (the page). Sticky notes, text boxes, stamps, and inserted or replacement words are drawn in an overlay above the frame, at the positions the helper reports. A mark's author can drag it with a mouse, touch or the Pencil; it is saved when dropped and keeps its place after a reload. A click without a drag opens the mark's entry in the panel, and the entry can jump back to the mark.
- **Panel and Home.**
  - Entries show the kind, colour, words and mentions. Mentions of the viewer are marked, and Edit is shown only to a mark's author.
  - Typing @ offers the family's handles.
  - Home lists "Mentioned you": document, mark, who and when.

## Deviations from the brief, and why

- **Rendering placement.** The brief drew notes, text boxes, stamps, and inserted and replacement words inside the frame; they are drawn **over** it by the page. Anything inside the frame can be read by the document's own scripts and sent to any https image host. Drawing those words outside keeps P2b's rule that people's words never enter the document. The frame receives only places and the document's own text. Dragging also happens in the page, so a move always comes from a real pointer in the family's page, never from the document. The server still checks authorship.
- **Right-clicks on overlay marks.** Right-clicking a note, text box or stamp gives the browser's own menu, because those marks sit outside the document. A click on them opens their entry.
- **Owner's rights.** The owner deletes any mark but edits or moves only their own, as the brief says.

## Invariants and checks

| Invariant | Check |
|---|---|
| Only fixed kinds, colours and stamps; every text bounded; placed marks only with a valid path and fractions | `each_kind_needs_what_it_uses`, `element_paths_and_fractions` (unit); `every_kind_of_mark_round_trips` (database) |
| Only the author edits or moves; author or owner deletes; others refused; edits are fetch-only with the form token and Origin | `only_the_author_edits_or_moves_a_mark` (database) |
| Mentions name family handles only, never inside a word or the author; listed only for the person named; handles for members only | `mentions_are_family_handles_only` (unit); `mentions_are_listed_for_the_people_named` (database) |
| A document cannot create, change, move or delete marks; no message type does | `menu, position and locate messages are checked` (node); doc-view accepts only nine message types, none of which writes a mark |
| People's words never enter the frame | `anchors()` sends kind, colour, quote, prefix, suffix, field, path and fractions only (code read); overlay text is set with `textContent` |
| Old comments keep working | P2b (C) database and browser tests unchanged and passing |
| Menu inside the window on every device class; no CSP breach; no sideways scroll | `tests/browser/p1-flow.mjs`: the markup page in 7 classes, light and dark |

## Evidence (local, 5 November 2026)

- `cargo test --locked --features db-tests`: 40 unit (4 new), 25 database (3 new), 2 Dockerfile and 12 placeholder parity tests pass. `cargo clippy --all-targets --all-features -- -D warnings` and `cargo fmt --check` are clean.
- `node --test "web/test/**/*.test.mjs"`: 37 of 37 (6 new): paths and their resolution, insertion points, double-tap and long-press detection, menu placement on all seven sizes, mention parsing, and message checks.
- `tests/browser/p1-flow.mjs` (release build): 140 of 140 (10 pages × 7 classes × light and dark), including:
  - right-click opens the annotation menu, not the browser's;
  - a green highlight, an underline, a strikethrough, an insertion and a replacement;
  - a pink sticky note dragged and still in its new place after a reload;
  - a text box and an Approved stamp;
  - Shift+F10, the arrow keys and Escape;
  - an @mention shown on the other member's Home, and that member gets no Edit button;
  - a touch long press (on a phone-sized touch context) and two simulated Pencil taps both open the menu;
  - the Pencil hover ring shows.

## Limits

- The Pencil's own double-tap and squeeze are not available to websites; two taps on the screen are used instead. Hover needs an iPad and Pencil that support it.
- Touch and Pencil input were simulated in Chromium (Chrome DevTools Protocol), not tried on a real iPad. The owner's check on a real device is still needed.
- Marks anchor to text by quote and context, and to places by element path. If a later version of the document changes that text or structure, a mark may not find its place. It then stays listed in the panel.

## Owner follow-up: Esc on the right-click menu (5 November 2026, night)

Owner report in chat: "right click menu doesn't have the "Esc" to close it".

- **Esc button:** the menu now has a small **Esc** button at its top right. It closes the menu on a touch screen or with the Pencil, where there is no Escape key. It sits beside the Highlight label, clear of the colours, and is at least 44 px wide.
- **Escape key:** it already closed the menu when the menu had the keyboard. After a mouse right-click, the keyboard can stay inside the document frame, which sits apart from the page. The frame's helper now tells the page when Escape is pressed (`hj:escape`, a message with no data), and the page closes the menu. The document still receives the key, so its own Escape handling (a lightbox, for example) keeps working. Escape anywhere else on the page also closes the menu.
- **Checks:** a JS unit test covers `hj:escape` being accepted with any extra fields dropped. The browser check right-clicks and closes the menu with the Esc button. It then right-clicks again, puts the keyboard in the document and presses Escape. It also checks that the button is at least 44 px wide and does not cover a highlight colour.

## Owner follow-up: a short, grouped menu with pop-up submenus (6 November 2026)

Owner request in chat: the menu "should be short and categorised and contextualise to the document type and capabilities limitation. If cannot add document or features cannot be done should be grey off. Its width and height of menu should be dynamically size but minimal to the device's limitation, device's orientation mode and current window size". The owner pointed to Apple's guidance on context menus. Owner choices, 6 November 2026:
- grey out everything unavailable (option (b));
- submenus pop up in place of the main menu, with "◀ ▼ × …" buttons that work on every menu, and "▲▼ (expand, flow)";
- a "✎ Mark Up" button beside touch selections;
- submenus one font size smaller.

**Research.** Apple Human Interface Guidelines, read 6 November 2026: Context menus, Menus, Edit menus, Apple Pencil and Scribble.
- Followed:
  - Keep context menus short, with the most-used items first.
  - Use no more than about three groups, with separators.
  - Keep submenus one level deep and about five items.
  - Put destructive items last, in red.
  - Use short, title-style labels, with an ellipsis when more input follows.
  - Keep the menu no taller than the window.
- Departed from, by owner choice: Apple advises hiding unavailable items in a context menu. Here they are greyed out and say why.

**Design.**
- **Main menu, 8 rows in three groups:** the highlight colours, Text ›, Comment…; Note ›, Stamp ›, Signature ›, Draw ›; Redact, last and in red.
- **Submenus:**
  - Text: Underline, Strikethrough, Replace…, Insert Text…, Copy.
  - Note: Sticky Note…, Text Box…, Attach File….
  - Stamp: the five stamps.
  - Signature: Place My Signature, Change My Signature….
  - Draw: Pen, Sketch, Rectangle, Oval, Line, Arrow, Eraser.
  - Loupe is under … on the main menu.
- **Popping up:** a submenu, the … panel and the forms (Insert, Replace, Sticky Note, Text Box) take the main menu's place, so the menu never grows.
- **The bar on every menu:**
  - **◀** goes back; it is greyed on the main menu.
  - **▼** folds the menu to its bar and **▲** unfolds it.
  - **…** shows the menu's less-used items and why items are grey; it is greyed when there is nothing more.
  - **×** closes. Esc still closes, ← goes back and → opens a submenu.
- **Greyed items:** unavailable items are greyed (`aria-disabled`) and stay readable. Tapping one shows its reason under the list. The reasons (`unavailable()` in `doc-view.mjs`) are:
  - "Select words first";
  - "Not on pictures";
  - "Press inside the text first";
  - "Press on the document first";
  - "Only the person who added this document, or the owner" (Redact);
  - "Not on pictures yet" (Redact);
  - "This document already has 100 files";
  - "No signature yet: Place My Signature draws one first".
  Redact is now shown, greyed, to members who did not add the document. Before, it was hidden from them.
- **Size and place:** the width fits the longest label, from 200 to 300 px and never wider than the window minus 16 px. The height fits the rows and is never taller than the window minus 16 px; the list scrolls inside if needed. Submenu items are 0.875 rem against 1 rem on the main menu. On touch screens every row and bar button is at least 44 px. The menu opens beside the finger, Pencil or pointer, flips to stay inside the window, and is placed again when the window is resized or the device is rotated.
- **✎ Mark Up:**
  - When words are selected with a finger or the Pencil, the helper reports where they are (`hj:selection` gains `input` and `box`, both validated). The page shows a ✎ Mark Up button below them, or above them near the bottom of the window. This is clear of iPadOS's own Copy bar, which a web page cannot change.
  - Tapping the button asks the helper to open the menu for those words (`hj:menu-at`).
  - The button hides when the selection ends, the menu opens, the window changes or anything else is touched.
- **Checks:**
  - Node tests cover the menu's shape (main menu at most 8 rows; at most three groups and seven items per menu; submenus one level; Redact last and destructive), every reason, and the new selection fields.
  - The browser check covers:
    - the bar's four buttons, ◀ greyed on the main menu, and the main menu at most 8 rows;
    - the Text submenu replacing the main menu, with a smaller font;
    - ▼ folding and ▲ unfolding, ◀ going back and × closing;
    - grey colours and a reason with nothing selected, and … showing Loupe and the reasons;
    - ✎ Mark Up appearing beside a touch selection and opening the menu with the words;
    - Redact greyed for another member and on pictures.
    Every earlier menu step now reaches its item through its submenu.
- **Not verifiable here:** whether iPadOS shows its own Copy bar and ✎ Mark Up together without overlap on a real iPad. Apple Pencil Pro's squeeze is not available to web pages.

## Owner follow-up: ✎ Mark Up with the Pencil (6 November 2026)

Owner report in chat: "Issue with Pencil: I click "Mark Up" but show default context menu and not you created."

- **Likely cause (inferred, not seen on a device):** iPad keeps its own edit menu (Copy, Look Up, Translate and so on) for as long as words are selected in the page. Tapping ✎ Mark Up opened our menu, but the selection stayed, so iPad's menu sat on top of ours. A tap outside the page can also clear the selection a moment before the menu asks for the words, which leaves the word tools grey.
- **Change:** once our menu opens with the words from a finger or the Pencil, the page lets go of its own selection, and iPad's edit menu goes with it. The menu keeps the words, so highlight, underline, comment and the rest still apply to them. When the tap on ✎ Mark Up has already cleared the selection, the menu uses the words reported just before (within 3 seconds of their going). Mouse and keyboard keep the selection as before.
- **Checks:** `tests/browser/p1-flow.mjs` selects words by touch and by Pencil, taps ✎ Mark Up, and checks that the menu opens with the word tools ready and the page's own selection is gone. It also clears the selection before the menu is asked for, and checks that the menu still has the words. iPad itself cannot be driven from the test machine, so the owner's check on the iPad is the final one.
