-- Canonicalize the "Legs + Shoulders" day template for every user.
--
-- Background:
--   Day templates are stored per user (splits -> workouts -> workout_exercises),
--   so they can drift apart. lstarbinski@gmail.com's Legs + Shoulders day was
--   rebuilt from his logged history (repair_lstarbinski_lift_templates.sql),
--   which left him with Hack Squat instead of Leg Press, no Romanian Deadlift,
--   and stale set/rep targets. The program is meant to be the same for everyone.
--
-- What this does:
--   Replaces every user's "Legs + Shoulders" prescription rows with the
--   canonical template below. INSERT/DELETE touch only workout_exercises
--   (the per-day prescription); logged history in sessions/lift_sets is
--   untouched, and no catalog (exercises) rows are modified.
--
-- Idempotent / safe to re-run: the delete+insert converges to the same state.

begin;

-- 1) Drop the existing (possibly drifted) prescriptions for that day.
delete from public.workout_exercises we
using public.workouts w
where we.workout_id = w.id
  and w.name = 'Legs + Shoulders';

-- 2) Insert the canonical prescription for every user's Legs + Shoulders day.
--    input_mode is left null so each exercise's catalog-level input mode
--    (e.g. Leg Press = plates) applies.
insert into public.workout_exercises (workout_id, exercise_id, sets, rep_range, order_index)
select w.id, e.id, c.sets, c.rep_range, c.order_index
from public.workouts w
cross join (
  values
    ('Leg Press',                      4, '6-10',  1),
    ('Romanian Deadlift',              4, '6-8',   2),
    ('Leg Extension',                  3, '10-15', 3),
    ('Hamstring Curl',                 3, '8-12',  4),
    ('Seated Calf Raise',              4, '8-15',  5),
    ('Seated Dumbbell Shoulder Press', 3, '6-10',  6),
    ('Cable Lateral Raises',           4, '12-20', 7)
) as c(exercise_name, sets, rep_range, order_index)
join public.exercises e on e.name = c.exercise_name
where w.name = 'Legs + Shoulders';

commit;
