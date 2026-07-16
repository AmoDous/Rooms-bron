alter table venue_schedule_exceptions
  add column if not exists note text;

create index if not exists venue_schedule_exceptions_venue_date_idx
  on venue_schedule_exceptions(venue_id, local_date);
