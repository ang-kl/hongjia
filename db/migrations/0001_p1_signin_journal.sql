-- P1: individual sign-in, sessions, devices, consent and the login journal.
-- Times are timestamptz (UTC); pages show Singapore time. Locations are stored in tenths of a
-- degree (about 11 km) and only after consent. Secrets are stored as hashes only.

CREATE TABLE profiles (
    id          SMALLSERIAL PRIMARY KEY,
    handle      TEXT NOT NULL UNIQUE CHECK (handle ~ '^[a-z]{1,20}$'),
    position    SMALLINT NOT NULL,
    is_owner    BOOLEAN NOT NULL DEFAULT FALSE,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE credentials (
    profile_id      SMALLINT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    passphrase_hash TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE enrolment_codes (
    code_hash   BYTEA PRIMARY KEY,
    profile_id  SMALLINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ
);

CREATE TABLE devices (
    id_hash     BYTEA PRIMARY KEY,
    label       TEXT CHECK (label IS NULL OR char_length(label) <= 40),
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    id                 BIGSERIAL PRIMARY KEY,
    token_hash         BYTEA NOT NULL UNIQUE,
    profile_id         SMALLINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    device_hash        BYTEA REFERENCES devices(id_hash) ON DELETE SET NULL,
    csrf               TEXT NOT NULL,
    ua_summary         TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_heartbeat_at  TIMESTAMPTZ,
    expires_at         TIMESTAMPTZ NOT NULL,
    ended_at           TIMESTAMPTZ,
    end_reason         TEXT,
    active_seconds     INTEGER NOT NULL DEFAULT 0,
    lat_tenths         SMALLINT CHECK (lat_tenths BETWEEN -900 AND 900),
    lon_tenths         SMALLINT CHECK (lon_tenths BETWEEN -1800 AND 1800),
    location_at        TIMESTAMPTZ
);
CREATE INDEX sessions_created_idx ON sessions (created_at DESC);
CREATE INDEX sessions_profile_idx ON sessions (profile_id, created_at DESC);

CREATE TABLE login_attempts (
    id           BIGSERIAL PRIMARY KEY,
    at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind         TEXT NOT NULL CHECK (kind IN ('signin', 'enrol')),
    profile_id   SMALLINT REFERENCES profiles(id) ON DELETE CASCADE,
    result       TEXT NOT NULL CHECK (result IN ('success', 'failure', 'rate_limited')),
    net_hash     BYTEA NOT NULL,
    device_hash  BYTEA,
    ua_summary   TEXT NOT NULL
);
CREATE INDEX login_attempts_at_idx ON login_attempts (at);

CREATE TABLE consents (
    profile_id        SMALLINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    device_hash       BYTEA NOT NULL REFERENCES devices(id_hash) ON DELETE CASCADE,
    location_allowed  BOOLEAN NOT NULL,
    notice_version    TEXT NOT NULL,
    decided_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, device_hash)
);

CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  INTEGER NOT NULL
);
INSERT INTO settings (key, value) VALUES
    ('journal_retention_days', 180),
    ('location_retention_days', 90);

CREATE TABLE server_keys (
    name  TEXT PRIMARY KEY,
    key   BYTEA NOT NULL CHECK (octet_length(key) = 32)
);

CREATE TABLE audit_log (
    id                BIGSERIAL PRIMARY KEY,
    at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_profile_id  SMALLINT REFERENCES profiles(id) ON DELETE SET NULL,
    action            TEXT NOT NULL,
    detail            TEXT NOT NULL DEFAULT ''
);
