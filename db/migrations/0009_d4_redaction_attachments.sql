-- D4: redaction and file attachments.

-- Two new kinds of mark:
--   redaction   a passage the document's uploader or the owner wants blacked out; pending until
--               someone with that right applies the redactions (a new version is then made with
--               the passages blacked out, and every older version is deleted for good)
--   attachment  a file pinned at a point of the document (like a sticky note); the file itself is
--               kept in document_attachments and is only ever downloaded, never shown in the site
ALTER TABLE annotations DROP CONSTRAINT annotations_kind_check;
ALTER TABLE annotations ADD CONSTRAINT annotations_kind_check CHECK (kind IN (
    'comment', 'highlight', 'underline', 'strike', 'insert', 'replace', 'note', 'textbox', 'stamp', 'ink', 'shape',
    'signature', 'redaction', 'attachment'
));
-- A pending redaction marks a passage of the document's own text and nothing else; an attachment
-- is placed at a point and names its file in text.
ALTER TABLE annotations ADD CONSTRAINT annotations_d4_check CHECK (
    CASE WHEN kind = 'redaction'
        THEN char_length(quote) >= 1 AND body = '' AND text = '' AND anchor_path IS NULL AND field_key IS NULL
    WHEN kind = 'attachment'
        THEN anchor_path IS NOT NULL AND char_length(text) BETWEEN 1 AND 200 AND quote = '' AND body = ''
        ELSE TRUE
    END
);

-- When the redactions were last applied and by whom (shown with the versions: the older versions
-- were removed then). The redacted words themselves are never recorded anywhere.
ALTER TABLE documents ADD COLUMN redacted_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN redacted_by SMALLINT REFERENCES profiles(id) ON DELETE SET NULL;

-- Attached files: one per attachment mark, deleted with the mark or the document.
--   file_type  what the first bytes and the name agree it is (an allow-list; see family/attach.rs)
CREATE TABLE document_attachments (
    id             BIGSERIAL PRIMARY KEY,
    document_id    BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    annotation_id  BIGINT NOT NULL UNIQUE REFERENCES annotations(id) ON DELETE CASCADE,
    filename       TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
    file_type      TEXT NOT NULL CHECK (file_type IN (
        'jpeg', 'png', 'webp', 'pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'txt', 'csv'
    )),
    size_bytes     INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    sha256         BYTEA NOT NULL,
    content        BYTEA NOT NULL,
    uploaded_by    SMALLINT REFERENCES profiles(id) ON DELETE SET NULL,
    uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX document_attachments_doc_idx ON document_attachments (document_id);
