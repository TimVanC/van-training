import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { invalidateDashboardCache } from '../hooks/useDashboardData';
import { MAX_DAYS, MAX_EXERCISES_PER_DAY, MAX_SETS, type SplitDraft } from '../lib/splitDraft.js';
import type { ChatAttachment, ChatTurn, OnboardingChatResponse } from '../types/onboarding';
import { ATTACHMENT_ACCEPT, AttachmentError, fileToAttachment } from '../utils/attachments';
import { supabase } from '../utils/supabaseClient';

const GREETING =
  "Hey, I'm your Van Training coach. Show me what you're running right now: a screenshot of your notes, a spreadsheet, a PDF, or just type it out, and I'll set it up for you. No program yet? Tell me how many days a week you can train and what equipment you have, and I'll build one.";

const MAX_ATTACHMENTS = 4;
/** Vercel rejects request bodies over ~4.5 MB; stay clear of it. */
const MAX_REQUEST_CHARS = 4_000_000;

async function postJson<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) return { ok: false, error: json.error ?? 'Something went wrong. Try again.' };
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: 'No connection. Check your signal and try again.' };
  }
}

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

const IconX = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function AttachmentChip({ attachment, onRemove }: { attachment: ChatAttachment; onRemove?: () => void }): React.JSX.Element {
  return (
    <span className="ob-chip">
      {attachment.kind === 'image' ? (
        <img className="ob-chip-thumb" src={`data:${attachment.mediaType};base64,${attachment.data}`} alt="" />
      ) : (
        <span className="ob-chip-kind">{attachment.kind === 'pdf' ? 'PDF' : 'FILE'}</span>
      )}
      <span className="ob-chip-name">{attachment.name}</span>
      {onRemove && (
        <button type="button" className="ob-chip-remove" onClick={onRemove} aria-label={`Remove ${attachment.name}`}>
          <IconX size={12} />
        </button>
      )}
    </span>
  );
}

function SplitCard({
  draft,
  onChange,
  onSave,
  saving,
  error,
}: {
  draft: SplitDraft;
  onChange: (next: SplitDraft) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}): React.JSX.Element {
  const setDay = (dayIndex: number, patch: Partial<SplitDraft['days'][number]>) =>
    onChange({ ...draft, days: draft.days.map((d, i) => (i === dayIndex ? { ...d, ...patch } : d)) });
  const setExercise = (dayIndex: number, exIndex: number, patch: Partial<SplitDraft['days'][number]['exercises'][number]>) =>
    setDay(dayIndex, {
      exercises: draft.days[dayIndex].exercises.map((e, i) => (i === exIndex ? { ...e, ...patch } : e)),
    });

  const exerciseCount = draft.days.reduce((n, d) => n + d.exercises.length, 0);

  return (
    <section className="ob-card" aria-label="Your split">
      <p className="ob-card-kicker">Your split</p>
      <input
        className="ob-input ob-input--title"
        value={draft.name}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        aria-label="Split name"
        maxLength={60}
      />
      <p className="ob-card-sub">
        {draft.days.length} {draft.days.length === 1 ? 'day' : 'days'} · {exerciseCount} exercises. Edit anything here, or tell
        the coach what to change.
      </p>

      {draft.days.map((day, dayIndex) => (
        <div key={dayIndex} className="ob-day">
          <div className="ob-day-head">
            <span className="ob-day-number">{dayIndex + 1}</span>
            <input
              className="ob-input ob-input--day"
              value={day.name}
              onChange={(e) => setDay(dayIndex, { name: e.target.value })}
              aria-label={`Day ${dayIndex + 1} name`}
              maxLength={40}
            />
            {draft.days.length > 1 && (
              <button
                type="button"
                className="ob-icon-btn"
                onClick={() => onChange({ ...draft, days: draft.days.filter((_, i) => i !== dayIndex) })}
                aria-label={`Remove ${day.name || `day ${dayIndex + 1}`}`}
              >
                <IconX />
              </button>
            )}
          </div>

          {day.exercises.map((ex, exIndex) => (
            <div key={exIndex} className="ob-exercise">
              <input
                className="ob-input ob-input--exercise"
                value={ex.name}
                onChange={(e) => setExercise(dayIndex, exIndex, { name: e.target.value })}
                aria-label="Exercise name"
                placeholder="Exercise"
                maxLength={80}
              />
              <input
                className="ob-input ob-input--num"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_SETS}
                value={ex.sets}
                onChange={(e) => setExercise(dayIndex, exIndex, { sets: Number(e.target.value) })}
                aria-label="Sets"
              />
              <span className="ob-times" aria-hidden>×</span>
              <input
                className="ob-input ob-input--reps"
                value={ex.repRange}
                onChange={(e) => setExercise(dayIndex, exIndex, { repRange: e.target.value })}
                aria-label="Rep range"
                placeholder="8-12"
                maxLength={12}
              />
              <button
                type="button"
                className="ob-icon-btn"
                onClick={() => setDay(dayIndex, { exercises: day.exercises.filter((_, i) => i !== exIndex) })}
                aria-label={`Remove ${ex.name || 'exercise'}`}
              >
                <IconX />
              </button>
            </div>
          ))}

          {day.exercises.length < MAX_EXERCISES_PER_DAY && (
            <button
              type="button"
              className="ob-add"
              onClick={() => setDay(dayIndex, { exercises: [...day.exercises, { name: '', sets: 3, repRange: '8-12' }] })}
            >
              + Add exercise
            </button>
          )}
        </div>
      ))}

      {draft.days.length < MAX_DAYS && (
        <button
          type="button"
          className="ob-add ob-add--day"
          onClick={() =>
            onChange({
              ...draft,
              days: [...draft.days, { name: `Day ${draft.days.length + 1}`, exercises: [{ name: '', sets: 3, repRange: '8-12' }] }],
            })
          }
        >
          + Add day
        </button>
      )}

      {error && <p className="ob-error">{error}</p>}
      <button type="button" className="ob-primary" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Looks right, start training'}
      </button>
    </section>
  );
}

