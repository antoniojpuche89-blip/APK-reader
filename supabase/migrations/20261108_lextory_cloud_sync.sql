-- Lextory stores reading position and vocabulary only. EPUB/PDF files stay on each device.
create table if not exists public.reading_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  content_hash text not null,
  title text not null default '',
  file_name text not null default '',
  format text not null default 'epub' check (format in ('epub', 'pdf')),
  progress numeric(5,2) not null default 0 check (progress >= 0 and progress <= 100),
  last_page integer not null default 1 check (last_page >= 1),
  last_cfi text,
  total_pages integer check (total_pages is null or total_pages >= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, content_hash)
);

create table if not exists public.user_learning_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  vocabulary jsonb not null default '[]'::jsonb check (jsonb_typeof(vocabulary) = 'array'),
  updated_at timestamptz not null default now()
);

alter table public.reading_progress enable row level security;
alter table public.user_learning_state enable row level security;

revoke all on table public.reading_progress from anon, authenticated;
revoke all on table public.user_learning_state from anon, authenticated;
grant select, insert, update, delete on table public.reading_progress to authenticated;
grant select, insert, update, delete on table public.user_learning_state to authenticated;

drop policy if exists "Users manage their own reading progress" on public.reading_progress;
drop policy if exists "Read own reading progress" on public.reading_progress;
drop policy if exists "Insert own reading progress" on public.reading_progress;
drop policy if exists "Update own reading progress" on public.reading_progress;
drop policy if exists "Delete own reading progress" on public.reading_progress;
create policy "Read own reading progress" on public.reading_progress
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own reading progress" on public.reading_progress
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own reading progress" on public.reading_progress
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Delete own reading progress" on public.reading_progress
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own learning state" on public.user_learning_state;
drop policy if exists "Read own learning state" on public.user_learning_state;
drop policy if exists "Insert own learning state" on public.user_learning_state;
drop policy if exists "Update own learning state" on public.user_learning_state;
drop policy if exists "Delete own learning state" on public.user_learning_state;
create policy "Read own learning state" on public.user_learning_state
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own learning state" on public.user_learning_state
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own learning state" on public.user_learning_state
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Delete own learning state" on public.user_learning_state
  for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists reading_progress_user_updated_idx
  on public.reading_progress (user_id, updated_at desc);
