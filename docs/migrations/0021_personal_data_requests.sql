create type personal_data_request_type as enum ('access', 'rectification', 'restriction', 'consent_withdrawal', 'erasure');
create type personal_data_request_status as enum ('new', 'processing', 'completed', 'rejected');

create table personal_data_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  request_type personal_data_request_type not null,
  status personal_data_request_status not null default 'new',
  message text not null default '',
  resolution text,
  due_at timestamptz not null,
  assigned_to uuid references users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_data_requests_message_length check (char_length(message) <= 2000),
  constraint personal_data_requests_resolution_length check (resolution is null or char_length(resolution) <= 4000)
);

create unique index personal_data_requests_active_unique
  on personal_data_requests(user_id, request_type) where status in ('new', 'processing');
create index personal_data_requests_admin_queue_idx on personal_data_requests(status, due_at, created_at);
create index personal_data_requests_user_idx on personal_data_requests(user_id, created_at desc);
