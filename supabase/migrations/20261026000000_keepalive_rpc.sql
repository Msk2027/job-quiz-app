-- A public, read-only health query used by the scheduled keep-alive workflow.
-- It returns only a constant and does not access application data.
create or replace function public.keepalive()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select 1;
$$;

grant execute on function public.keepalive() to anon, authenticated;
