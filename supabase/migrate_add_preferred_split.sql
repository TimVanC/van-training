-- Migration: let a user star one split as their default.
-- The home card and reminders follow the preferred split when one is set,
-- instead of whichever split was trained most recently.
-- Safe to run multiple times (idempotent). Applied to the live project on 2026-10-30.

alter table public.splits
  add column if not exists is_preferred boolean not null default false;

-- At most one preferred split per user.
create unique index if not exists idx_splits_user_preferred
  on public.splits (user_id)
  where is_preferred;

-- Writes go through the existing splits_update_own policy (owner only).
