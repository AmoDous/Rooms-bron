create table booking_time_proposals (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  proposed_by uuid references users(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending',
  comment text not null default '',
  room_total numeric(12,2) not null,
  service_total numeric(12,2) not null,
  total numeric(12,2) not null,
  prepayment numeric(12,2) not null,
  commission numeric(12,2) not null,
  partner_amount numeric(12,2) not null,
  remaining_on_site numeric(12,2) not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint booking_time_proposals_time check (ends_at > starts_at),
  constraint booking_time_proposals_status check (status in ('pending', 'accepted', 'declined', 'superseded')),
  constraint booking_time_proposals_amounts check (
    room_total >= 0 and service_total >= 0 and total >= 0 and prepayment >= 0
    and commission >= 0 and partner_amount >= 0 and remaining_on_site >= 0
  )
);

create unique index booking_time_proposals_pending_idx
  on booking_time_proposals(booking_id)
  where status = 'pending';

create index booking_time_proposals_booking_idx
  on booking_time_proposals(booking_id, created_at desc);

alter table booking_messages
  add column read_at_client timestamptz,
  add column read_at_partner timestamptz;

create index booking_messages_booking_created_idx
  on booking_messages(booking_id, created_at);
