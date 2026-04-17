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
const INTAKE_DRAFT_STORAGE_KEY = 'spherical-intake-draft-v1';

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

interface PreSubmitValidation {
  errors: string[];
  warnings: string[];
}

interface IntakeProps {
  firmName?: string;
  embed?: boolean;
}

const INTAKE_FIELDS_FOR_PROGRESS: (keyof IntakeAnswers)[] = [
  'fullName', 'phone', 'email', 'matterType', 'description',
  'jurisdictionState', 'urgent', 'preferredTimes',
];

const INACTIVITY_NUDGE_MS = 120_000; // 2 minutes

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
  const [showNudge, setShowNudge] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Kick off the conversation on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const draft = loadDraft();
    if (draft) {
      setMessages(draft.messages);
      setAnswers(draft.answers);
      setDone(Boolean(draft.done));
      setSummary(draft.summary || '');
      setQuickReplies([]);
      return;
    }
    void sendTurn([], EMPTY_ANSWERS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist in-progress intake locally so users can recover after refresh/disconnect.
  useEffect(() => {
    if (!initializedRef.current || submitted) return;
    try {
      const payload = {
        messages,
        answers,
        done,
        summary,
        updatedAt: Date.now(),
      };
      localStorage.setItem(INTAKE_DRAFT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage write issues (private mode/quota)
    }
  }, [messages, answers, done, summary, submitted]);

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

  // Inactivity nudge — if user hasn't typed in 2 min, show a gentle reminder
  useEffect(() => {
    if (done || submitted || thinking) return;
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    setShowNudge(false);
    nudgeTimerRef.current = setTimeout(() => {
      setShowNudge(true);
    }, INACTIVITY_NUDGE_MS);
    return () => {
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    };
  }, [messages, done, submitted, thinking]);

  const progress = computeProgress(answers, done);

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
          text: `Sorry, I\'m having trouble connecting right now. Your progress is saved on this device, so you can refresh and continue where you left off.`,
        },
      ]);
    } finally {
      setThinking(false);
    }
  }

  function handleUserMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || thinking || done) return;
    setShowNudge(false);
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
    const validation = validateBeforeSubmit(finalAnswers);
    if (validation.errors.length > 0) {
      setError(`Please fix before submitting: ${validation.errors.join(' ')}`);
      return;
    }
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
      clearDraft();
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
          <div className="intake-header-top">
            <div className="intake-logo">
              <div className="intake-logo-icon">
                <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
                  <ellipse cx="16" cy="16" rx="10" ry="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
                </svg>
              </div>
              <div>
                <div className="intake-title">Free Consultation</div>
                <div className="intake-subtitle">{firmName}</div>
              </div>
            </div>
            {!submitted && (
              <div className="intake-status-pill">
                <div className="intake-status-dot" />
                Online
              </div>
            )}
          </div>
          {!submitted && (
            <div className="intake-progress">
              <div className="intake-progress-bar">
                <div
                  className="intake-progress-fill"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <span className="intake-progress-label">{progress.label}</span>
            </div>
          )}
        </header>

        <div className="intake-messages" ref={scrollRef}>
          {messages.map((msg, idx) => (
            <div key={idx} className={`intake-msg intake-msg-${msg.role} intake-msg-enter`}>
              {msg.role === 'bot' && (
                <div className="intake-avatar">
                  <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
                    <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2.5" fill="none" />
                    <ellipse cx="16" cy="16" rx="10" ry="4" stroke="currentColor" strokeWidth="2" fill="none" />
                  </svg>
                </div>
              )}
              <div className="intake-bubble">{msg.text}</div>
            </div>
          ))}
          {thinking && (
            <div className="intake-msg intake-msg-bot intake-msg-enter">
              <div className="intake-avatar">
                <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2.5" fill="none" />
                  <ellipse cx="16" cy="16" rx="10" ry="4" stroke="currentColor" strokeWidth="2" fill="none" />
                </svg>
              </div>
              <div className="intake-bubble intake-typing">
                <span /><span /><span />
              </div>
            </div>
          )}
        </div>

        {!submitted && (
          <div className="intake-input-area">
            {done && !submitting ? (
              <ConsentSubmit
                answers={answers}
                onChangeAnswers={(partial) => {
                  setAnswers((prev) => ({ ...prev, ...partial }));
                  setError('');
                }}
                onConfirm={handleConfirmSubmit}
                summary={summary}
              />
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
                {showNudge && (
                  <div className="intake-nudge">
                    Still there? No rush — take your time. Your progress is saved so you can also come back later.
                  </div>
                )}
                <ChatInput
                  disabled={thinking || done || submitting}
                  onSubmit={handleUserMessage}
                />
              </>
            )}
            {submitting && (
              <div className="intake-submitting">
                <div className="spinner-sm" />
                Submitting your intake…
              </div>
            )}
            {error && <div className="intake-error">{error}</div>}
          </div>
        )}

        {submitted && (
          <div className="intake-done">
            <div className="intake-done-icon">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="14" fill="var(--success-glow)" stroke="var(--success)" strokeWidth="1.5" />
                <path d="M10 16l4 4 8-8" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </div>
            <p className="intake-done-title">Intake submitted</p>
            <p className="intake-done-detail">The attorney will review your information and reach out soon. You can close this window now.</p>
          </div>
        )}
      </div>
      {!embed && (
        <footer className="intake-footer">
          <span className="intake-footer-lock">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a4 4 0 0 0-4 4v2H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm2 6H6V5a2 2 0 1 1 4 0v2z" />
            </svg>
          </span>
          Powered by Spherical Assistant · Your information is confidential
        </footer>
      )}
    </div>
  );
}

