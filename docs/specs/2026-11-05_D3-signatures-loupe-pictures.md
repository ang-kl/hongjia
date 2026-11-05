---
flow: spec
title: "D3 - Signatures, the loupe and pictures"
act: "directive"
force: "MUST"
status: "Built on the owner's instruction \"continue to build until it's finished\" (5 November 2026), on top of D2 (PR #11). Merge needs the owner's go-ahead."
scope:
  - "crates/web/**"
  - "db/migrations/0008_d3_signatures_pictures.sql"
  - "web/assets/signature.mjs"
  - "web/assets/doc-view.mjs"
  - "web/assets/ink.mjs"
  - "web/assets/frame-helper.js"
  - "web/assets/site.css"
  - "web/test/signature.test.mjs"
  - "tests/browser/p1-flow.mjs"
  - "docs/specs/2026-11-05_D3-signatures-loupe-pictures.md"
  - "README.md"
---

# D3 - Signatures, the loupe and pictures

Version 0.1 · 5 November 2026 · Asia/Singapore · follows D2 (drawing over documents).

## Owner request and decisions

These come from the owner's list in chat (5 November 2026):

- "Signatures: Add hand-drawn signatures using your trackpad."
- "Place digital or hand-drawn signature."
- "Loupe Tool: Magnify a specific area of the document."
- The earlier Apple Pencil request: "overlay and save for that html or document or picture".

The owner said "build" after the plan in chat № 38, so its recommended defaults are used:

- Signatures are hand-drawn or typed now. Camera signatures come later, and the camera stays blocked by the site's Permissions-Policy.
- A "digital signature" here is a typed name in a script style with the date and time. It is not a legal certificate.

D1's rules apply to placed signatures: any member may sign, only the signer moves a signature, and the signer or the owner deletes it. D4 (redaction and attachments) is not part of this; it still needs the owner's explicit answers.

## What is built

### Signatures

- **The menu.** The annotation menu (right-click, a long press, two Pencil taps, or Shift+F10) gains:
  - **Signature…** places your saved signature at the point. If you have none yet, the signature pad opens first, and the signature is placed as soon as it is saved.
  - **My signature…** opens the pad to change or delete your saved signature.
- **The pad** is a dialog drawn by the page, with Draw and Type tabs.
  - Draw works with a mouse, a trackpad, a finger or the Apple Pencil. Pencil pressure varies the line, and once a Pencil has been seen, the palm is ignored.
  - Type shows the name in a script-style system font: "Snell Roundhand", "Segoe Script", "Brush Script MT", "Apple Chancery", then cursive.
  - Its other controls are Clear, Save, Cancel and "Delete my saved signature". Tab stays inside the dialog, and Escape closes it.
- **Saved signatures.** Each person has one, in the new `signatures` table (migration `0008`). It is stored as checked numbers or as plain text, never as an uploaded image:
  - **Drawn:** strokes on a 600 x 200 pad, as `x,y,p` points separated by spaces and strokes separated by `;`. At most 60 strokes and 1200 points. A little spill over the edge is clamped, and the stored form is tidied.
  - **Typed:** a name of 1 to 60 characters, with no control characters.
  - `GET /api/signature` returns your own saved signature. `POST /api/signature` saves or deletes it; it is fetch only, with the form token in a header and the Origin check. Saves and deletes are audit-logged.
- **Placed signatures.** A placed signature is an annotation of the new kind `signature`, anchored like a sticky note.
  - The server copies the signer's own saved signature into it when it is placed: the strokes into `points`, or the name into `text`. A request cannot name a signature; strokes or a name in the request are refused. So nobody can place someone else's signature, and replacing a saved signature never changes what was already signed.
  - Placing with no saved signature returns 409, and the page then opens the pad.
  - The caption comes from the server: "Signed by NAME, DD Mon YYYY, HH:MM (SGT)".
  - A signature can be moved by its signer and deleted by its signer or the owner. It is never edited; Edit is not offered and the server refuses it.
  - A check constraint gives signatures a place and either strokes or a name, and none of a drawing's values.
- **Drawn over the frame.** Like D1's notes and stamps, signatures are drawn by the page over the frame, never inside the document. The document's own scripts cannot read them.

### The loupe

- **Opening it.** **Loupe** is in the annotation menu, and the drawing toolbar has a Loupe button, so the loupe can follow the pen while drawing. A small set of controls at the top shows 2×, 3× and Close.
- **How it works.** The lens is drawn by the helper inside the frame, from a copy of the document's own content with its scripts removed. It is a 180 px circle, or 45% of the frame's width on narrow screens.
  - The page sends only the magnification, plus the pointer's place while the drawing surface covers the frame. No annotation data enters the document.
  - The lens follows the mouse, the Pencil (hovering or drawing) and a finger; on a touch screen it sits above the finger.
  - A click or a tap in the document closes it, and so does Escape.
  - It opens where the pointer last was.
- **Long documents.** A page with more than 20000 elements is refused, because a copy that large would be slow. The page then suggests pinch or browser zoom instead.

### Pictures

