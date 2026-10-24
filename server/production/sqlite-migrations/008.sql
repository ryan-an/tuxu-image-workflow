CREATE TABLE accounts (
 id TEXT PRIMARY KEY,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
 status TEXT NOT NULL CHECK(status IN ('pending','active','disabled','deleted')),
 password_hash TEXT,
 monthly_limit INTEGER CHECK(monthly_limit IS NULL OR monthly_limit >= 0),
 created_at INTEGER NOT NULL,
 CHECK((id='owner' AND username='admin' AND role='owner') OR (id<>'owner' AND lower(username)<>'admin' AND role<>'owner'))
);
CREATE TABLE account_sessions (
 token_hash TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES accounts(id),
 expires_at INTEGER NOT NULL
);
CREATE INDEX account_sessions_user ON account_sessions(account_id);
CREATE TABLE account_invitations (
 token_hash TEXT PRIMARY KEY,
 account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
 expires_at INTEGER NOT NULL
);
CREATE TABLE account_usage (
 account_id TEXT NOT NULL REFERENCES accounts(id),
 period TEXT NOT NULL,
 used INTEGER NOT NULL CHECK(used >= 0),
 PRIMARY KEY(account_id,period)
);
CREATE TABLE usage_reservations (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES accounts(id),
 period TEXT NOT NULL,
 units INTEGER NOT NULL CHECK(units >= 0)
);
