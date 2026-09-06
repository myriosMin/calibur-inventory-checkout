-- Scan codes: the QR resolution table. One lookup path for every sticker.
-- Source: docs/tele-qr/data-model.md lines 169-182, verbatim (including the
-- code_target check already given in the docs).

create table scan_codes (
  code        text primary key,     -- short base64url string, lives in the QR
  kind        text not null,        -- product | group
  product_id  uuid references products(id),
  location_id uuid references locations(id),
  label       text,                 -- human text printed under the QR
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint code_target check (
    (kind = 'product' and product_id is not null and location_id is null) or
    (kind = 'group'   and location_id is not null and product_id is null)
  )
);