- **What is accepted.** Uploads accept JPEG, PNG and WebP, up to 10 MB.
  - The **first bytes decide**, not the name. A file named `.png` that is really HTML is refused, and a PNG named `.jpg` is accepted as a PNG. GIF is not accepted.
  - The width and height are read from the file's header: PNG IHDR; JPEG start-of-frame (baseline, progressive or lossless; DHT, JPG and DAC are skipped); WebP VP8, VP8L or VP8X.
  - iPhone photos arrive as JPEG through Safari's photo picker.
- **A document like any other.** A picture has a filing number, hashtags suggested from its file name, versions, "org" download of the original, and the same delete rules.
  - The upload check reports "Picture: WIDTH x HEIGHT (TYPE)" in place of the HTML check.
  - Search finds a picture by its title, its hashtags and its file name, which is kept as its searchable text.
  - "org" downloads the stored picture byte for byte, as `image/jpeg`, `image/png` or `image/webp`.
- **In the viewer.** The frame shows a small generated page: the picture alone, as wide as the frame, its height following its own shape.
  - The picture is embedded as a `data:` address, because the frame's opaque origin could not load a hongjia.org address with the person's session, and `DOCUMENT_CSP` already allows `data:` images.
  - The page carries the same helper as an HTML document, so every D1, D2 and D3 mark, drawing and signature works on pictures.
  - Marks anchor to the picture itself (`img` is a text block for anchoring since D2's review fix), so they keep their place at any width.
  - The title is escaped, and the stored file never changes.

## Invariants and checks

| Invariant | Check |
|---|---|
| Saved signatures are checked numbers or text, never images; one per person; only their owner reads, saves or deletes them | `drawn_strokes_are_checked_and_tidied`, `typed_names_are_checked` (unit); `signatures_are_saved_per_person_and_placed_only_as_your_own` (database) |
| A placed signature is always the signer's own, copied when placed; a request cannot supply strokes or a name; replacing a saved one does not change what was signed | same database test (forged points and names refused, the earlier strokes unchanged after a replacement) |
| Only the signer moves a signature; nobody edits one; the signer or the owner deletes it | same database test; the browser check (no Edit offered, another member's overlay not draggable) |
| The caption is the server's: "Signed by NAME, DD Mon YYYY, HH:MM (SGT)" | database test (the date from PostgreSQL in Singapore time); the browser check (regular expression on the caption) |
| Pictures are recognised by their first bytes and sized from their header | `pictures_are_recognised_by_their_first_bytes`, `other_files_are_not_pictures` (unit); `pictures_are_recognised_shown_and_downloaded` (database) |
| The frame gets a generated page with the picture as `data:`, and "org" returns the stored bytes | same database test; `base64_matches_the_standard`, `the_picture_page_escapes_its_title` (unit) |
| No annotation data enters the document for the loupe; it centres the point under the pointer | `loupe messages from the frame are checked`, `the loupe centres the point under the pointer` (node); the browser check (under the pointer, follows it, 3×, Escape and a click close it) |
| `DOCUMENT_CSP`, `IFRAME_SANDBOX` and the family CSP are unchanged | the existing policy tests pass unchanged |
| Marks on a picture keep their place after a reload and on a phone | browser check: a sticky note and a drawing within 2 to 3% of the picture's size |
| All seven device classes, light and dark, with no CSP breach and no sideways scroll | `tests/browser/p1-flow.mjs`: 13 pages × 7 classes × 2 schemes |

## Evidence (local, 5 November 2026)

- `cargo test --locked --features db-tests`: 49 unit (6 new), 30 database (2 new), 2 Dockerfile and 12 placeholder parity tests pass. `cargo clippy --all-targets --all-features -- -D warnings` and `cargo fmt --check` are clean.
- `node --test "web/test/**/*.test.mjs"`: 52 of 52 (6 new: stored strokes, caps, typed names, loupe messages and layout).
- `tests/browser/p1-flow.mjs` (release build): 182 of 182. These include:
  - A signature drawn with the mouse on the pad and placed with its caption, then a second one placed at once with no pad.
  - Another member's typed signature, placed as theirs, with only their own draggable.
  - The loupe: under the pointer, following it, at 2× and 3×, and closed by Escape and by a click. Its controls fit a notebook and a phone.
  - A generated PNG picture shown at its own size, with a sticky note and a drawing that stay in place after a reload and on a phone.
- **Fixed while testing.**
  - The loupe controls' label took the whole row and clipped Close.
  - A placed signature's pale background washed out the words under it.
  - Signature entries offered an Edit that the server refuses.
  - The loupe opened at a default place when a pointer move arrived just before it opened; it now opens where the pointer last was.

## Limits

- The loupe's copy is made when it opens. Changes the document makes to itself afterwards appear the next time it opens, and so do marks drawn over the frame (notes, signatures, drawings): those stay outside the document by design.
- Camera signatures are not offered (the owner's default; the camera stays blocked).
- HEIC files are not accepted directly; Safari's photo picker sends JPEG. GIF and other formats are refused.
- Touch and the Pencil were simulated in Chromium, not tried on a real iPad.
