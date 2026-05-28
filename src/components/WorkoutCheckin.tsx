import { useState } from 'react';
import { supabase } from '../utils/supabaseClient';

interface WorkoutCheckinProps {
  splitName: string;
  dayName: string;
  /** Called on submit (success or failure) or when the user fully skips. */
  onComplete: () => void;
}

interface CheckinAnswers {
  feel: number | null;
  effort: number | null;
  sleep: number | null;
  soreness: number | null;
  tookPreworkout: boolean | null;
}

const INITIAL_ANSWERS: CheckinAnswers = {
  feel: null,
  effort: null,
  sleep: null,
  soreness: null,
  tookPreworkout: null,
};

const SCALE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

interface ScaleQuestionProps {
  label: string;
  hint?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}

function ScaleQuestion({ label, hint, value, onChange, disabled }: ScaleQuestionProps): React.JSX.Element {
  return (
    <div className="checkin-question">
      <span className="checkin-question-label">
        {label}
        {hint ? <span className="checkin-question-hint"> {hint}</span> : null}
      </span>
      <div className="checkin-scale" role="radiogroup" aria-label={label}>
        {SCALE_VALUES.map((n) => {
          const isSelected = value === n;
          return (
            <button
              key={n}
              type="button"
              className={`checkin-scale-btn ${isSelected ? 'checkin-scale-btn--selected' : ''}`}
              onClick={() => onChange(n)}
              aria-pressed={isSelected}
              disabled={disabled}
            >
              {n}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="checkin-question-skip"
        onClick={() => onChange(null)}
        disabled={disabled}
      >
        Skip
      </button>
    </div>
  );
}

interface YesNoQuestionProps {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  disabled?: boolean;
}

function YesNoQuestion({ label, value, onChange, disabled }: YesNoQuestionProps): React.JSX.Element {
  return (
    <div className="checkin-question">
      <span className="checkin-question-label">{label}</span>
      <div className="checkin-yesno" role="radiogroup" aria-label={label}>
        <button
          type="button"
          className={`checkin-yesno-btn ${value === true ? 'checkin-yesno-btn--selected' : ''}`}
          onClick={() => onChange(true)}
          aria-pressed={value === true}
          disabled={disabled}
        >
          Yes
        </button>
        <button
          type="button"
          className={`checkin-yesno-btn ${value === false ? 'checkin-yesno-btn--selected' : ''}`}
          onClick={() => onChange(false)}
          aria-pressed={value === false}
          disabled={disabled}
        >
          No
        </button>
      </div>
      <button
        type="button"
        className="checkin-question-skip"
        onClick={() => onChange(null)}
        disabled={disabled}
      >
        Skip
      </button>
    </div>
  );
}

function WorkoutCheckin({ splitName, dayName, onComplete }: WorkoutCheckinProps): React.JSX.Element {
  const [answers, setAnswers] = useState<CheckinAnswers>(INITIAL_ANSWERS);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function update<K extends keyof CheckinAnswers>(key: K, value: CheckinAnswers[K]): void {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(): Promise<void> {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const authResult = await supabase.auth.getUser();
      const user = authResult.data.user;
      if (user) {
        const trimmedSplit = splitName.trim();
        const trimmedDay = dayName.trim();
        await supabase.from('workout_checkins').insert({
          user_id: user.id,
          session_date: new Date().toISOString().slice(0, 10),
          split_name: trimmedSplit.length > 0 ? trimmedSplit : null,
          day_name: trimmedDay.length > 0 ? trimmedDay : null,
          feel: answers.feel,
          effort: answers.effort,
          sleep: answers.sleep,
          soreness: answers.soreness,
          took_preworkout: answers.tookPreworkout,
        });
      }
    } catch {
      // Checkins are non-critical telemetry — never block navigation on failure.
    } finally {
      onComplete();
    }
  }

  function handleSkipAll(): void {
    if (isSubmitting) return;
    onComplete();
  }

  return (
    <div
      className="checkin-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkin-title"
    >
      <div className="checkin-header">
        <h2 id="checkin-title" className="checkin-title">Quick check-in</h2>
        <button
          type="button"
          className="checkin-skip-all"
          onClick={handleSkipAll}
          disabled={isSubmitting}
        >
          Skip questionnaire
        </button>
      </div>
      <div className="checkin-questions">
        <ScaleQuestion
          label="How did you feel?"
          hint="(1 = terrible, 10 = great)"
          value={answers.feel}
          onChange={(v) => update('feel', v)}
          disabled={isSubmitting}
        />
        <ScaleQuestion
          label="How hard did you push?"
          hint="(1 = easy, 10 = max effort)"
          value={answers.effort}
          onChange={(v) => update('effort', v)}
          disabled={isSubmitting}
        />
        <ScaleQuestion
          label="Sleep last night?"
          hint="(1 = terrible, 10 = great)"
          value={answers.sleep}
          onChange={(v) => update('sleep', v)}
          disabled={isSubmitting}
        />
        <ScaleQuestion
          label="Soreness going in?"
          hint="(1 = none, 10 = very sore)"
          value={answers.soreness}
          onChange={(v) => update('soreness', v)}
          disabled={isSubmitting}
        />
        <YesNoQuestion
          label="Did you take pre-workout?"
          value={answers.tookPreworkout}
          onChange={(v) => update('tookPreworkout', v)}
          disabled={isSubmitting}
        />
      </div>
      <div className="checkin-footer">
        <button
          type="button"
          className="nav-button nav-button--finish-ready"
          onClick={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Submitting...' : 'Submit'}
        </button>
      </div>
    </div>
  );
}

export default WorkoutCheckin;
