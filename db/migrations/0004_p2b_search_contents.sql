-- P2b (B): plain text for 🛰️ search and headings for 📁 contents, kept per version.
ALTER TABLE document_versions ADD COLUMN text_content TEXT NOT NULL DEFAULT '';
ALTER TABLE document_versions ADD COLUMN heading_levels SMALLINT[] NOT NULL DEFAULT '{}';
ALTER TABLE document_versions ADD COLUMN heading_ids TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE document_versions ADD COLUMN heading_texts TEXT[] NOT NULL DEFAULT '{}';
-- Versions uploaded before search existed are indexed when the server starts.
ALTER TABLE document_versions ADD COLUMN indexed BOOLEAN NOT NULL DEFAULT false;
