import { describe, expect, it } from 'vitest';
import { exerciseProfile } from './muscles';

describe('exerciseProfile', () => {
  // Every catalog, swap and logged name as of 2026-11-10 (test rows excluded).
  const ALL_NAMES = [
    '45 Degree Hyperextension', 'Ab Wheel Rollouts', 'Adductor Machine', 'Arnold Press', 'Back Extension',
    'Back Extensions', 'Barbell Romanian Deadlift', 'Barbell Shrugs', 'Barbell Squat', 'Bayesian Cable Curl',
    'BB Bench Press', 'BB Rows', 'BB Skull Crushers', 'Bent-Over Dumbbell Reverse Fly', 'Cable Crunch',
    'Cable Crunches', 'Cable Curls', 'Cable Incline Curl', 'Cable Lateral Raises', 'Cable Laterial Raises',
    'Cable Laterial Raises (dual)', 'Cable Laterial Raises (single)', 'Cable Rear Delt Fly', 'Cable Rear Delt Flys',
    'Cable Rope Hammer Curl', 'Cable Serratus Pull', 'Cable Shrugs', 'Cable Single Lateral Raises',
    'Cable Woodchopper', 'Cable Y Raises', 'Cable Y-Raises', 'Calf Raises', "Captain's Chair Raise", 'Chest Dips',
    'Chest-Supported Machine Row', 'Close Grip Pulldown', 'Concentration Curl', 'Cross-Body Hammer Curl',
    'DB Bench Press', 'DB Incline Bench Press', 'DB Low to High Fly', 'DB Row', 'DB Shoulder Press',
    'DB Skull crushers', 'Decline Dumbbell Fly', 'Decline Dumbbell Press', 'Decline Machine Press',
    'Decline Press Machine', 'Dips', 'Double Cable Lat Raises', 'Dual cable rear delt cable fly',
    'Dual Lateral Raise', 'Duel Cable Column rear Dealt Fly', 'Duel Cable Extension', 'Duel Cable Raises',
    'Duel cable rear delts', 'Dumbbell Bulgarian Split Squat', 'Dumbbell Lateral Raises', 'Dumbbell Pullover',
    'Dumbbell Romanian Deadlift', 'Dumbbell Shrugs', 'EZ Bar Curl', 'EZ Bar or Cable Curls', 'EZ Bar Preacher Curl',
    'Face Pull', 'Face Pulls', 'Face Pulls (single)', 'Flat DB Bench Press', 'Flat Dumbbell Press',
    'Flat Machine Chest Press', 'Glute Ham Raise', 'Goblet Squat', 'Good Morning', 'H to L Flys', 'Hack Squat',
    'Hacksquat', 'Hammer Curl', 'Hammer Curls', 'Hamstring Curl', 'Hamstring Curls (lying)',
    'Hamstring Curls (seated)', 'Hanging Knee Raises', 'Hanging Leg Raise', 'Heavy Seated Cable Row',
    'High to Low C Flys', 'High to Low Cable Fly', 'incline bb press', 'Incline Bench Dumbbell Row',
    'Incline Cable Curls', 'Incline Curl', 'Incline DB Bench Press', 'Incline DB Curls', 'incline DB press',
    'Incline Dumbbell Curl', 'Incline Dumbbell Fly', 'Incline Dumbbell Press', 'Incline Machine Press',
    'Katana Ext.', 'Katana Extension', 'Kneeling Rope Crunch', 'L to H Flys', 'Landmine', 'Landmine Rotation',
    'Landmine Row', 'Lat Pulldown', 'Lean-Away Cable Raise', 'Leg Extension', 'Leg Press', 'Leg Press Calf Raise',
    'Leg Raise', 'Low to High C Flys', 'Low to High Cable Chest Fly', 'Low to High Cable Fly', 'Low to High DB FLYS',
    'Lying Hamstring Curl', 'Lying Leg Raise', 'Machine Crunch', 'Machine Dip', 'Machine Lateral Raise',
    'Machine Preacher Curl', 'Machine Pulldown', 'Machine Rotation', 'Machine Shoulder Press',
    'Machine Triceps Extension', 'Meadows Row', 'Mid Chest Fly Machine', 'Neutral Grip Lat Pulldown',
    'Neutral Grip Pull-ups', 'Nordic Curl', 'Oblique Crunch', 'One-Arm Cable Lat Pulldown', 'Overhead',
    'Overhead Cable Triceps Extension', 'Overhead Dumbbell Extension', 'Overhead Tricep Extension',
    'Overhead Tricep Extension (single)', 'Pallof Press', 'Pec Deck', 'Pendulum Squat', 'Preacher Curl',
    'pronated tricep extensions', 'Pronated Triceps Pushdowns', 'Pull Ups', 'Pushdown', 'Quad Extension',
    'Quad Extensions', 'RDL', "RDL's", 'Reverse Cable Curl', 'Reverse Crunch', 'Reverse Curl',
    'Reverse Grip EZ Curl', 'Reverse Hyperextension', 'Reverse Lunges', 'Reverse Nordic Curl', 'Reverse Pec Deck',
    'Reverse Pec Deck (dual)', 'Romanian Deadlift', 'Rope Pushdown', 'Seated Cable Row', 'Seated Calf Raise',
    'Seated Dumbbell Shoulder Press', 'Seated Leg Curl', 'Seated Row', 'Seated Row (Close Grip)', 'Serratus Crunch',
    'Serratus Push-Up', 'Shoulder Press', 'Shoulder Press Machine', 'Single arm cable ext.',
    'Single Arm Cable Lat Pulldown', 'Single Arm Dual Tricep Pushdowns', 'Single Arm Dumbbell Row',
    'Single Arm High to Low Cable Fly', 'Single Arm Low to High Cable Fly', 'Single Arm Pec Dec',
    'Single arm pronate tricep pushdowns', 'Single Arm Pulldown Machine', 'Single Arm Rear Delt Cable Fly',
    'Single Arm Tricep Extensions', 'Single Leg Calf Raise', 'Single Leg Extension', 'Single Leg Press',
    'Sissy Squat', 'Skullcrushers', 'Slight Decline Machine Press', 'Smith Machine Bench Press',
    'Smith Machine Calf Raise', 'Smith Machine Incline Press', 'Smith Machine Romanian Deadlift',
    'Smith Machine Shoulder Press', 'Smith Machine Shrugs', 'Smith Machine Split Squat', 'Smith Machine Squat',
    'Spider Curl', 'Standing Calf Raise', 'Standing Dumbbell Curl', 'Standing Overhead Press',
    'Standing Single-Leg Curl', 'Step-Ups', 'Straight Arm Pulldown', 'Sup Bicep Pulldown', 'T-Bar Row',
    'Trap Bar Deadlift', 'Trap Bar Shrugs', 'Tricep Extension', 'Tricep Extension (single)', 'Tricep Overhead Ext',
    'Tricep Pushdown', 'V-Bar Pushdown', 'Walking Lunges', 'Weighted Chest Dips', 'Weighted Decline Sit-Up',
    'Wide Grip Cable Row', 'Wide-Grip Lat Pulldown', 'Wide-Grip Seated Cable Row', 'Woodchoppers', 'Wrist Curl',
    'Zottman Curl',
  ];

  it('resolves every known exercise name', () => {
    expect(ALL_NAMES.filter((n) => !exerciseProfile(n))).toEqual([]);
  });

  it.each([
    ['Quad Extension', 'Quads'],
    ['Reverse Nordic Curl', 'Quads'],
    ['Double Cable Lat Raises', 'Shoulders'],
    ['Cable Laterial Raises (dual)', 'Shoulders'],
    ['Single arm cable ext.', 'Triceps'],
    ['Overhead', 'Triceps'],
    ['Landmine', 'Back'],
    ['Nordic Curl', 'Hamstrings'],
  ])('%s trains %s', (name, group) => {
    expect(exerciseProfile(name)?.primary).toBe(group);
  });

  it('reads a supinated pulldown as biceps-heavy', () => {
    expect(exerciseProfile('Sup Bicep Pulldown')?.load.Biceps).toBe(0.6);
  });
});