function Onboarding({ onDone }: { onDone: (saved: boolean) => void }): React.JSX.Element {
  const navigate = useNavigate();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState<SplitDraft | null>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest message (or the typing dots) in view.
  const hasDraft = draft !== null;
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, sending, hasDraft]);

  // Grow the composer with its content, up to the CSS max-height.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    setError(null);
    setReading(true);
    const added: ChatAttachment[] = [];
    for (const file of Array.from(files)) {
      if (pending.length + added.length >= MAX_ATTACHMENTS) {
        setError(`Up to ${MAX_ATTACHMENTS} files per message.`);
        break;
      }
      try {
        added.push(await fileToAttachment(file));
      } catch (e) {
        setError(e instanceof AttachmentError ? e.message : `Couldn't read ${file.name}.`);
      }
    }
    setPending((current) => [...current, ...added]);
    setReading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function send(): Promise<void> {
    const content = text.trim();
    if (sending || (content.length === 0 && pending.length === 0)) return;

    const turn: ChatTurn = { role: 'user', content, ...(pending.length > 0 ? { attachments: pending } : {}) };
    const nextTurns = [...turns, turn];
    const body = { messages: nextTurns, draft };
    if (JSON.stringify(body).length > MAX_REQUEST_CHARS) {
      setError('Those files are too large together. Send fewer at a time.');
      return;
    }

    setError(null);
    setTurns(nextTurns);
    setText('');
    setPending([]);
    setSending(true);
    const result = await postJson<OnboardingChatResponse>('/api/onboardingChat', body);
    setSending(false);
    if (!result.ok) {
      // Put the message back so nothing the user typed or attached is lost.
      setTurns(turns);
      setText(content);
      setPending(turn.attachments ?? []);
      setError(result.error);
      return;
    }
    setTurns([...nextTurns, { role: 'assistant', content: result.data.reply }]);
    if (result.data.split) {
      setDraft(result.data.split);
      setSaveError(null);
    }
  }

  async function save(): Promise<void> {
    if (!draft || saving) return;
    setSaveError(null);
    setSaving(true);
    const result = await postJson<{ splitName: string }>('/api/saveSplit', { draft });
    if (!result.ok) {
      setSaving(false);
      setSaveError(result.error);
      return;
    }
    invalidateDashboardCache();
    onDone(true);
    navigate('/', { replace: true });
  }

  function leave(): void {
    onDone(false);
    navigate('/', { replace: true });
  }

  const canSend = !sending && !reading && (text.trim().length > 0 || pending.length > 0);

  return (
    <div className="ob-screen">
      <header className="ob-header">
        <span className="ob-header-title">Coach</span>
        <button type="button" className="ob-header-skip" onClick={leave}>
          {draft ? 'Close' : 'Skip for now'}
        </button>
      </header>

      <div className="ob-thread">
        <p className="ob-coach">{GREETING}</p>

        {turns.map((turn, i) =>
          turn.role === 'assistant' ? (
            <p key={i} className="ob-coach">
              {turn.content}
            </p>
          ) : (
            <div key={i} className="ob-user">
              {turn.attachments && turn.attachments.length > 0 && (
                <div className="ob-user-files">
                  {turn.attachments.map((a, j) => (
                    <AttachmentChip key={j} attachment={a} />
                  ))}
                </div>
              )}
              {turn.content && <p className="ob-bubble">{turn.content}</p>}
            </div>
          ),
        )}

        {sending && (
          <div className="ob-typing" role="status" aria-label="Coach is thinking">
            <span />
            <span />
            <span />
          </div>
        )}

        {draft && !sending && (
          <SplitCard draft={draft} onChange={setDraft} onSave={() => void save()} saving={saving} error={saveError} />
        )}

        <div ref={endRef} />
      </div>

      <div className="ob-composer-wrap">
        {error && <p className="ob-error">{error}</p>}
        <div className="ob-composer">
          {pending.length > 0 && (
            <div className="ob-pending">
              {pending.map((a, i) => (
                <AttachmentChip key={i} attachment={a} onRemove={() => setPending((c) => c.filter((_, j) => j !== i))} />
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="ob-textarea"
            rows={1}
            placeholder={draft ? 'Ask for a change' : 'Message the coach'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            maxLength={4000}
          />
          <div className="ob-composer-row">
            <button
              type="button"
              className="ob-round"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || reading}
              aria-label="Attach a file"
            >
              <IconPlus />
            </button>
            <span className="ob-composer-hint">{reading ? 'Reading file…' : 'Screenshot, PDF, spreadsheet or text'}</span>
            <button type="button" className="ob-round ob-round--send" onClick={() => void send()} disabled={!canSend} aria-label="Send">
              <IconArrowUp />
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          hidden
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>
    </div>
  );
}

export default Onboarding;
