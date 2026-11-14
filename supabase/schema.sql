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

-- Backs EscrowVault.submitMilestoneDocs()'s docHash: docHash itself is what's
-- actually committed on-chain and is all confirmMilestone/expireMilestone
-- ever check — this row (and the file in the "milestone-documents" Storage
-- bucket its storage_path points to) only exists so a buyer deciding
-- whether to confirm can actually open the document that hash commits to,
-- instead of just seeing an opaque hex string. write-milestone-document
-- verifies keccak256(file bytes) equals the caller-supplied doc_hash before
-- ever writing this row, so a row here is always a real preimage of the
-- hash it's filed under. If this row or its file disappeared, the on-chain
-- milestone status would be completely unaffected — only the ability to
-- view the document would be lost.
create table if not exists escrow_milestone_documents (
  id bigint generated always as identity primary key,
  chain_id integer not null,
  vault_address text not null,
  milestone_index integer not null,
  storage_path text not null,
  original_filename text not null,
  content_type text not null,
  size_bytes bigint not null,
  doc_hash text not null,
  uploaded_at timestamptz not null default now(),
  unique (chain_id, vault_address, milestone_index)
);

create index if not exists idx_escrow_milestone_documents_lookup
  on escrow_milestone_documents (chain_id, vault_address, milestone_index);

-- Public-read bucket for the files escrow_milestone_documents.storage_path
-- points into — same "off-chain metadata is public/discoverable, not
-- access-controlled" stance as every table above (the real trade terms and
-- funds are always on-chain; a document here is only reachable by whoever
-- already knows the vault address and milestone index). Writes only ever
-- happen through write-milestone-document's service-role client, which
-- bypasses RLS/bucket policy entirely, so no storage.objects policy is
-- needed for either read (the bucket's own `public` flag handles that) or
-- write.
insert into storage.buckets (id, name, public)
values ('milestone-documents', 'milestone-documents', true)
on conflict (id) do nothing;

alter table marketplace_listings enable row level security;
alter table escrow_trade_metadata enable row level security;
alter table lending_borrowers enable row level security;
alter table escrow_milestone_documents enable row level security;

drop policy if exists "public read marketplace_listings" on marketplace_listings;
create policy "public read marketplace_listings" on marketplace_listings
  for select using (true);

drop policy if exists "public read escrow_trade_metadata" on escrow_trade_metadata;
create policy "public read escrow_trade_metadata" on escrow_trade_metadata
  for select using (true);

drop policy if exists "public read lending_borrowers" on lending_borrowers;
create policy "public read lending_borrowers" on lending_borrowers
  for select using (true);

drop policy if exists "public read escrow_milestone_documents" on escrow_milestone_documents;
create policy "public read escrow_milestone_documents" on escrow_milestone_documents
  for select using (true);

-- Arbitrage bot registry. Each row records a FlashArbV3 deployment that a
-- user has registered with PLEDGON. Ownership is verified on-chain by the
-- write-arbitrage-bot Edge Function before insertion; only the on-chain owner
-- can register or update their bot's metadata. This table is discovery-only —
-- funds, profits, and execution always remain under the owner's private key.
create table if not exists arbitrage_bots (
  id bigint generated always as identity primary key,
  chain_id integer not null,
  bot_address text not null,
  owner_address text not null,
  deployed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain_id, bot_address)
);

create index if not exists idx_arbitrage_bots_lookup
  on arbitrage_bots (chain_id, bot_address);

create index if not exists idx_arbitrage_bots_owner
  on arbitrage_bots (chain_id, owner_address);

alter table arbitrage_bots enable row level security;

drop policy if exists "public read arbitrage_bots" on arbitrage_bots;
create policy "public read arbitrage_bots" on arbitrage_bots
  for select using (true);

-- Deliberately no insert/update/delete policies for anon or authenticated —
-- see the file-level comment. The service_role key (used only inside the
-- Edge Functions, never shipped to the client) bypasses RLS entirely.
