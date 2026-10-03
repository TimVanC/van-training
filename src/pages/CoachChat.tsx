import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ChatComposer from '../components/coach/ChatComposer';
import CoachChartView from '../components/coach/CoachChartView';
import type { CoachChart } from '../lib/coachChart.js';
import type { CoachChatResponse, CoachChatTurn } from '../types/onboarding';
import { postCoachJson } from '../utils/coachApi';

interface DisplayTurn extends CoachChatTurn {
  charts?: CoachChart[];
}

const SUGGESTIONS = [
  'How has my training looked the last month?',
  'Which lifts are stalling?',
  'Am I doing enough for each muscle group?',
  'Chart my strongest lift over time',
];

// The conversation survives leaving the page and coming back, until the app is closed.
let savedTurns: DisplayTurn[] = [];

function IconChevronLeft(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

/** Ask Coach Van about your own training log; answers can come with charts. */
function CoachChat(): React.JSX.Element {
  const navigate = useNavigate();
  const [turns, setTurns] = useState<DisplayTurn[]>(savedTurns);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    savedTurns = turns;
  }, [turns]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, sending]);

  async function ask(question: string): Promise<void> {
    const content = question.trim();
    if (sending || content.length === 0) return;
    const nextTurns: DisplayTurn[] = [...turns, { role: 'user', content }];
    setError(null);
    setTurns(nextTurns);
    setText('');
    setSending(true);
    const result = await postCoachJson<CoachChatResponse>('/api/coachChat', {
      messages: nextTurns.map(({ role, content: c }) => ({ role, content: c })),
    });
    setSending(false);
    if (!result.ok) {
      // Put the question back so it isn't lost.
      setTurns(turns);
      setText(content);
      setError(result.error);
      return;
    }
    setTurns([...nextTurns, { role: 'assistant', content: result.data.reply, charts: result.data.charts }]);
  }

  return (
    <div className="ob-screen">
      <header className="ob-header">
        <div className="ob-header-lead">
          <button type="button" className="ob-header-back" onClick={() => navigate('/analytics')} aria-label="Back to progress">
            <IconChevronLeft />
          </button>
          <span className="ob-header-title">Coach Van</span>
        </div>
        {turns.length > 0 && (
          <button
            type="button"
            className="ob-header-skip"
            onClick={() => {
              setTurns([]);
              setError(null);
            }}
            disabled={sending}
          >
            New chat
          </button>
        )}
      </header>

      <div className="ob-thread">
        <p className="ob-coach">
          Ask me anything about your training. I can look through your log, spot what's moving and what's stuck, and chart it for you.
        </p>

        {turns.length === 0 && (
          <div className="coach-suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="coach-suggestion" onClick={() => void ask(s)} disabled={sending}>
                {s}
              </button>
            ))}
          </div>
        )}

        {turns.map((turn, i) =>
          turn.role === 'assistant' ? (
            <div key={i} className="coach-answer">
              <p className="ob-coach">{turn.content}</p>
              {turn.charts?.map((chart, j) => <CoachChartView key={j} chart={chart} />)}
            </div>
          ) : (
            <div key={i} className="ob-user">
              <p className="ob-bubble">{turn.content}</p>
            </div>
          ),
        )}

        {sending && (
          <div className="ob-typing" role="status" aria-label="Coach Van is thinking">
            <span />
            <span />
            <span />
          </div>
        )}

        <div ref={endRef} />
      </div>

      <ChatComposer
        value={text}
        onChange={setText}
        onSend={() => void ask(text)}
        canSend={!sending && text.trim().length > 0}
        placeholder="Ask Coach Van"
        hint="Answers come from your own log"
        error={error}
      />
    </div>
  );
}

export default CoachChat;
