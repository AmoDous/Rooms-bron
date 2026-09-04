create table if not exists two_factor_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  request_ip inet,
  request_user_agent text,
  expires_at timestamptz not null,
  reviewed_by uuid references users(id) on delete set null,
  review_comment text not null default '',
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint two_factor_recovery_expiry_check check (expires_at > created_at),
  constraint two_factor_recovery_review_check check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status = 'expired' and reviewed_by is null and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)
  )
);

create unique index if not exists two_factor_recovery_pending_user_idx
  on two_factor_recovery_requests (user_id)
  where status = 'pending';

create index if not exists two_factor_recovery_admin_queue_idx
  on two_factor_recovery_requests (status, created_at desc);

create index if not exists two_factor_recovery_retention_idx
  on two_factor_recovery_requests (updated_at);
