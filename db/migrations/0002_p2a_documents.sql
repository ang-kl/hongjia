-- P2a: documents. Each upload is an immutable version; the newest version is shown.
-- Files are kept in PostgreSQL for now (small family documents); a bucket can replace this later.

CREATE TABLE documents (
    id          BIGSERIAL PRIMARY KEY,
    title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    created_by  SMALLINT REFERENCES profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE TABLE document_versions (
    id           BIGSERIAL PRIMARY KEY,
    document_id  BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_no   INTEGER NOT NULL CHECK (version_no >= 1),
    filename     TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
    kind         TEXT NOT NULL CHECK (kind IN ('html', 'text')),
    size_bytes   INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    sha256       BYTEA NOT NULL,
    content      BYTEA NOT NULL,
    uploaded_by  SMALLINT REFERENCES profiles(id) ON DELETE SET NULL,
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_id, version_no)
);
CREATE INDEX document_versions_doc_idx ON document_versions (document_id, version_no DESC);
