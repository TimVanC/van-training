import { useEffect, useRef, useState } from 'react';

interface SetSavedToastProps {
  visible: boolean;
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  durationMs?: number;
}

const UNDO_TOAST_DURATION_MS = 3500;
const FADE_OUT_MS = 300;

function SetSavedToast({
  visible,
  message,
  onUndo,
  onDismiss,
  durationMs = UNDO_TOAST_DURATION_MS,
}: SetSavedToastProps): React.JSX.Element {
  const timerRef = useRef<number>(0);
  const exitRef = useRef<number>(0);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!visible) {
      setEntered(false);
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(10);
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    timerRef.current = window.setTimeout(() => {
      setEntered(false);
      exitRef.current = window.setTimeout(onDismiss, FADE_OUT_MS);
    }, durationMs);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timerRef.current);
      window.clearTimeout(exitRef.current);
    };
  }, [visible, durationMs, onDismiss]);

  if (!visible) return <></>;

  return (
    <div className={`toast toast--set-saved ${entered ? 'toast--visible' : ''}`} role="status">
      <span className="toast-message">{message}</span>
      <button type="button" className="toast-undo" onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}

export default SetSavedToast;
