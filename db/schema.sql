-- Private Email Platform — PostgreSQL schema (guide section 10).
-- All timestamps are stored in UTC (timestamptz). Passwords are stored ONLY
-- as bcrypt hashes (password_hash); plaintext passwords are never stored.
-- Run with:  npm run db:init   (uses DATABASE_URL from .env.local / env)

CREATE TABLE IF NOT EXISTS users (
  id               SERIAL PRIMARY KEY,
  username         VARCHAR(50)  NOT NULL UNIQUE,
  password_hash    TEXT         NOT NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'suspended')),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);

CREATE TABLE IF NOT EXISTS admins (
  id               SERIAL PRIMARY KEY,
  username         VARCHAR(50)  NOT NULL UNIQUE,
  password_hash    TEXT         NOT NULL,
  role             VARCHAR(20)  NOT NULL DEFAULT 'admin'
                   CHECK (role IN ('superadmin', 'admin')),
  status           VARCHAR(20)  NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'suspended')),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS email_addresses (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  full_address     VARCHAR(320) NOT NULL UNIQUE,
  local_part       VARCHAR(64)  NOT NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'deactivated')),
  is_saved         BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_addresses_user    ON email_addresses (user_id);
CREATE INDEX IF NOT EXISTS idx_addresses_address ON email_addresses (LOWER(full_address));

CREATE TABLE IF NOT EXISTS messages (
  id               SERIAL PRIMARY KEY,
  address_id       INTEGER      NOT NULL REFERENCES email_addresses (id) ON DELETE CASCADE,
  message_id       VARCHAR(500) NOT NULL UNIQUE,
  sender           VARCHAR(320) NOT NULL,
  subject          TEXT         NOT NULL DEFAULT '',
  text_body        TEXT         NOT NULL DEFAULT '',
  safe_html_body   TEXT,
  received_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  read_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_messages_address  ON messages (address_id);
CREATE INDEX IF NOT EXISTS idx_messages_received ON messages (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender   ON messages (sender);

CREATE TABLE IF NOT EXISTS otp_detections (
  id               SERIAL PRIMARY KEY,
  message_id       INTEGER      NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  code             VARCHAR(16)  NOT NULL,
  confidence       NUMERIC(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  matched_pattern  VARCHAR(120) NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_message ON otp_detections (message_id);
CREATE INDEX IF NOT EXISTS idx_otp_created ON otp_detections (created_at DESC);

CREATE TABLE IF NOT EXISTS receiver_events (
  id               SERIAL PRIMARY KEY,
  provider_event_id VARCHAR(500),
  signature_valid  BOOLEAN      NOT NULL,
  processing_status VARCHAR(30) NOT NULL,
  received_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  detail           TEXT
);
CREATE INDEX IF NOT EXISTS idx_receiver_events_status ON receiver_events (processing_status);
CREATE INDEX IF NOT EXISTS idx_receiver_events_received ON receiver_events (received_at DESC);

-- Single-row-per-key settings table. `domain` is the domain after @ in
-- generated addresses. It is set to manangmails.is-a.dev — the subdomain the
-- owner chose. Registration (GitHub PR to is-a-dev/register) is still
-- pending maintainer approval, and no mail receiver is connected, so the
-- platform still reports Receiving: NOT CONFIGURED and must not claim the
-- domain is live or that addresses can receive mail yet. Change the value
-- in Admin -> Settings if the subdomain changes.
CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key   VARCHAR(100) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_settings (setting_key, setting_value) VALUES
  ('domain',               'manangmails.is-a.dev'),
  ('max_addresses_per_user','50'),
  ('max_message_size_kb',   '1024'),
  ('retention_days',        '0'),
  ('maintenance_mode',      'off'),
  ('receiver_status',       'NOT_CONFIGURED')
ON CONFLICT (setting_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  actor_id    INTEGER,
  actor_type  VARCHAR(20) NOT NULL DEFAULT 'admin',
  action      VARCHAR(120) NOT NULL,
  target_type VARCHAR(60),
  target_id   VARCHAR(120),
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action, created_at DESC);
