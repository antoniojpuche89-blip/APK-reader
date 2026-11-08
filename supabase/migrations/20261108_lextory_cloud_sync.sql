-- Lextory stores reading position and vocabulary only. Book files stay on each device.
create table if not exists public.reading_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  content_hash text not null,
  title text not null default '',
  file_name text not null default '',
  format text not null default 'epub' check (format in ('epub','pdf')),
  progress numeric(5,2) not null default 0 check (progress >= 0 and progress <= 100),
  last_page integer not null default 1,
  last_cfi text,
  total_pages integer,
  updated_at timestamptz not null default now(),
  primary key (user_id, content_hash)
);
create table if not exists public.user_learning_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  vocabulary jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.reading_progress enable row level security;
alter table public.user_learning_state enable row level security;
drop policy if exists "Users manage their own reading progress" on public.reading_progress;
create policy "Users manage their own reading progress" on public.reading_progress
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users manage their own learning state" on public.user_learning_state;
create policy "Users manage their own learning state" on public.user_learning_state
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.reading_progress to authenticated;
grant select, insert, update, delete on public.user_learning_state to authenticated;
create index if not exists reading_progress_user_updated_idx on public.reading_progress (user_id, updated_at desc);
