-- Personal access tokens: a bearer that acts as its person. Reads everything
-- a signed-in person can; writes only to their own desktop and account.
CREATE TABLE IF NOT EXISTS api_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS api_tokens_user ON api_tokens(user_id, created_at);
