-- Rooms MVP PostgreSQL schema draft.
-- Review financial, personal-data and retention rules before production use.

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists btree_gist;

create type user_role as enum ('client', 'partner', 'admin', 'accountant');
create type venue_status as enum ('review', 'published', 'hidden');
create type verification_status as enum ('review', 'verified');
create type cabinet_status as enum ('active', 'paused');
create type partner_mode as enum ('catalog', 'crm');
create type room_status as enum ('review', 'published', 'hidden');
create type booking_status as enum ('pending', 'proposed', 'awaiting_payment', 'paid', 'expired', 'cancelled', 'visited', 'completed');
create type reservation_source as enum ('payment_hold', 'booking', 'manual_booking', 'technical', 'buffer');
create type payment_status as enum ('pending', 'paid', 'failed', 'refund_pending', 'refunded');
create type moderation_status as enum ('pending', 'approved', 'rejected');
create type delivery_channel as enum ('email', 'telegram');
create type delivery_status as enum ('queued', 'processing', 'sent', 'failed', 'cancelled');
create type payout_status as enum ('draft', 'sent', 'paid', 'cancelled');

create table users (
  id uuid primary key default gen_random_uuid(),
  role user_role not null default 'client',
  name text not null,
  email citext unique,
  phone text unique,
  city text,
  password_hash text,
  password_reset_required boolean not null default false,
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  blocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_contact_required check (email is not null or phone is not null)
);

create table user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  refresh_token_hash text not null unique,
  user_agent text,
  ip inet,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table venues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  city text not null,
  address text not null,
  latitude numeric(9,6),
  longitude numeric(9,6),
  venue_type text,
  description text,
  rules text,
  contact_name text,
  contact_phone text,
  contact_email citext,
  payment_methods text[] not null default array['card','cash']::text[],
  publication_status venue_status not null default 'review',
  verification_status verification_status not null default 'review',
  cabinet_status cabinet_status not null default 'active',
  partner_mode partner_mode not null default 'catalog',
  subscription_status text not null default 'active',
  ranking_boost smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint venues_coordinates_pair check ((latitude is null) = (longitude is null)),
  constraint venues_ranking_boost check (ranking_boost between -1 and 1)
);

create table venue_members (
  venue_id uuid not null references venues(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  member_role text not null default 'manager',
  created_at timestamptz not null default now(),
  primary key (venue_id, user_id)
);

create table venue_bank_accounts (
  venue_id uuid primary key references venues(id) on delete cascade,
  bank_name text not null,
  bik text not null,
  settlement_account_ciphertext text not null,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

create table rooms (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  slug text not null,
  title text not null,
  room_type text not null,
  subtitle text,
  description text,
  rules text,
  promotion text,
  capacity_min integer not null default 1,
  capacity_max integer not null,
  price_per_hour numeric(12,2) not null,
  minimum_hours numeric(4,2) not null default 1,
  buffer_minutes integer not null default 0,
  features text[] not null default '{}',
  tags text[] not null default '{}',
  status room_status not null default 'review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, slug),
  constraint rooms_capacity check (capacity_min > 0 and capacity_max >= capacity_min),
  constraint rooms_price check (price_per_hour >= 0),
  constraint rooms_minimum check (minimum_hours >= 0.5),
  constraint rooms_buffer check (buffer_minutes in (0, 15, 30, 45, 60))
);

create table room_photos (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  venue_id uuid references venues(id) on delete cascade,
  original_url text not null,
  landscape_url text,
  portrait_url text,
  width integer,
  height integer,
  sort_order integer not null default 0,
  is_cover boolean not null default false,
  created_at timestamptz not null default now(),
  constraint room_photos_owner check ((room_id is not null)::int + (venue_id is not null)::int = 1)
);

create table room_services (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  name text not null,
  description text,
  price numeric(12,2) not null,
  pricing_unit text not null default 'booking',
  active boolean not null default true,
  sort_order integer not null default 0,
  constraint room_services_price check (price >= 0)
);

create table venue_week_schedule (
  venue_id uuid not null references venues(id) on delete cascade,
  weekday smallint not null,
  enabled boolean not null default true,
  opens_at time,
  closes_at time,
  closes_next_day boolean not null default false,
  primary key (venue_id, weekday),
  constraint venue_weekday check (weekday between 1 and 7)
);

create table venue_schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  local_date date not null,
  mode text not null,
  opens_at time,
  closes_at time,
  closes_next_day boolean not null default false,
  unique (venue_id, local_date),
  constraint venue_exception_mode check (mode in ('closed', 'custom'))
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  public_number text not null unique,
  client_id uuid references users(id) on delete set null,
  venue_id uuid not null references venues(id),
  status booking_status not null default 'pending',
  client_name text not null,
  client_phone text not null,
  client_email citext,
  city text not null,
  event_type text,
  event_name text,
  guests integer not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  currency char(3) not null default 'RUB',
  room_total numeric(12,2) not null,
  service_total numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  prepayment numeric(12,2) not null,
  commission numeric(12,2) not null,
  partner_amount numeric(12,2) not null,
  remaining_on_site numeric(12,2) not null,
  on_site_payment_method text,
  payment_hold_expires_at timestamptz,
  comment text,
  internal_note text,
  cancellation_reason text,
  cancelled_by text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_time check (ends_at > starts_at),
  constraint bookings_guests check (guests > 0),
  constraint bookings_amounts check (total >= 0 and prepayment >= 0 and remaining_on_site >= 0)
);

create table booking_rooms (
  booking_id uuid not null references bookings(id) on delete cascade,
  room_id uuid not null references rooms(id),
  title_snapshot text not null,
  price_per_hour_snapshot numeric(12,2) not null,
  amount numeric(12,2) not null,
  is_primary boolean not null default false,
  primary key (booking_id, room_id)
);

create table booking_services (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  room_service_id uuid references room_services(id) on delete set null,
  name_snapshot text not null,
  description_snapshot text,
  unit_price numeric(12,2) not null,
  quantity integer not null default 1,
  amount numeric(12,2) not null,
  constraint booking_services_quantity check (quantity > 0)
);

-- One active row represents a time interval that cannot be sold again.
-- Buffer intervals are stored as separate rows with source_type='buffer'.
create table room_reservations (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  booking_id uuid references bookings(id) on delete cascade,
  source_type reservation_source not null,
  source_id uuid,
  period tstzrange not null,
  active boolean not null default true,
  expires_at timestamptz,
  details jsonb not null default '{}',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint room_reservations_period check (not isempty(period))
);

alter table room_reservations add constraint room_reservations_no_overlap
  exclude using gist (room_id with =, period with &&) where (active);

create table booking_status_history (
  id bigserial primary key,
  booking_id uuid not null references bookings(id) on delete cascade,
  from_status booking_status,
  to_status booking_status not null,
  actor_id uuid references users(id) on delete set null,
  actor_role user_role,
  title text not null,
  details text,
  created_at timestamptz not null default now()
);

create table booking_messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  sender_id uuid references users(id) on delete set null,
  sender_role user_role not null,
  body text not null,
  blocked_reason text,
  visible_to_client boolean not null default true,
  visible_to_partner boolean not null default true,
  created_at timestamptz not null default now()
);

