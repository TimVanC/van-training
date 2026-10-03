-- Per-user counters for AI-backed endpoints (onboarding coach). Written only by
-- the service role through increment_ai_usage(); no client access.
-- Safe to run multiple times (idempotent).
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, bucket)
);

alter table public.ai_usage enable row level security;

create or replace function public.increment_ai_usage(p_user_id uuid, p_buckets text[])
returns integer[]
language plpgsql
security definer
set search_path = public
as $$
declare
  b text;
  c integer;
  result integer[] := '{}';
begin
  foreach b in array p_buckets loop
    insert into public.ai_usage (user_id, bucket, count)
    values (p_user_id, b, 1)
    on conflict (user_id, bucket)
    do update set count = public.ai_usage.count + 1, updated_at = now()
    returning count into c;
    result := result || c;
  end loop;
  return result;
end;
$$;

revoke all on function public.increment_ai_usage(uuid, text[]) from public, anon, authenticated;
grant execute on function public.increment_ai_usage(uuid, text[]) to service_role;
