-- PLEDGON discovery-layer schema.
--
-- Everything here is presentation/discovery metadata, never the source of
-- truth for a trade's terms — price, milestones, bond, and arbiter always
-- live on-chain in EscrowVault/Marketplace. If this table were wiped, no
-- trade's funds or obligations would change; buyers/sellers would just lose
-- thumbnails, descriptions, and labels.
--
-- RLS allows public SELECT only. INSERT/UPDATE never happen through the
-- anon/authenticated roles — they go through the write-listing-metadata and
-- write-escrow-metadata Edge Functions, which verify an EVM signature proves
-- the caller controls an address that is actually the listing's seller (or a
-- party to the vault) before writing with the service-role key. RLS can't
-- check an ECDSA signature, so it isn't the authorization boundary here —
-- the Edge Function is.

create table if not exists marketplace_listings (
  id bigint generated always as identity primary key,
  chain_id integer not null,
  marketplace_address text not null,
  listing_id bigint not null,
  seller_address text not null,
  title text,
  description text,
  thumbnail_url text,
  terms jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (chain_id, marketplace_address, listing_id)
);

create index if not exists idx_marketplace_listings_lookup
  on marketplace_listings (chain_id, marketplace_address, listing_id);

create table if not exists escrow_trade_metadata (
  id bigint generated always as identity primary key,
  chain_id integer not null,
  vault_address text not null,
  description text,
  milestone_labels jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (chain_id, vault_address)
);

create index if not exists idx_escrow_trade_metadata_lookup
  on escrow_trade_metadata (chain_id, vault_address);

-- Pure discovery index: every address that has ever deposited collateral
-- into a LendingPool, so the frontend can show liquidators a real candidate
-- list instead of a blind address text box. Never authoritative — a row here
-- is just a hint to go read on-chain; LendingPool.positions() and
-- LiquidationConsumer.isEligible() are always re-checked live before display
-- or before liquidate() is ever called, so a wrong or stale row here has no
-- security consequence, only a wasted read. That's why this table's write
-- path (see write-lending-borrower) only requires proving the signer *is*
-- the address being recorded, not the heavier "confirm they're a party to
-- this specific resource" check the metadata functions do — being listed as
-- a candidate borrower isn't sensitive the way a trade's description is.
create table if not exists lending_borrowers (
  id bigint generated always as identity primary key,
  chain_id integer not null,
  lending_pool_address text not null,
  borrower_address text not null,
  first_seen_at timestamptz not null default now(),
  unique (chain_id, lending_pool_address, borrower_address)
);

create index if not exists idx_lending_borrowers_lookup
  on lending_borrowers (chain_id, lending_pool_address);

alter table marketplace_listings enable row level security;
alter table escrow_trade_metadata enable row level security;
alter table lending_borrowers enable row level security;

drop policy if exists "public read marketplace_listings" on marketplace_listings;
create policy "public read marketplace_listings" on marketplace_listings
  for select using (true);

drop policy if exists "public read escrow_trade_metadata" on escrow_trade_metadata;
create policy "public read escrow_trade_metadata" on escrow_trade_metadata
  for select using (true);

drop policy if exists "public read lending_borrowers" on lending_borrowers;
create policy "public read lending_borrowers" on lending_borrowers
  for select using (true);

-- Deliberately no insert/update/delete policies for anon or authenticated —
-- see the file-level comment. The service_role key (used only inside the
-- Edge Functions, never shipped to the client) bypasses RLS entirely.
