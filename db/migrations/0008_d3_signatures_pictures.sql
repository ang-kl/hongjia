-- D3: saved signatures, placed signatures and pictures.

-- One saved signature per person: drawn strokes or a typed name, never an uploaded image.
--   strokes  "x,y,p x,y,p;x,y,p ..." on a 600 x 200 pad (p = pen pressure, 0 to 1), strokes split by ";"
--   typed    the name as typed, shown in a script-style font
CREATE TABLE signatures (
    profile_id  SMALLINT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    style       TEXT NOT NULL CHECK (style IN ('drawn', 'typed')),
    strokes     TEXT CHECK (char_length(strokes) BETWEEN 3 AND 16000),
    typed       TEXT CHECK (char_length(typed) BETWEEN 1 AND 60),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT signatures_value_check CHECK (
        (style = 'drawn' AND strokes IS NOT NULL AND typed IS NULL)
        OR (style = 'typed' AND typed IS NOT NULL AND strokes IS NULL)
    )
);

-- A placed signature is a mark of kind 'signature' at a point of the document. It keeps a copy of
-- the signer's signature as it was when placed (drawn strokes in points, or the typed name in
-- text), so replacing a saved signature never changes what was already signed.
ALTER TABLE annotations DROP CONSTRAINT annotations_kind_check;
ALTER TABLE annotations ADD CONSTRAINT annotations_kind_check CHECK (kind IN (
    'comment', 'highlight', 'underline', 'strike', 'insert', 'replace', 'note', 'textbox', 'stamp', 'ink', 'shape',
    'signature'
));
ALTER TABLE annotations DROP CONSTRAINT annotations_drawing_check;
ALTER TABLE annotations ADD CONSTRAINT annotations_drawing_check CHECK (
    CASE WHEN kind IN ('ink', 'shape')
        THEN tool IS NOT NULL AND points IS NOT NULL AND stroke_width IS NOT NULL AND ref_width IS NOT NULL
             AND anchor_path IS NOT NULL
             AND (kind = 'ink') = (tool IN ('draw', 'sketch'))
    WHEN kind = 'signature'
        THEN anchor_path IS NOT NULL AND tool IS NULL AND stroke_width IS NULL AND ref_width IS NULL
             AND ref_height IS NULL
             AND ((points IS NOT NULL AND text = '') OR (points IS NULL AND char_length(text) BETWEEN 1 AND 60))
        ELSE tool IS NULL AND points IS NULL AND stroke_width IS NULL AND ref_width IS NULL AND ref_height IS NULL
    END
);

-- Pictures: JPEG, PNG or WebP (recognised by their first bytes), shown in the viewer as a small
-- generated page with the picture inside it, so every mark and drawing works on them too.
ALTER TABLE document_versions DROP CONSTRAINT document_versions_kind_check;
ALTER TABLE document_versions ADD CONSTRAINT document_versions_kind_check
    CHECK (kind IN ('html', 'text', 'picture'));
ALTER TABLE document_versions ADD COLUMN image_type TEXT CHECK (image_type IN ('jpeg', 'png', 'webp'));
ALTER TABLE document_versions ADD COLUMN image_width INTEGER CHECK (image_width BETWEEN 1 AND 100000);
ALTER TABLE document_versions ADD COLUMN image_height INTEGER CHECK (image_height BETWEEN 1 AND 100000);
ALTER TABLE document_versions ADD CONSTRAINT document_versions_picture_check CHECK (
    (kind = 'picture') = (image_type IS NOT NULL AND image_width IS NOT NULL AND image_height IS NOT NULL)
);
