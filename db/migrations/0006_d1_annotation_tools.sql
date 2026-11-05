-- D1: annotation tools. Every mark is a row in annotations, of one kind:
--   comment     a comment on a passage, a field or the whole document (P2b C)
--   highlight, underline, strike   a coloured mark on a passage
--   insert      a proofreading caret with text to insert (at the end of a passage or at a point)
--   replace     a passage struck through, with replacement text
--   note, textbox, stamp           placed at a point of the document: an element path plus
--                                  x and y as fractions of that element's box
-- Existing rows become comments.

ALTER TABLE annotations ADD COLUMN kind TEXT NOT NULL DEFAULT 'comment'
    CHECK (kind IN ('comment', 'highlight', 'underline', 'strike', 'insert', 'replace', 'note', 'textbox', 'stamp'));
ALTER TABLE annotations ADD COLUMN color TEXT NOT NULL DEFAULT 'yellow'
    CHECK (color IN ('yellow', 'green', 'blue', 'pink', 'orange'));
-- Inserted or replacement text, or the stamp's name (check, cross, approved, reviewed, signedoff).
ALTER TABLE annotations ADD COLUMN text TEXT NOT NULL DEFAULT '' CHECK (char_length(text) <= 500);
ALTER TABLE annotations ADD COLUMN anchor_path TEXT CHECK (char_length(anchor_path) BETWEEN 1 AND 400);
ALTER TABLE annotations ADD COLUMN anchor_x DOUBLE PRECISION CHECK (anchor_x BETWEEN 0 AND 1);
ALTER TABLE annotations ADD COLUMN anchor_y DOUBLE PRECISION CHECK (anchor_y BETWEEN 0 AND 1);
ALTER TABLE annotations ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE annotations SET updated_at = created_at;
-- Marks such as a highlight need no comment, so the body may now be empty (the server still
-- requires one for comments, notes and text boxes).
ALTER TABLE annotations DROP CONSTRAINT annotations_body_check;
ALTER TABLE annotations ADD CONSTRAINT annotations_body_check CHECK (char_length(body) <= 4000);
-- A placed mark has all three anchor values; other marks have none.
ALTER TABLE annotations ADD CONSTRAINT annotations_anchor_check CHECK (
    (anchor_path IS NULL AND anchor_x IS NULL AND anchor_y IS NULL)
    OR (anchor_path IS NOT NULL AND anchor_x IS NOT NULL AND anchor_y IS NOT NULL)
);

-- @mentions, shown inside the site only (Home: "Mentioned you"). Never sent by email, SMS or push.
CREATE TABLE annotation_mentions (
    annotation_id  BIGINT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
    profile_id     SMALLINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    PRIMARY KEY (annotation_id, profile_id)
);
CREATE INDEX annotation_mentions_profile_idx ON annotation_mentions (profile_id);
