-- Heft: remote table + Row Level Security.
-- The local UUID generated on device is used directly as the primary key so
-- upserts are idempotent.

create table if not exists public.weight_entries (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  weight_grams integer not null check (weight_grams between 200 and 400000),
  scale_profile text,
  measured_at timestamptz not null,
  source text not null check (source in ('manual', 'ocr', 'import')),
  ocr_raw_text text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists weight_entries_user_date_idx
  on public.weight_entries (user_id, measured_at desc);

alter table public.weight_entries enable row level security;

drop policy if exists "weight_entries_select_own" on public.weight_entries;
create policy "weight_entries_select_own"
  on public.weight_entries for select
  using (auth.uid() = user_id);

drop policy if exists "weight_entries_insert_own" on public.weight_entries;
create policy "weight_entries_insert_own"
  on public.weight_entries for insert
  with check (auth.uid() = user_id);

drop policy if exists "weight_entries_update_own" on public.weight_entries;
create policy "weight_entries_update_own"
  on public.weight_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "weight_entries_delete_own" on public.weight_entries;
create policy "weight_entries_delete_own"
  on public.weight_entries for delete
  using (auth.uid() = user_id);
