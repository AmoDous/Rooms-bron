create table partner_invitations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references partner_leads(id) on delete cascade,
  token_hash char(64) not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references users(id) on delete restrict,
  activated_user_id uuid references users(id) on delete set null,
  activated_venue_id uuid references venues(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint partner_invitations_expiry_after_creation check (expires_at > created_at),
  constraint partner_invitations_activation_pair check (
    (activated_user_id is null and activated_venue_id is null)
    or (activated_user_id is not null and activated_venue_id is not null)
  )
);

create index partner_invitations_lead_created_idx
  on partner_invitations (lead_id, created_at desc);

create index partner_invitations_active_expiry_idx
  on partner_invitations (expires_at)
  where consumed_at is null and revoked_at is null;

