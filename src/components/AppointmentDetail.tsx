import { useState } from 'react';
import type { CalendarEvent, ClientContact, AppointmentAnalysis, WorkflowState } from '../types.ts';
import { formatEventTime, parseServiceType, getWorkflowState } from '../lib/calendar.ts';
import ClientPanel from './ClientPanel.tsx';

interface AppointmentDetailProps {
  event: CalendarEvent;
  contact: ClientContact | null;
  contactLoading: boolean;
  attendeeEmail: string;
  onCreateContact: (data: { name: string; email: string; phone: string; address: string }) => void;
  creatingContact: boolean;
  analysis: AppointmentAnalysis | null;
  analyzing: boolean;
  onAnalyze: () => void;
  actionLoading: Record<string, boolean>;
  actionResults: Record<string, 'success' | 'error'>;
  onAction: (actionType: string) => void;
}

const ACTION_ICONS: Record<string, string> = {
  confirm: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0 1 12 2.944a11.955 11.955 0 0 1-8.618 3.04A12.02 12.02 0 0 0 3 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  reminder: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0 1 18 14.158V11a6.002 6.002 0 0 0-4-5.659V5a2 2 0 1 0-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9',
  followup: 'M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z',
  estimate: 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z',
  contact: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7z',
  custom: 'M13 10V3L4 14h7v7l9-11h-7z',
};

function StatusBadge({ workflow }: { workflow: WorkflowState }) {
  const configs: Record<string, { label: string; cls: string }> = {
    new: { label: 'New', cls: 'badge-new' },
    confirmed: { label: 'Confirmed', cls: 'badge-confirmed' },
    reminded: { label: 'Reminded', cls: 'badge-reminded' },
    completed: { label: 'Completed', cls: 'badge-completed' },
    'followed-up': { label: 'Followed Up', cls: 'badge-followedup' },
  };
  const c = configs[workflow.status] || configs.new;
  return <span className={`status-badge ${c.cls}`}>{c.label}</span>;
}

export default function AppointmentDetail({
  event,
  contact,
  contactLoading,
  attendeeEmail,
  onCreateContact,
  creatingContact,
  analysis,
  analyzing,
  onAnalyze,
  actionLoading,
  actionResults,
  onAction,
}: AppointmentDetailProps) {
  const [showEstimate, setShowEstimate] = useState(false);
  const workflow = getWorkflowState(event);
  const serviceType = parseServiceType(event.summary);
  const time = formatEventTime(event);
  const eventDate = new Date(event.start.dateTime || event.start.date || '');

  const defaultActions = [
    { id: 'confirm', type: 'confirm' as const, label: 'Draft Confirmation', description: 'Create a confirmation email draft', priority: 'high' as const },
    { id: 'reminder', type: 'reminder' as const, label: 'Draft Reminder', description: 'Create a reminder email draft', priority: 'medium' as const },
    { id: 'estimate', type: 'estimate' as const, label: 'Generate Estimate', description: 'Create a service estimate', priority: 'medium' as const },
    { id: 'followup', type: 'followup' as const, label: 'Draft Follow-up', description: 'Create a follow-up email draft', priority: 'low' as const },
  ];

  const actions = analysis?.suggestedActions || defaultActions;

  return (
    <main className="detail-view">
      <div className="detail-main">
        <div className="detail-header">
          <div>
            <h2>{serviceType}</h2>
            <div className="detail-meta">
              <span>{eventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
              <span className="meta-dot" />
              <span>{time}</span>
              {event.location && (
                <>
                  <span className="meta-dot" />
                  <span>{event.location}</span>
                </>
              )}
            </div>
          </div>
          <StatusBadge workflow={workflow} />
        </div>

        {event.description && (
          <div className="detail-notes">
            <label>Notes</label>
            <p>{event.description}</p>
          </div>
        )}

        <div className="analysis-section">
          {!analysis && !analyzing && (
            <button className="btn-accent analyze-btn" onClick={onAnalyze}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 10 14.556l-.548-.547z" />
              </svg>
              Analyze with AI
            </button>
          )}

          {analyzing && (
            <div className="analyzing">
              <div className="typing">
                <span /><span /><span />
              </div>
              <p className="text-muted">Analyzing appointment...</p>
            </div>
          )}

          {analysis && (
            <div className="analysis-results">
              <div className="intake-card">
                <h3>Client Summary</h3>
                <p>{analysis.clientSummary}</p>
              </div>
              <div className="intake-card">
                <h3>Appointment Notes</h3>
                <p>{analysis.appointmentNotes}</p>
              </div>
              {analysis.prepChecklist.length > 0 && (
                <div className="intake-card">
                  <h3>Prep Checklist</h3>
                  <ul className="checklist">
                    {analysis.prepChecklist.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="actions-section">
          <h3>Actions</h3>
          <div className="action-grid">
            {actions.map((action) => {
              const isLoading = actionLoading[action.id];
              const result = actionResults[action.id];
              const iconPath = ACTION_ICONS[action.type] || ACTION_ICONS.custom;

              return (
                <button
                  key={action.id}
                  className={`action-card ${result === 'success' ? 'action-done' : ''} ${action.priority === 'high' ? 'action-high' : ''}`}
                  onClick={() => {
                    if (action.type === 'estimate') setShowEstimate(true);
                    onAction(action.id);
                  }}
                  disabled={isLoading || result === 'success'}
                >
                  <div className="action-icon">
                    {isLoading ? (
                      <div className="spinner-sm" />
                    ) : result === 'success' ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d={iconPath} />
                      </svg>
                    )}
                  </div>
                  <div className="action-text">
                    <div className="action-label">{action.label}</div>
                    <div className="action-desc">{result === 'success' ? 'Done -- check Gmail drafts' : action.description}</div>
                  </div>
                  {action.priority === 'high' && !result && (
                    <span className="priority-dot" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {showEstimate && actionResults.estimate === 'success' && (
          <div className="estimate-result">
            <p className="text-muted">Estimate generated and saved as a Gmail draft.</p>
          </div>
        )}
      </div>

      <aside className="detail-sidebar">
        <ClientPanel
          contact={contact}
          loading={contactLoading}
          attendeeEmail={attendeeEmail}
          onCreateContact={onCreateContact}
          creatingContact={creatingContact}
        />
      </aside>
    </main>
  );
}
