-- Hide (the owner, 7 November 2026): a hidden document leaves the family's lists, the globe, search and
-- the landing page for everyone, but is kept; whoever added it, or the owner, can bring it back.
ALTER TABLE documents
    ADD COLUMN hidden_at TIMESTAMPTZ,
    ADD COLUMN hidden_by SMALLINT REFERENCES profiles(id) ON DELETE SET NULL;
