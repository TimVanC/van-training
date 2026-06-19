import { useState } from 'react';
import { supabase } from '../utils/supabaseClient';

interface WorkoutCheckinProps {
  splitName: string;
  dayName: string;
  onComplete: () => void;
}

interface CheckinAnswers {
  feel: number | null;
  effort: number | null;
  sleep: number | null;
  soreness: number | null;
  dietQuality: number | null;
  tookPreworkout: boolean | null;
}

const INITIAL_ANSWERS: CheckinAnswers = {
  feel: null,
  effort: null,
  sleep: null,
  soreness: null,
  dietQuality: null,
  tookPreworkout: null,
};

const SCALE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const ADVANCE_DELAY_MS = 320;

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
  { key: 'dietQuality', label: 'Diet quality today?', hint: '1 = poor, 10 = excellent', type: 'scale' },
  { key: 'tookPreworkout', label: 'Did you take pre-workout?', type: 'yesno' },
];

function WorkoutCheckin({ splitName, dayName, onComplete }: WorkoutCheckinProps): React.JSX.Element {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<CheckinAnswers>(INITIAL_ANSWERS);
  const [pendingValue, setPendingValue] = useState<number | boolean | null>(null);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  const currentQuestion = QUESTIONS[stepIndex];
  const isLastQuestion = stepIndex === QUESTIONS.length - 1;
  const isFirstQuestion = stepIndex === 0;
  const currentAnswerValue = answers[currentQuestion.key];

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
          diet_quality: finalAnswers.dietQuality,
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

  function blurActiveElement(): void {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function commitAnswer(value: number | boolean | null): void {
    if (isAdvancing) return;
    blurActiveElement();
    setPendingValue(value);
    setIsAdvancing(true);

    const updated = { ...answers, [currentQuestion.key]: value };
    setAnswers(updated);

    window.setTimeout(() => {
      setIsAdvancing(false);
      setPendingValue(null);
      if (isLastQuestion) {
        void persistAndComplete(updated);
      } else {
        setStepIndex((i) => i + 1);
      }
    }, ADVANCE_DELAY_MS);
  }

  function handleBack(): void {
    if (isAdvancing || isFirstQuestion) return;
    blurActiveElement();
    setStepIndex((i) => i - 1);
  }

  function handleSkipAll(): void {
    if (isSubmitting) return;
    onComplete();
  }

  // While the brief post-tap delay is running, show the tapped value as filled;
  // otherwise show whatever was previously saved for this step, so Back
  // correctly restores the prior selection's highlight.
  const displayValue = isAdvancing ? pendingValue : currentAnswerValue;

  return (
    <div className="checkin-overlay" role="dialog" aria-modal="true" aria-labelledby="checkin-title">
      <div className="checkin-modal">
        <div className="checkin-header">
          <h2 id="checkin-title" className="checkin-title">Post-Lift Check-In</h2>
          <button type="button" className="checkin-skip-all" onClick={handleSkipAll} disabled={isSubmitting || isComplete}>
            Skip questionnaire
          </button>
        </div>

        {isComplete ? (
          <div className="checkin-done">
            <p className="checkin-done-message">Thanks — logged.</p>
          </div>
        ) : (
          <>
            <div className="checkin-progress" aria-hidden>
              {QUESTIONS.map((q, i) => (
                <span
                  key={q.key}
                  className={`checkin-progress-dot ${i === stepIndex ? 'checkin-progress-dot--active' : ''} ${i < stepIndex ? 'checkin-progress-dot--done' : ''}`}
                />
              ))}
            </div>

            <div className="checkin-question" key={currentQuestion.key}>
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
                      className={`checkin-scale-btn ${displayValue === n ? 'checkin-scale-btn--selected' : ''}`}
                      onClick={() => commitAnswer(n)}
                      disabled={isSubmitting || isAdvancing}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="checkin-yesno" role="radiogroup" aria-label={currentQuestion.label}>
                  <button
                    type="button"
                    className={`checkin-yesno-btn ${displayValue === true ? 'checkin-yesno-btn--selected' : ''}`}
                    onClick={() => commitAnswer(true)}
                    disabled={isSubmitting || isAdvancing}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className={`checkin-yesno-btn ${displayValue === false ? 'checkin-yesno-btn--selected' : ''}`}
                    onClick={() => commitAnswer(false)}
                    disabled={isSubmitting || isAdvancing}
                  >
                    No
                  </button>
                </div>
              )}

              <div className="checkin-question-footer">
                <button
                  type="button"
                  className="checkin-back-button"
                  onClick={handleBack}
                  disabled={isFirstQuestion || isAdvancing || isSubmitting}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="checkin-question-skip"
                  onClick={() => commitAnswer(null)}
                  disabled={isSubmitting || isAdvancing}
                >
                  Skip this question
                </button>
              </div>
            </div>

            {isSubmitting && <p className="checkin-submitting-label">Saving...</p>}
          </>
        )}
      </div>
    </div>
  );
}

export default WorkoutCheckin;
