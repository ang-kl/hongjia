// D4: the page's pure helpers for redaction and attachments, and the frame helper's new kinds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileSize, typeWords, unavailable, MAX_ATTACHMENTS, nameParts } from '../assets/doc-view.mjs';

test('file sizes read as the panel shows them', () => {
  assert.equal(fileSize(0), '0 bytes');
  assert.equal(fileSize(820), '820 bytes');
  assert.equal(fileSize(1023), '1023 bytes');
  assert.equal(fileSize(12 * 1024 + 100), '12 KB');
  assert.equal(fileSize(3_565_158), '3.4 MB');
  assert.equal(fileSize(10 * 1024 * 1024), '10.0 MB');
  assert.equal(fileSize(null), '0 bytes');
});

test('attached file types have plain names', () => {
  assert.equal(typeWords('pdf'), 'PDF');
  assert.equal(typeWords('docx'), 'Word document');
  assert.equal(typeWords('doc'), 'Word document');
  assert.equal(typeWords('xlsx'), 'Excel workbook');
  assert.equal(typeWords('ppt'), 'PowerPoint');
  assert.equal(typeWords('png'), 'PNG picture');
  assert.equal(typeWords('csv'), 'CSV');
  assert.equal(typeWords('txt'), 'Plain text');
  assert.equal(typeWords('<b>'), 'Plain text', 'unknown types never echo what was sent');
});

test('Redact works only for the uploader and the owner, on selected words, never on a picture; otherwise it is greyed with the reason', () => {
  const words = { quote: true, place: true, picture: false, manager: true };
  assert.equal(unavailable('redact', words), '');
  assert.match(unavailable('redact', { ...words, manager: false }), /added this document, or the owner/);
  assert.equal(unavailable('redact', { ...words, picture: true }), 'Not on pictures yet');
  assert.equal(unavailable('redact', { ...words, quote: false }), 'Select words first');
});

test('Attach File is greyed at the file limit', () => {
  assert.equal(unavailable('attach', { place: true, attachments: MAX_ATTACHMENTS - 1 }), '');
  assert.match(unavailable('attach', { place: true, attachments: MAX_ATTACHMENTS }), /already has 100 files/);
});

test('the frame helper draws pending redactions as black boxes and places attachments', async () => {
  const source = await readFile(new URL('../assets/frame-helper.js', import.meta.url), 'utf8');
  assert.match(source, /mark\[data-hj-kind=redaction\]\{background:#000 !important;color:#000 !important/);
  assert.match(source, /var PLACED = \{[^}]*attachment: 1/);
  assert.match(source, /var KINDS = \{[^}]*redaction: 1, attachment: 1/);
});

test('the picker offers the same types the server allows', async () => {
  const attach = await readFile(new URL('../../crates/web/src/family/attach.rs', import.meta.url), 'utf8');
  const accept = /pub const ACCEPT: &str = "([^"]+)";/.exec(attach)[1].split(',');
  assert.deepEqual(accept, ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt', '.txt', '.csv']);
  for (const ext of ['.html', '.htm', '.svg', '.js', '.exe', '.zip']) assert.equal(accept.includes(ext), false, ext);
});

test('a pin keeps the end of a long file name, so two versions never look the same (9 November 2026)', async () => {
  assert.deepEqual(nameParts('Kuala-Lumpur-trip-data-v4.txt'), ['Kuala-Lumpur-trip-data', '-v4.txt']);
  assert.deepEqual(nameParts('Kuala-Lumpur-trip-data-v1.txt'), ['Kuala-Lumpur-trip-data', '-v1.txt']);
  assert.deepEqual(nameParts('Trip_notes_final_v12.pdf'), ['Trip_notes_final', '_v12.pdf']);
  assert.deepEqual(nameParts('Packing list 2.docx'), ['Packing list', ' 2.docx']);
  assert.deepEqual(nameParts('report.pdf'), ['report', '.pdf'], 'no "-", "_" or space: the file type stays');
  assert.deepEqual(nameParts('notes'), ['notes', ''], 'nothing to keep: the name shrinks from its end as before');
  assert.deepEqual(nameParts('-v2.txt'), ['-v2', '.txt'], 'a name that starts with "-" keeps more than its end');
  assert.deepEqual(nameParts('a-averyveryverylongendpart.txt'), ['a-averyveryverylongendpart', '.txt'], 'a very long end: only the file type stays');
  assert.deepEqual(nameParts(''), ['', '']);
  assert.deepEqual(nameParts(null), ['', '']);
  for (const n of ['Kuala-Lumpur-trip-data-v4.txt', 'report.pdf', 'notes', 'Packing list 2.docx']) assert.equal(nameParts(n).join(''), n, 'the two parts are the whole name');
  // the start shrinks with "…" and the end never does
  const css = (await readFile(new URL('../assets/site.css', import.meta.url), 'utf8')).replace(/\s+/g, ' ');
  assert.match(css, /\.ov-attachment \.clip-head \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/);
  assert.match(css, /\.ov-attachment \.clip-tail \{ flex: none; \}/);
});

test('pins and notes step aside while a trip page plays its tour (9 November 2026)', async () => {
  const css = (await readFile(new URL('../assets/site.css', import.meta.url), 'utf8')).replace(/\s+/g, ' ');
  assert.match(css, /html\.tour-on \.doc-overlay \{ visibility: hidden; \}/);
  const js = await readFile(new URL('../assets/doc-view.mjs', import.meta.url), 'utf8');
  assert.match(js, /root\.classList\.toggle\('tour-on', on\)/, 'the tour message sets and clears the class');
});

test('pins and notes step aside while a trip page shows its islands (10 November 2026)', async () => {
  const css = (await readFile(new URL('../assets/site.css', import.meta.url), 'utf8')).replace(/\s+/g, ' ');
  assert.match(css, /html\.islands-on \.doc-overlay \{ visibility: hidden; \}/);
  assert.match(css, /html\.islands-on \.menu-fab, html\.islands-on \.fab-scope, html\.islands-on \.fab-group \{ display: none !important; \}/, 'and ☰ and 🔭 on a phone');
  const js = await readFile(new URL('../assets/doc-view.mjs', import.meta.url), 'utf8');
  assert.match(js, /root\.classList\.toggle\('islands-on', state === 'open'\)/, 'the islands message sets and clears the class');
});

test('the header lists: an older version is view only, and files listed with a version are not pinned (9 November 2026)', async () => {
  const js = await readFile(new URL('../assets/doc-view.mjs', import.meta.url), 'utf8');
  assert.match(js, /const older = body\.dataset\.older === 'true';/);
  assert.match(js, /if \(older && \['hj:field', 'hj:storage', 'hj:selection', 'hj:focus', 'hj:menu'\]\.includes\(message\.type\)\) return;/, 'nothing typed is saved and no marks are made');
  assert.match(js, /if \(!OVERLAID\.has\(kind\) \|\| unpinned\.has\(id\)\) continue;/, 'files listed with their version are not pinned');
  assert.match(js, /window\.addEventListener\('blur', closePicks\);/, 'a click in the document closes the lists');
  const css = (await readFile(new URL('../assets/site.css', import.meta.url), 'utf8')).replace(/\s+/g, ' ');
  assert.match(css, /\.doc-pick > summary::-webkit-details-marker \{ display: none; \}/);
});

