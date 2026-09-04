create table room_price_rules (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  label text not null,
  weekdays smallint[] not null,
  starts_at time not null,
  ends_at time not null,
  ends_next_day boolean not null default false,
  price_per_hour numeric(12,2) not null,
  priority integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_price_rules_label check (length(trim(label)) between 1 and 160),
  constraint room_price_rules_weekdays check (
    cardinality(weekdays) between 1 and 7
    and weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
  ),
  constraint room_price_rules_price check (price_per_hour >= 0),
  constraint room_price_rules_interval check (ends_next_day or ends_at > starts_at)
);

create index room_price_rules_room_active_idx
  on room_price_rules(room_id, active, priority);
