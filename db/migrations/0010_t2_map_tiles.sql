-- T2: map pictures (tiles) for trip pages, fetched by the server from OpenStreetMap and kept here,
-- because a page in the site's locked frame cannot ask OpenStreetMap itself (it sends no Referer).
-- OpenStreetMap's tile policy asks a relaying server to keep each tile for at least 7 days or as
-- long as its caching headers say; keeping them in the database lets the copies outlive restarts.
CREATE TABLE map_tiles (
    z          smallint    NOT NULL CHECK (z BETWEEN 0 AND 19),
    x          integer     NOT NULL CHECK (x >= 0),
    y          integer     NOT NULL CHECK (y >= 0),
    png        bytea       NOT NULL CHECK (octet_length(png) <= 524288),
    fetched_at timestamptz NOT NULL DEFAULT now(),
    keep_until timestamptz NOT NULL,
    PRIMARY KEY (z, x, y)
);
CREATE INDEX map_tiles_fetched_at ON map_tiles (fetched_at);
