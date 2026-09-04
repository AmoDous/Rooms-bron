create type partner_lead_status as enum ('new', 'review', 'approved', 'rejected');

create table partner_leads (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  venue_title text not null,
  address text not null,
  contact_name text not null,
  contact_phone text not null,
  contact_email citext not null,
  venue_type text not null,
  room_count smallint not null,
  comment text not null default '',
  status partner_lead_status not null default 'new',
  terms_version text not null,
  privacy_version text not null,
  consented_at timestamptz not null,
  request_ip inet,
  request_user_agent text,
  reviewed_by uuid references users(id) on delete set null,
  review_comment text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_leads_city_length check (char_length(city) between 2 and 120),
  constraint partner_leads_venue_title_length check (char_length(venue_title) between 2 and 180),
  constraint partner_leads_address_length check (char_length(address) between 3 and 300),
  constraint partner_leads_contact_name_length check (char_length(contact_name) between 2 and 120),
  constraint partner_leads_venue_type_length check (char_length(venue_type) between 2 and 120),
  constraint partner_leads_room_count_range check (room_count between 1 and 100),
  constraint partner_leads_comment_length check (char_length(comment) <= 2000),
  constraint partner_leads_review_comment_length check (char_length(review_comment) <= 1000)
);

create unique index partner_leads_active_email_unique
  on partner_leads(lower(contact_email::text)) where status <> 'rejected';
create unique index partner_leads_active_phone_unique
  on partner_leads(contact_phone) where status <> 'rejected';
create index partner_leads_queue_idx on partner_leads(status, updated_at desc);
create index partner_leads_city_idx on partner_leads(city, created_at desc);

create trigger partner_leads_updated_at
  before update on partner_leads for each row execute function set_updated_at();
