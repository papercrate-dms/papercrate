CREATE TYPE magic_token_kind AS ENUM ('email_login', 'demo_login');

CREATE TABLE magic_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind magic_token_kind NOT NULL,
    token_hash VARCHAR NOT NULL UNIQUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses INTEGER,
    used_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    last_used_at TIMESTAMPTZ
);

CREATE INDEX magic_tokens_token_hash_idx ON magic_tokens (token_hash);
CREATE INDEX magic_tokens_expires_at_idx ON magic_tokens (expires_at);
