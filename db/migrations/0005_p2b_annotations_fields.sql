-- P2b (C): saved form fields and annotations.

-- The uploader (or the owner) chooses whether what people fill in is one family copy ('shared')
-- or kept for each person ('personal'). Switching keeps both sets; each mode shows its own.
ALTER TABLE documents ADD COLUMN fields_mode TEXT NOT NULL DEFAULT 'shared'
    CHECK (fields_mode IN ('shared', 'personal'));

-- What people fill in ('field') and what a document keeps in browser storage ('storage').
-- scope_profile_id is NULL for the shared copy, or the person for a personal copy.
CREATE TABLE document_fields (
    id                BIGSERIAL PRIMARY KEY,
    document_id       BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    scope_profile_id  SMALLINT REFERENCES profiles(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK (kind IN ('field', 'storage')),
    key               TEXT NOT NULL CHECK (char_length(key) BETWEEN 1 AND 200),
    label             TEXT NOT NULL DEFAULT '' CHECK (char_length(label) <= 200),
    value             TEXT NOT NULL CHECK (char_length(value) <= 8000),
    updated_by        SMALLINT REFERENCES profiles(id) ON DELETE SET NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT document_fields_unique UNIQUE NULLS NOT DISTINCT (document_id, scope_profile_id, kind, key)
);
CREATE INDEX document_fields_recent_idx ON document_fields (document_id, updated_at DESC);

-- Word-style annotations: a comment on a quoted passage (with a few words either side to find it
-- again), on a form field, or on the document as a whole.
CREATE TABLE annotations (
    id           BIGSERIAL PRIMARY KEY,
    document_id  BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_no   INTEGER NOT NULL CHECK (version_no >= 1),
    author       SMALLINT REFERENCES profiles(id) ON DELETE SET NULL,
    quote        TEXT NOT NULL DEFAULT '' CHECK (char_length(quote) <= 1000),
    prefix       TEXT NOT NULL DEFAULT '' CHECK (char_length(prefix) <= 64),
    suffix       TEXT NOT NULL DEFAULT '' CHECK (char_length(suffix) <= 64),
    field_key    TEXT CHECK (char_length(field_key) BETWEEN 1 AND 200),
    field_label  TEXT NOT NULL DEFAULT '' CHECK (char_length(field_label) <= 200),
    body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX annotations_document_idx ON annotations (document_id, created_at);
