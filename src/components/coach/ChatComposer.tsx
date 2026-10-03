import { useEffect, useRef } from 'react';

const IconPlus = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconArrowUp = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  canSend: boolean;
  placeholder: string;
  hint?: string;
  error?: string | null;
  /** Shows the + button when provided. */
  onAttach?: () => void;
  attachDisabled?: boolean;
  /** Pending attachments, rendered inside the card above the text. */
  children?: React.ReactNode;
}

/** The rounded message box at the bottom of a coach conversation. */
function ChatComposer({
  value,
  onChange,
  onSend,
  canSend,
  placeholder,
  hint,
  error,
  onAttach,
  attachDisabled,
  children,
}: ChatComposerProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Grow with the content, up to the CSS max-height.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="ob-composer-wrap">
      {error && <p className="ob-error">{error}</p>}
      <div className="ob-composer">
        {children}
        <textarea
          ref={textareaRef}
          className="ob-textarea"
          rows={1}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          maxLength={4000}
        />
        <div className="ob-composer-row">
          {onAttach && (
            <button type="button" className="ob-round" onClick={onAttach} disabled={attachDisabled} aria-label="Attach a file">
              <IconPlus />
            </button>
          )}
          <span className="ob-composer-hint">{hint}</span>
          <button type="button" className="ob-round ob-round--send" onClick={onSend} disabled={!canSend} aria-label="Send">
            <IconArrowUp />
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatComposer;
