import { useState, useEffect, useRef } from 'react';

export interface IntakeAnswers {
  fullName: string;
  phone: string;
  email: string;
  bestContact: string;
  matterType: string;
  matterDetail: string;
  description: string;
  opposingParty: string;
  jurisdictionState: string;
  jurisdictionCounty: string;
  urgent: 'yes' | 'no' | '';
  urgencyReason: string;
  preferredTimes: string;
  howHeard: string;
  consent: boolean;
}

const EMPTY_ANSWERS: IntakeAnswers = {
  fullName: '',
  phone: '',
  email: '',
  bestContact: '',
  matterType: '',
  matterDetail: '',
  description: '',
  opposingParty: '',
  jurisdictionState: '',
  jurisdictionCounty: '',
  urgent: '',
  urgencyReason: '',
  preferredTimes: '',
  howHeard: '',
  consent: false,
};

interface TranscriptMessage {
  role: 'bot' | 'user';
  text: string;
}

interface IntakeChatResponse {
  reply: string;
  quickReplies?: string[];
  updatedAnswers: IntakeAnswers;
  done: boolean;
  summary?: string;
}

interface IntakeProps {
  firmName?: string;
  embed?: boolean;
}

export default function Intake({ firmName = 'the firm', embed = false }: IntakeProps) {
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [answers, setAnswers] = useState<IntakeAnswers>(EMPTY_ANSWERS);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [done, setDone] = useState(false);
  const [summary, setSummary] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  // Kick off the conversation on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void sendTurn([], EMPTY_ANSWERS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, thinking]);

  // Tell the parent iframe to resize when embedded
  useEffect(() => {
    if (!embed) return;
    const height = document.documentElement.scrollHeight;
    window.parent?.postMessage({ type: 'spherical-intake:resize', height }, '*');
  }, [messages, embed, submitted, done]);

  async function sendTurn(
    nextMessages: TranscriptMessage[],
    currentAnswers: IntakeAnswers
  ) {
    setThinking(true);
    setError('');
    setQuickReplies([]);
    try {
      const workerUrl = import.meta.env.VITE_API_BASE_URL;
      const firmId = new URLSearchParams(window.location.search).get('firm') || '';
      const response = await fetch(`${workerUrl}/intake-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages,
          answers: currentAnswers,
          firmName,
          firmId,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Chat request failed (${response.status})`);
      }
      const data = (await response.json()) as IntakeChatResponse;
      const botMessage: TranscriptMessage = { role: 'bot', text: data.reply };
      setMessages([...nextMessages, botMessage]);
      setAnswers({ ...currentAnswers, ...data.updatedAnswers });
      setQuickReplies(data.quickReplies || []);
      if (data.done) {
        setDone(true);
        setSummary(data.summary || '');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      setMessages([
        ...nextMessages,
        {
          role: 'bot',
          text: `Sorry, I\'m having trouble connecting right now. Please try again in a moment, or call the firm directly.`,
        },
      ]);
    } finally {
      setThinking(false);
    }
  }

  function handleUserMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || thinking || done) return;
    const nextMessages: TranscriptMessage[] = [
      ...messages,
      { role: 'user', text: trimmed },
    ];
    setMessages(nextMessages);
    void sendTurn(nextMessages, answers);
  }

  async function handleConfirmSubmit() {
    if (submitting || submitted) return;
    const finalAnswers = { ...answers, consent: true };
    setAnswers(finalAnswers);
    setSubmitting(true);
    setError('');
    try {
      const workerUrl = import.meta.env.VITE_API_BASE_URL;
      const firmId = new URLSearchParams(window.location.search).get('firm') || '';
      const response = await fetch(`${workerUrl}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: finalAnswers,
          transcript: messages,
          summary,
          firmId,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Submission failed (${response.status})`);
      }
      setSubmitted(true);
      setMessages((prev) => [
        ...prev,
        {
          role: 'bot',
          text:
            finalAnswers.urgent === 'yes'
              ? '✅ Got it, thank you. The attorney will be in touch within a few hours given the urgency.'
              : '✅ Got it, thank you. The attorney will review your intake and reach out within 1 business day.',
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={embed ? 'intake-root intake-embed' : 'intake-root'}>
      <div className="intake-card">
        <header className="intake-header">
          <div className="intake-logo">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" fill="var(--accent)" opacity="0.15" />
              <circle cx="16" cy="16" r="10" stroke="var(--accent)" strokeWidth="2" fill="none" />
              <ellipse cx="16" cy="16" rx="10" ry="4" stroke="var(--accent)" strokeWidth="1.5" fill="none" />
            </svg>
            <div>
              <div className="intake-title">Free Consultation</div>
              <div className="intake-subtitle">{firmName}</div>
            </div>
          </div>
        </header>

        <div className="intake-messages" ref={scrollRef}>
          {messages.map((msg, idx) => (
            <div key={idx} className={`intake-msg intake-msg-${msg.role}`}>
              <div className="intake-bubble">{msg.text}</div>
            </div>
          ))}
          {thinking && (
            <div className="intake-msg intake-msg-bot">
              <div className="intake-bubble intake-typing">
                <span /><span /><span />
              </div>
            </div>
          )}
        </div>

        {!submitted && (
          <div className="intake-input-area">
            {done && !submitting ? (
              <ConsentSubmit onConfirm={handleConfirmSubmit} summary={summary} />
            ) : (
              <>
                {quickReplies.length > 0 && !thinking && (
                  <div className="intake-quick-replies">
                    {quickReplies.map((reply) => (
                      <button
                        key={reply}
                        className="intake-quick-btn"
                        disabled={thinking || done}
                        onClick={() => handleUserMessage(reply)}
                      >
                        {reply}
                      </button>
                    ))}
                  </div>
                )}
                <ChatInput
                  disabled={thinking || done || submitting}
                  onSubmit={handleUserMessage}
                />
              </>
            )}
            {submitting && <div className="intake-submitting">Submitting your intake…</div>}
            {error && <div className="intake-error">{error}</div>}
          </div>
        )}

        {submitted && (
          <div className="intake-done">You can close this window now.</div>
        )}
      </div>
      {!embed && (
        <footer className="intake-footer">
          Powered by Spherical Assistant · Your information is confidential. Submitting
          this form does not create an attorney-client relationship.
        </footer>
      )}
    </div>
  );
}

function ChatInput({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus();
  }, [disabled]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSubmit(value);
    setValue('');
  }

  return (
    <form className="intake-chat-form" onSubmit={submit}>
      <textarea
        ref={textareaRef}
        rows={2}
        placeholder="Type your answer…"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit(e);
          }
        }}
      />
      <button
        type="submit"
        className="intake-btn-primary"
        disabled={disabled || !value.trim()}
      >
        Send
      </button>
    </form>
  );
}

function ConsentSubmit({
  summary,
  onConfirm,
}: {
  summary: string;
  onConfirm: () => void;
}) {
  return (
    <div className="intake-consent">
      {summary && (
        <div className="intake-summary">
          <div className="intake-summary-label">Your intake summary</div>
          <div className="intake-summary-text">{summary}</div>
        </div>
      )}
      <p className="intake-disclaimer">
        Submitting this intake does <strong>not</strong> create an attorney-client
        relationship. The information you shared is confidential, but you are not a
        client until the firm agrees to represent you in writing.
      </p>
      <button className="intake-btn-primary intake-btn-large" onClick={onConfirm}>
        I understand — submit my intake
      </button>
    </div>
  );
}
