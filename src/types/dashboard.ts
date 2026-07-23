import type { MuscleGroup } from '../lib/muscles';
import type { TrendVerdict, CheckinInsight, PrEntry, WeekStats } from '../lib/analysis';

export interface DashboardSession {
  id: string;
  /** ISO timestamp. */
  date: string;
  dayName: string;
  splitName: string;
  totalVolume: number;
  totalSets: number;
}

export interface DashboardExerciseTrend {
  name: string;
  slopePctPerWeek: number;
  sessions: number;
  lastTop: { weight: number; reps: number; date: string };
  series: Array<{ date: string; e1rm: number }>;
}

export interface DashboardMuscleGroup {
  name: MuscleGroup;
  verdict: TrendVerdict;
  slopePctPerWeek: number;
  weeklySets: Array<{ weekStart: string; sets: number }>;
  exercises: DashboardExerciseTrend[];
  bestMover?: { name: string; slopePctPerWeek: number };
  worstMover?: { name: string; slopePctPerWeek: number };
}

export interface DashboardRotation {
  splitName: string;
  days: Array<{ name: string; lastTrained?: string }>;
  nextDayName: string | null;
}

export interface DashboardCheckinSummary {
  count30d: number;
  avgFeel: number | null;
  avgEffort: number | null;
  avgSleep: number | null;
  avgSoreness: number | null;
  avgDiet: number | null;
  /** Percent of check-ins reporting pre-workout, 0-100. */
  preworkoutRate: number | null;
}

export interface DashboardResponse {
  sessions: DashboardSession[];
  muscleGroups: DashboardMuscleGroup[];
  prs: PrEntry[];
  insights: CheckinInsight[];
  weekStats: WeekStats;
  rotation: DashboardRotation | null;
  checkinSummary: DashboardCheckinSummary;
}
