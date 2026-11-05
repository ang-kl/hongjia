-- D2: drawings. Two more kinds of annotation, kept in the same table as every other mark so they
-- share its rules (any member adds; the author edits; the author or the owner deletes), its list,
-- its delete and audit path, the per-document limit and the "last change" time:
--   ink    a freehand stroke (tool 'draw', or 'sketch' when no clean shape was recognised)
--   shape  a clean shape (tool 'rectangle', 'oval', 'line' or 'arrow'), drawn with Shapes or
--          recognised from a sketch
-- Each drawing is anchored like a placed mark (an element path plus a point as fractions of that
-- element's box). Its points are in CSS pixels from that element's top-left corner, recorded when
-- the element was ref_width pixels wide; they are scaled by the element's current width when drawn,
-- so a drawing keeps its place when the page reflows or is seen on another device.
--   points        ink: "x,y,p x,y,p ..." (p = pen pressure, 0 to 1); shape: "x1,y1 x2,y2"
--   stroke_width  the line width at the reference size, 1 to 24 pixels

ALTER TABLE annotations DROP CONSTRAINT annotations_kind_check;
ALTER TABLE annotations ADD CONSTRAINT annotations_kind_check CHECK (kind IN (
    'comment', 'highlight', 'underline', 'strike', 'insert', 'replace', 'note', 'textbox', 'stamp', 'ink', 'shape'
));
ALTER TABLE annotations ADD COLUMN tool TEXT
    CHECK (tool IN ('draw', 'sketch', 'rectangle', 'oval', 'line', 'arrow'));
ALTER TABLE annotations ADD COLUMN points TEXT CHECK (char_length(points) BETWEEN 3 AND 16000);
ALTER TABLE annotations ADD COLUMN stroke_width REAL CHECK (stroke_width BETWEEN 1 AND 24);
ALTER TABLE annotations ADD COLUMN ref_width REAL CHECK (ref_width BETWEEN 1 AND 100000);
-- A drawing has all four drawing values and a place; no other mark has any of them.
ALTER TABLE annotations ADD CONSTRAINT annotations_drawing_check CHECK (
    CASE WHEN kind IN ('ink', 'shape')
        THEN tool IS NOT NULL AND points IS NOT NULL AND stroke_width IS NOT NULL AND ref_width IS NOT NULL
             AND anchor_path IS NOT NULL
             AND (kind = 'ink') = (tool IN ('draw', 'sketch'))
        ELSE tool IS NULL AND points IS NULL AND stroke_width IS NULL AND ref_width IS NULL
    END
);
CREATE INDEX annotations_drawings_idx ON annotations (document_id, author, created_at DESC)
    WHERE kind IN ('ink', 'shape');
