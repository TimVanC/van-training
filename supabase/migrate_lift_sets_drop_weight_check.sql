-- Drop the `weight >= 0` CHECK constraint on lift_sets.
--
-- Assisted (bodyweight-supported) sets store the assistance amount as a
-- NEGATIVE weight (see src/utils/validateSetInput.ts). The old
-- `lift_sets_weight_check` (weight >= 0) rejected those inserts at the
-- database level, which caused the entire workout submission to fail with a
-- 500 ("Submission failed. Please try again.") whenever a set used assistance
-- -- e.g. assisted pull-ups.
--
-- schema.sql already treats this constraint as intentionally absent; this
-- migration records the drop explicitly so environments that predate that
-- change (production had drifted) are brought back in sync.

alter table public.lift_sets
  drop constraint if exists lift_sets_weight_check;

-- Defensively drop any equivalent weight-lower-bound check that may exist
-- under a different name.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.lift_sets'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%weight%'
      and pg_get_constraintdef(oid) ilike '%>=%'
      and pg_get_constraintdef(oid) ilike '%0%'
  loop
    execute format('alter table public.lift_sets drop constraint if exists %I;', c.conname);
  end loop;
end
$$;
