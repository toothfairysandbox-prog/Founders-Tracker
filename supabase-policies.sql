-- Attachments storage — run this once in the Supabase SQL editor.
--
-- Before running it, connect Firebase in the Supabase dashboard:
--   Authentication → Sign In / Providers → Third Party Auth → add Firebase
--   Firebase project ID:  goal-tracker-v1-c9541
--
-- That is what makes auth.jwt() below contain the signed-in Google account.
-- Without it every policy here evaluates to false and uploads fail with 403.
--
-- The allow list appears in THREE places now. Change one, change all three:
--   1. this file          2. firestore.rules          3. MEMBERS in js/goals.js

-- ---------------------------------------------------------------------------
-- 1. The bucket. Private: nothing is readable without a signed link.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 52428800)   -- 50 MB, the free-plan cap
on conflict (id) do update
  set public = false, file_size_limit = 52428800;

-- ---------------------------------------------------------------------------
-- 2. Who may touch it.
--
-- Deliberately no "to authenticated" clause. These policies check the Firebase
-- token directly, so they hold even if the role mapping isn't what you expect —
-- an anonymous request carries no email claim and fails on the first condition.
-- ---------------------------------------------------------------------------
create or replace function public.is_founder() returns boolean
language sql stable as $$
  select
        (auth.jwt() ->> 'iss') = 'https://securetoken.google.com/goal-tracker-v1-c9541'
    and coalesce((auth.jwt() ->> 'email_verified')::boolean, false)
    and lower(coalesce(auth.jwt() ->> 'email', '')) in (
          'samuelgibby89@gmail.com',
          'garrettwoodhouse@gmail.com',
          'toothfairysandbox@gmail.com'
        )
$$;

alter table storage.objects enable row level security;

drop policy if exists "founders read attachments"   on storage.objects;
drop policy if exists "founders add attachments"    on storage.objects;
drop policy if exists "founders change attachments" on storage.objects;
drop policy if exists "founders remove attachments" on storage.objects;

create policy "founders read attachments" on storage.objects
  for select using (bucket_id = 'attachments' and public.is_founder());

create policy "founders add attachments" on storage.objects
  for insert with check (bucket_id = 'attachments' and public.is_founder());

create policy "founders change attachments" on storage.objects
  for update using (bucket_id = 'attachments' and public.is_founder())
           with check (bucket_id = 'attachments' and public.is_founder());

create policy "founders remove attachments" on storage.objects
  for delete using (bucket_id = 'attachments' and public.is_founder());

-- ---------------------------------------------------------------------------
-- 3. Sanity check. Run this on its own afterwards; it should list four rows.
-- ---------------------------------------------------------------------------
-- select policyname from pg_policies
--  where schemaname = 'storage' and tablename = 'objects'
--    and policyname like 'founders %';
