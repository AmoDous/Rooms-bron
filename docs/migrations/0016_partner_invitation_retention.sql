alter table partner_invitations
  drop constraint if exists partner_invitations_activation_pair;

comment on column partner_invitations.activated_user_id is
  'May become null independently when an activated partner account is deleted.';

comment on column partner_invitations.activated_venue_id is
  'May become null independently when an activated venue is deleted.';

