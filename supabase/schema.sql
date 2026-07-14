create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  subjects jsonb not null default '[]'::jsonb,
  attempts jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

drop policy if exists "Users can read their own study data" on public.user_data;
create policy "Users can read their own study data"
on public.user_data for select
using (auth.uid() = user_id);

drop policy if exists "Users can create their own study data" on public.user_data;
create policy "Users can create their own study data"
on public.user_data for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own study data" on public.user_data;
create policy "Users can update their own study data"
on public.user_data for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own study data" on public.user_data;
create policy "Users can delete their own study data"
on public.user_data for delete
using (auth.uid() = user_id);
