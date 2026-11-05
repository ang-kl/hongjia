-- P2b: dated filing numbers (yyyy-mmdd_N, the day in Singapore time), hashtags and the upload check.

-- Each day's numbers come from a counter, so a number is never given out twice, even after a delete.
CREATE TABLE filing_counters (
    filed_on  DATE PRIMARY KEY,
    last_no   INTEGER NOT NULL CHECK (last_no >= 1)
);

ALTER TABLE documents ADD COLUMN filed_on DATE;
ALTER TABLE documents ADD COLUMN day_no INTEGER;
UPDATE documents SET filed_on = (created_at AT TIME ZONE 'Asia/Singapore')::date;
UPDATE documents d SET day_no = n.rn
FROM (SELECT id, row_number() OVER (PARTITION BY filed_on ORDER BY created_at, id) AS rn FROM documents) n
WHERE n.id = d.id;
ALTER TABLE documents ALTER COLUMN filed_on SET NOT NULL;
ALTER TABLE documents ALTER COLUMN day_no SET NOT NULL;
ALTER TABLE documents ADD CONSTRAINT documents_day_no_check CHECK (day_no >= 1);
ALTER TABLE documents ADD CONSTRAINT documents_filing_unique UNIQUE (filed_on, day_no);
INSERT INTO filing_counters (filed_on, last_no)
SELECT filed_on, max(day_no) FROM documents GROUP BY filed_on;

-- Hashtags: lowercase letters and digits in any script, without the leading #.
CREATE TABLE document_tags (
    document_id  BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag          TEXT NOT NULL CHECK (char_length(tag) BETWEEN 1 AND 40),
    pos          SMALLINT NOT NULL DEFAULT 0,
    PRIMARY KEY (document_id, tag)
);
CREATE INDEX document_tags_tag_idx ON document_tags (tag);

-- The upload check, worked out once per version when it is uploaded.
ALTER TABLE document_versions ADD COLUMN libraries TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE document_versions ADD COLUMN style_guess TEXT;
ALTER TABLE document_versions ADD COLUMN warnings TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE document_versions ADD COLUMN field_count INTEGER NOT NULL DEFAULT 0;
-- Versions uploaded before the check existed are checked when the server starts.
ALTER TABLE document_versions ADD COLUMN checked BOOLEAN NOT NULL DEFAULT false;
