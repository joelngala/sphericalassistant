import { useEffect, useState } from 'react';
import type { DraftPreviewData } from '../types.ts';

interface DraftPreviewProps {
  draft: DraftPreviewData;
  onSaveDraft: (draft: DraftPreviewData) => void;
  onSendNow: (draft: DraftPreviewData) => void;
  onSchedule: (draft: DraftPreviewData, sendAt: Date) => void;
  onRefine: (draft: DraftPreviewData, instruction: string) => void;
  onClose: () => void;
  sending: boolean;
  refining: boolean;
}

export default function DraftPreview({
  draft,
  onSaveDraft,
  onSendNow,
  onSchedule,
  onRefine,
  onClose,
  sending,
  refining,
}: DraftPreviewProps) {
  const [to, setTo] = useState(draft.to);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [refinementPrompt, setRefinementPrompt] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('09:00');

  const edited: DraftPreviewData = { ...draft, to, subject, body };
  const hasRecipient = to.trim().length > 0 && to.includes('@');
  const canSubmit = hasRecipient && subject.trim().length > 0 && body.trim().length > 0;

  useEffect(() => {
    setTo(draft.to);
    setSubject(draft.subject);
    setBody(draft.body);
  }, [draft]);

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="draft-modal">
        <div className="draft-header">
          <h2>Email Preview</h2>
          <button className="btn-icon" onClick={onClose} title="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="draft-fields">
          <div className="draft-field">
            <label>To</label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="client@email.com"
              className={!hasRecipient && to.length > 0 ? 'input-error' : ''}
            />
            {!hasRecipient && (
              <p className="field-warning">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="var(--warning)">
                  <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 10.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zM8.75 4.5v4h-1.5v-4h1.5z"/>
                </svg>
                Add a valid recipient email before saving, sending, or preparing a Gmail draft for later scheduling.
              </p>
            )}
          </div>

          <div className="draft-field">
            <label>Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
            />
          </div>

          <div className="draft-field">
            <label>Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              placeholder="Email body"
            />
          </div>
        </div>

        <div className="refine-panel">
          <label>Refine with AI</label>
          <div className="refine-controls">
            <textarea
              value={refinementPrompt}
              onChange={(e) => setRefinementPrompt(e.target.value)}
              rows={3}
              placeholder="Example: make this shorter, warmer, and mention we will arrive within a 30-minute window."
            />
            <button
              className="btn-secondary"
              onClick={() => {
                onRefine(edited, refinementPrompt.trim());
                setRefinementPrompt('');
              }}
              disabled={!refinementPrompt.trim() || refining || sending}
            >
              {refining ? <div className="spinner-sm" /> : 'Refine Draft'}
            </button>
          </div>
        </div>

        {showSchedule && (
          <div className="schedule-picker">
            <label>Prepare Gmail draft for:</label>
            <div className="schedule-inputs">
              <input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
              />
              <button
                className="btn-primary"
                disabled={!scheduleDate || !canSubmit || sending || refining}
                onClick={() => {
                  const sendAt = new Date(`${scheduleDate}T${scheduleTime}`);
                  onSchedule(edited, sendAt);
                }}
              >
                {sending ? <div className="spinner-sm" /> : 'Save Gmail Draft'}
              </button>
            </div>
            <p className="schedule-note">
              This does not auto-schedule the email. It saves a Gmail draft with the intended send time noted so you can use Gmail's own Schedule send option.
            </p>
          </div>
        )}

        <div className="draft-actions">
          <button
            className="btn-secondary"
            onClick={() => onSaveDraft(edited)}
            disabled={!canSubmit || sending || refining}
          >
            {sending ? <div className="spinner-sm" /> : null}
            Save as Draft
          </button>

          <button
            className="btn-schedule"
            onClick={() => setShowSchedule(!showSchedule)}
            disabled={!canSubmit || sending || refining}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            Prepare in Gmail
          </button>

          <button
            className="btn-send"
            onClick={() => onSendNow(edited)}
            disabled={!canSubmit || sending || refining}
          >
            {sending ? (
              <div className="spinner-sm" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            )}
            Send Now
          </button>
        </div>
      </div>
    </div>
  );
}