function loadDraft(): {
  messages: TranscriptMessage[];
  answers: IntakeAnswers;
  done: boolean;
  summary: string;
} | null {
  try {
    const raw = localStorage.getItem(INTAKE_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{
      messages: TranscriptMessage[];
      answers: IntakeAnswers;
      done: boolean;
      summary: string;
      updatedAt: number;
    }>;
    if (!Array.isArray(parsed.messages) || !parsed.answers) return null;
    return {
      messages: parsed.messages,
      answers: { ...EMPTY_ANSWERS, ...parsed.answers },
      done: Boolean(parsed.done),
      summary: parsed.summary || '',
    };
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(INTAKE_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage delete issues
  }
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
        rows={1}
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
        className="intake-send-btn"
        disabled={disabled || !value.trim()}
        title="Send"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
      </button>
    </form>
  );
}

function ConsentSubmit({
  answers,
  onChangeAnswers,
  summary,
  onConfirm,
}: {
  answers: IntakeAnswers;
  onChangeAnswers: (partial: Partial<IntakeAnswers>) => void;
  summary: string;
  onConfirm: () => void;
}) {
  const validation = validateBeforeSubmit(answers);

  return (
    <div className="intake-consent">
      {summary && (
        <div className="intake-summary">
          <div className="intake-summary-label">Your intake summary</div>
          <div className="intake-summary-text">{summary}</div>
        </div>
      )}
      <div className="intake-summary">
        <div className="intake-summary-label">Confirm your contact details</div>
        <div className="intake-consent-fields">
          <div>
            <div className="intake-consent-field-label">Full name</div>
            <input
              type="text"
              placeholder="Full name"
              value={answers.fullName}
              onChange={(e) => onChangeAnswers({ fullName: e.target.value })}
            />
          </div>
          <div>
            <div className="intake-consent-field-label">Phone</div>
            <input
              type="tel"
              placeholder="Phone number"
              value={answers.phone}
              onChange={(e) => onChangeAnswers({ phone: e.target.value })}
            />
          </div>
          <div>
            <div className="intake-consent-field-label">Email</div>
            <input
              type="email"
              placeholder="Email address"
              value={answers.email}
              onChange={(e) => onChangeAnswers({ email: e.target.value })}
            />
          </div>
        </div>
        {validation.errors.length > 0 && (
          <div className="intake-error" style={{ marginTop: 8 }}>
            {validation.errors.join(' ')}
          </div>
        )}
        {validation.warnings.length > 0 && (
          <div className="intake-submitting" style={{ marginTop: 8 }}>
            Heads up: {validation.warnings.join(' ')}
          </div>
        )}
      </div>
      <p className="intake-disclaimer">
        Submitting this intake does <strong>not</strong> create an attorney-client
        relationship. The information you shared is confidential, but you are not a
        client until the firm agrees to represent you in writing.
      </p>
      <button
        className="intake-btn-primary intake-btn-large"
        onClick={onConfirm}
        disabled={validation.errors.length > 0}
      >
        I understand — submit my intake
      </button>
    </div>
  );
}

function computeProgress(answers: IntakeAnswers, done: boolean): { percent: number; label: string } {
  if (done) return { percent: 100, label: 'Ready to submit' };
  const filled = INTAKE_FIELDS_FOR_PROGRESS.filter((f) => {
    const v = answers[f];
    return v !== undefined && v !== null && v !== '';
  }).length;
  const total = INTAKE_FIELDS_FOR_PROGRESS.length;
  const percent = Math.round((filled / total) * 100);
  if (percent === 0) return { percent: 5, label: 'Getting started' };
  if (percent < 40) return { percent, label: 'Contact info' };
  if (percent < 75) return { percent, label: 'About your matter' };
  return { percent, label: 'Almost done' };
}

function validateBeforeSubmit(answers: IntakeAnswers): PreSubmitValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = String(answers.fullName || '').trim();
  const phone = String(answers.phone || '').trim();
  const email = String(answers.email || '').trim();

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const phoneDigits = phone.replace(/\D/g, '');
  const phoneOk = phoneDigits.length >= 10 && phoneDigits.length <= 15;
  const nameLetters = name.replace(/[^a-zA-Z]/g, '').length;

  if (!name) errors.push('Full name is required.');
  if (!phone) errors.push('Phone number is required.');
  if (!email) errors.push('Email is required.');
  if (phone && !phoneOk) errors.push('Phone number looks invalid (include area code).');
  if (email && !emailOk) errors.push('Email address looks invalid.');

  if (name && (nameLetters < 3 || name.split(/\s+/).length < 2)) {
    warnings.push('Name seems short. Please confirm it is complete.');
  }

  return { errors, warnings };
}