create table payment_transactions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id),
  provider text not null,
  provider_payment_id text unique,
  idempotency_key text not null unique,
  status payment_status not null default 'pending',
  amount numeric(12,2) not null,
  currency char(3) not null default 'RUB',
  masked_card text,
  receipt_number text,
  receipt_url text,
  provider_payload jsonb not null default '{}',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payment_transactions(id),
  provider_refund_id text unique,
  amount numeric(12,2) not null,
  status payment_status not null default 'refund_pending',
  reason text,
  requested_by uuid references users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id),
  room_id uuid not null references rooms(id),
  client_id uuid references users(id) on delete set null,
  rating smallint not null,
  body text,
  status moderation_status not null default 'pending',
  partner_reply text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reviews_rating check (rating between 1 and 5)
);

create table moderation_requests (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues(id) on delete cascade,
  room_id uuid references rooms(id) on delete cascade,
  submitted_by uuid references users(id) on delete set null,
  fields text[] not null,
  before_data jsonb not null default '{}',
  proposed_data jsonb not null,
  status moderation_status not null default 'pending',
  reviewed_by uuid references users(id) on delete set null,
  review_comment text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint moderation_target check ((venue_id is not null)::int + (room_id is not null)::int = 1)
);

create table notification_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  site_enabled boolean not null default true,
  email_enabled boolean not null default true,
  email_address citext,
  telegram_enabled boolean not null default false,
  telegram_chat_id text,
  updated_at timestamptz not null default now()
);

create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  venue_id uuid references venues(id) on delete cascade,
  channel delivery_channel not null,
  target text not null,
  event_key text not null,
  dedupe_key text not null unique,
  title text not null,
  body text not null,
  status delivery_status not null default 'queued',
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table personal_data_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  booking_id uuid references bookings(id) on delete set null,
  subject_phone text,
  subject_email citext,
  context text not null,
  documents text[] not null,
  document_version text not null,
  ip inet,
  user_agent text,
  accepted_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table payout_batches (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id),
  status payout_status not null default 'draft',
  amount numeric(12,2) not null,
  scheduled_for date,
  sent_at timestamptz,
  paid_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table payout_items (
  payout_id uuid not null references payout_batches(id) on delete cascade,
  booking_id uuid not null unique references bookings(id),
  amount numeric(12,2) not null,
  primary key (payout_id, booking_id)
);

create table audit_log (
  id bigserial primary key,
  actor_id uuid references users(id) on delete set null,
  actor_role user_role,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index bookings_client_idx on bookings(client_id, created_at desc);
create index bookings_venue_status_idx on bookings(venue_id, status, starts_at);
create index booking_rooms_room_idx on booking_rooms(room_id, booking_id);
create index room_reservations_period_idx on room_reservations using gist(room_id, period);
create index notification_deliveries_queue_idx on notification_deliveries(status, next_attempt_at, created_at);
create index moderation_requests_queue_idx on moderation_requests(status, created_at);
create index audit_log_entity_idx on audit_log(entity_type, entity_id, created_at desc);

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_updated_at before update on users for each row execute function set_updated_at();
create trigger venues_updated_at before update on venues for each row execute function set_updated_at();
create trigger rooms_updated_at before update on rooms for each row execute function set_updated_at();
create trigger bookings_updated_at before update on bookings for each row execute function set_updated_at();
create trigger payments_updated_at before update on payment_transactions for each row execute function set_updated_at();
