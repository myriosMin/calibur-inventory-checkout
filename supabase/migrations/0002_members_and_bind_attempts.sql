-- Identity: members and the unrecognised-user bind-attempt log.
-- Source: docs/tele-qr/data-model.md lines 61-99, plus WP1's CHECK addition
-- on members.role (design decisions §0.5).

create table members (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null,
  display_name        text,
  nus_email           text unique,
  telegram_username   text unique,     -- collected at club registration
  telegram_user_id    bigint unique,   -- bound on first /start; the real key
  telegram_bound_at   timestamptz,
  role                text not null default 'member',   -- member | admin
  active              boolean not null default true,
  joined_at           date,
  left_at             date,
  created_at          timestamptz not null default now(),
  constraint members_role_check check (role in ('member', 'admin'))
);
create index on members (telegram_user_id) where active;

-- Unrecognised users who messaged the bot. The admin dashboard's bind queue,
-- and the abuse log for when visitors scan a sticker.
create table telegram_bind_attempts (
  id                uuid primary key default gen_random_uuid(),
  telegram_user_id  bigint not null,
  username          text,
  display_name      text,
  scan_code         text,        -- what they scanned, if anything
  resolved_member   uuid references members(id),
  created_at        timestamptz not null default now()
);
