interface ExerciseNoteFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** Free-text note for one exercise in the current workout (the day-level note lives on the exercise list). */
function ExerciseNoteField({ value, onChange, disabled = false }: ExerciseNoteFieldProps): React.JSX.Element {
  return (
    <label className="input-label notes-label exercise-note-field">
      Note for this exercise (optional)
      <textarea
        className="textarea-field"
        rows={2}
        value={value}
        placeholder="Seat height, grip, what to try next time…"
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </label>
  );
}

export default ExerciseNoteField;
