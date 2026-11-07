-- The owner's choice of 7 November 2026: approximate locations are kept to about 40 km (0.4 of a
-- degree) instead of about 11 km. Locations already stored are rounded the same way now, so what is
-- kept matches what the site says. Still held as tenths of a degree, now always a multiple of 4.
-- ROUND on numeric rounds halves away from zero, as the server does. Running it twice changes nothing.
UPDATE sessions
SET lat_tenths = (ROUND(lat_tenths / 4.0) * 4)::smallint,
    lon_tenths = (ROUND(lon_tenths / 4.0) * 4)::smallint
WHERE lat_tenths IS NOT NULL OR lon_tenths IS NOT NULL;
