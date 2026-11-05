// D4: the page's pure helpers for redaction and attachments, and the frame helper's new kinds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileSize, typeWords, unavailable, MAX_ATTACHMENTS } from '../assets/doc-view.mjs';

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
