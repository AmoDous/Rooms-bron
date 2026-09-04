create table if not exists auth_rate_limits (
  scope text not null
    check (scope ~ '^[a-z0-9_.:-]{1,80}$'),
  key_hash text not null
    check (key_hash ~ '^[0-9a-f]{64}$'),
  failures integer not null
    check (failures between 1 and 100000),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash)
);

create index if not exists auth_rate_limits_expiry_idx
  on auth_rate_limits (expires_at);
