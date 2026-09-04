alter table user_sessions
  add column if not exists second_factor_verified_at timestamptz;

create table if not exists user_two_factor (
  user_id uuid primary key references users(id) on delete cascade,
  secret_ciphertext text not null,
  recovery_code_hashes text[] not null,
  last_used_counter bigint,
  enabled_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint user_two_factor_recovery_hashes_check check (
    cardinality(recovery_code_hashes) between 0 and 8
  )
);

create table if not exists two_factor_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash char(64) not null unique,
  mode text not null check (mode in ('setup', 'verify')),
  pending_secret_ciphertext text,
  attempts integer not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint two_factor_challenge_secret_check check (
    (mode = 'setup' and pending_secret_ciphertext is not null)
    or (mode = 'verify' and pending_secret_ciphertext is null)
  ),
  constraint two_factor_challenge_expiry_check check (expires_at > created_at)
);

create index if not exists two_factor_challenges_active_user_idx
  on two_factor_challenges (user_id, expires_at desc)
  where consumed_at is null;

create index if not exists two_factor_challenges_retention_idx
  on two_factor_challenges (created_at);

