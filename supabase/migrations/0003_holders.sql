-- Holders: store / robot / member / consumed / adjustment.
-- Source: docs/tele-qr/data-model.md lines 105-115, plus WP1's additions:
-- CHECK on kind, seeded system pseudo-holders, and the member-holder trigger
-- (design decisions §0.5, §0.6).

create table holders (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,   -- store | robot | member | consumed | adjustment
  name        text not null,
  member_id   uuid references members(id),  -- set iff kind = 'member'
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint holder_member_link check ((kind = 'member') = (member_id is not null)),
  constraint holders_kind_check check (kind in ('store', 'robot', 'member', 'consumed', 'adjustment'))
);
create unique index on holders (kind, name) where active;

-- System pseudo-holders. These must exist in every environment (including
-- prod) for the app to function at all — unlike robots/members/products,
-- they are not part of the dev-only fixture set (design decisions §0.7).
insert into holders (kind, name, active) values
  ('store', 'Store', true),
  ('consumed', 'Consumed', true),
  ('adjustment', 'Adjustment', true);

-- Every members row gets a matching holders row (kind = 'member')
-- automatically, so every insertion path (admin UI, fixture script, future
-- bulk import) doesn't need to remember to do it manually (design decisions
-- §0.6). This is what the return flow's "Personal/bench" holder resolves to.
create or replace function create_member_holder()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from holders where member_id = new.id and kind = 'member'
  ) then
    insert into holders (kind, name, member_id, active)
    values ('member', coalesce(new.display_name, new.full_name), new.id, true);
  end if;
  return new;
end;
$$;

create trigger create_member_holder_trigger
after insert on members
for each row execute function create_member_holder();
