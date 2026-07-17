alter table notification_deliveries
  add column if not exists processing_started_at timestamptz,
  add column if not exists provider_message_id text,
  add column if not exists updated_at timestamptz;

update notification_deliveries
set updated_at = created_at
where updated_at is null;

alter table notification_deliveries
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table notification_deliveries
  drop constraint if exists notification_deliveries_attempts_check;

alter table notification_deliveries
  add constraint notification_deliveries_attempts_check check (attempts >= 0);

create index if not exists notification_deliveries_worker_idx
  on notification_deliveries(status, next_attempt_at, created_at)
  where status in ('queued', 'failed', 'processing');
