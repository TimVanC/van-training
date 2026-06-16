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

type QuestionKey = keyof CheckinAnswers;

interface QuestionDef {
  key: QuestionKey;
  label: string;
  hint?: string;
  type: 'scale' | 'yesno';
}

const QUESTIONS: QuestionDef[] = [
  { key: 'feel', label: 'How did you feel?', hint: '1 = terrible, 10 = great', type: 'scale' },
  { key: 'effort', label: 'How hard did you push?', hint: '1 = easy, 10 = max effort', type: 'scale' },
  { key: 'sleep', label: 'Sleep last night?', hint: '1 = terrible, 10 = great', type: 'scale' },
  { key: 'soreness', label: 'Soreness going in?', hint: '1 = none, 10 = very sore', type: 'scale' },
  { key: 'tookPreworkout', label: 'Did you take pre-workout?', type: 'yesno' },
];

function WorkoutCheckin({ splitName, dayName, onComplete }: WorkoutCheckinProps): React.JSX.Element {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<CheckinAnswers>(INITIAL_ANSWERS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  const currentQuestion = QUESTIONS[stepIndex];
  const isLastQuestion = stepIndex === QUESTIONS.length - 1;

  async function persistAndComplete(finalAnswers: CheckinAnswers): Promise<void> {
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
          feel: finalAnswers.feel,
          effort: finalAnswers.effort,
          sleep: finalAnswers.sleep,
          soreness: finalAnswers.soreness,
          took_preworkout: finalAnswers.tookPreworkout,
        });
      }
    } catch {
      // Checkins are non-critical telemetry — never block navigation on failure.
    } finally {
      setIsSubmitting(false);
      setIsComplete(true);
      window.setTimeout(() => onComplete(), 1400);
    }
  }

  function advance(updated: CheckinAnswers): void {
    if (isLastQuestion) {
      void persistAndComplete(updated);
      return;
    }
    setStepIndex((i) => i + 1);
  }

  function handleAnswerScale(value: number | null): void {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const updated = { ...answers, [currentQuestion.key]: value };
    setAnswers(updated);
    advance(updated);
  }

  function handleAnswerYesNo(value: boolean | null): void {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const updated = { ...answers, [currentQuestion.key]: value };
    setAnswers(updated);
    advance(updated);
  }

  function handleSkipAll(): void {
    if (isSubmitting) return;
    onComplete();
  }

  return (
    <div className="checkin-overlay" role="dialog" aria-modal="true" aria-labelledby="checkin-title">
      <div className="checkin-modal">
        <div className="checkin-header">
          <h2 id="checkin-title" className="checkin-title">Post-Lift Check-In</h2>
          {!isComplete && (
            <button type="button" className="checkin-skip-all" onClick={handleSkipAll} disabled={isSubmitting}>
              Skip questionnaire
            </button>
          )}
        </div>

        {isComplete ? (
          <div className="checkin-done">
            <p className="checkin-done-message">Thanks — logged.</p>
          </div>
        ) : (
          <>
            <div className="checkin-progress" aria-hidden>
              {QUESTIONS.map((q, i) => (
                <span key={q.key} className={`checkin-progress-dot ${i === stepIndex ? 'checkin-progress-dot--active' : ''} ${i < stepIndex ? 'checkin-progress-dot--done' : ''}`} />
              ))}
            </div>

            <div className="checkin-question">
              <span className="checkin-question-label">
                {currentQuestion.label}
                {currentQuestion.hint ? <span className="checkin-question-hint">{currentQuestion.hint}</span> : null}
              </span>

              {currentQuestion.type === 'scale' ? (
                <div className="checkin-scale" role="radiogroup" aria-label={currentQuestion.label}>
                  {SCALE_VALUES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="checkin-scale-btn"
                      onClick={() => handleAnswerScale(n)}
                      disabled={isSubmitting}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="checkin-yesno" role="radiogroup" aria-label={currentQuestion.label}>
                  <button type="button" className="checkin-yesno-btn" onClick={() => handleAnswerYesNo(true)} disabled={isSubmitting}>
                    Yes
                  </button>
                  <button type="button" className="checkin-yesno-btn" onClick={() => handleAnswerYesNo(false)} disabled={isSubmitting}>
                    No
                  </button>
                </div>
              )}

              <button
                type="button"
                className="checkin-question-skip"
                onClick={() => (currentQuestion.type === 'scale' ? handleAnswerScale(null) : handleAnswerYesNo(null))}
                disabled={isSubmitting}
              >
                Skip this question
              </button>
            </div>

            {isSubmitting && <p className="checkin-submitting-label">Saving...</p>}
          </>
        )}
      </div>
    </div>
  );
}

export default WorkoutCheckin;
