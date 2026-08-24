-- Lyco schema — all tables carry user_id (except users and magic_link_tokens)
-- Every query must filter on user_id.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Magic link tokens ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_email ON magic_link_tokens(email);

-- ─── Sessions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- ─── Goals (projects) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  deadline    DATE,
  cadence     TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_user_id ON goals(user_id);

-- ─── Spending goals (budgets) ───────────────────────────────
CREATE TABLE IF NOT EXISTS spending_goals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  budget_cents  INTEGER NOT NULL,
  period        TEXT NOT NULL DEFAULT 'monthly',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spending_goals_user_id ON spending_goals(user_id);

-- ─── Blocks (scheduled time for goals) ──────────────────────
CREATE TABLE IF NOT EXISTS blocks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id           UUID REFERENCES goals(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  duration_minutes  INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'scheduled',
  progress          INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blocks_user_id ON blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_blocks_scheduled_at ON blocks(scheduled_at);

-- ─── Spending entries (transactions) ────────────────────────
CREATE TABLE IF NOT EXISTS spending_entries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spending_goal_id   UUID NOT NULL REFERENCES spending_goals(id) ON DELETE CASCADE,
  amount_cents       INTEGER NOT NULL,
  description        TEXT,
  spent_at           DATE NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spending_entries_user_id ON spending_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_spending_entries_spending_goal_id ON spending_entries(spending_goal_id);

-- ─── Occasions (upcoming events) ────────────────────────────
CREATE TABLE IF NOT EXISTS occasions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  date        DATE NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_occasions_user_id ON occasions(user_id);

-- ─── LLM interactions (audit log) ───────────────────────────
CREATE TABLE IF NOT EXISTS llm_interactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id      TEXT,
  prompt          JSONB NOT NULL,
  model_response  JSONB NOT NULL,
  tools_called    JSONB NOT NULL DEFAULT '[]',
  rows_changed    JSONB NOT NULL DEFAULT '[]',
  model           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_interactions_user_id ON llm_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_interactions_session_id ON llm_interactions(session_id);

-- ─── Secrets (encrypted OAuth tokens, etc.) ─────────────────
CREATE TABLE IF NOT EXISTS secrets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_secrets_user_id ON secrets(user_id);
