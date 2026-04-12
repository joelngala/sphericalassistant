import { useState } from 'react';
import type { CalendarEvent, ClientContact, AppointmentAnalysis, WorkflowState, ActionResultStatus } from '../types.ts';
import { formatEventTime, parseServiceType, getWorkflowState, getClientNameFromSummary, getLinkedDocuments } from '../lib/calendar.ts';
import ClientPanel from './ClientPanel.tsx';

interface AppointmentDetailProps {
  event: CalendarEvent;
  contact: ClientContact | null;
  contactLoading: boolean;
  attendeeEmail: string;
  contactSuggestions: ClientContact[];
  contactsLoading: boolean;
  onSearchContacts: (query: string) => Promise<void>;
  onSelectContact: (contact: ClientContact) => Promise<void>;
  onUpdateEmail: (email: string) => Promise<void>;
  updatingEmail: boolean;
  onCreateContact: (data: { name: string; email: string; phone: string; address: string }) => void;
  creatingContact: boolean;
  onCreateDoc: () => void;
  onCreateSlides: () => void;
  creatingDoc: boolean;
  creatingSlides: boolean;
  analysis: AppointmentAnalysis | null;
  analyzing: boolean;
  onAnalyze: () => void;
  actionLoading: Record<string, boolean>;
  actionResults: Record<string, ActionResultStatus>;
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
  contactSuggestions,
  contactsLoading,
  onSearchContacts,
  onSelectContact,
  onUpdateEmail,
  updatingEmail,
  onCreateContact,
  creatingContact,
  onCreateDoc,
  onCreateSlides,
  creatingDoc,
  creatingSlides,
  analysis,
  analyzing,
  onAnalyze,
  actionLoading,
  actionResults,
  onAction,
}: AppointmentDetailProps) {
  const [manualEmail, setManualEmail] = useState('');
  const workflow = getWorkflowState(event);
  const serviceType = parseServiceType(event.summary);
  const suggestedClientName = getClientNameFromSummary(event.summary);
  const time = formatEventTime(event);
  const eventDate = new Date(event.start.dateTime || event.start.date || '');

  const defaultActions = [
    { id: 'confirm', type: 'confirm' as const, label: 'Draft Confirmation', description: 'Create a confirmation email', priority: 'high' as const },
    { id: 'reminder', type: 'reminder' as const, label: 'Draft Reminder', description: 'Create a reminder email', priority: 'medium' as const },
    { id: 'estimate', type: 'estimate' as const, label: 'Generate Estimate', description: 'Create a service estimate', priority: 'medium' as const },
    { id: 'followup', type: 'followup' as const, label: 'Draft Follow-up', description: 'Create a follow-up email', priority: 'low' as const },
  ];

  const actions = analysis?.suggestedActions || defaultActions;
  const hasEmail = attendeeEmail.trim().length > 0;

  function getResultLabel(result: ActionResultStatus | undefined, fallback: string): string {
    if (result === 'drafted') return 'Saved to Gmail drafts';
    if (result === 'sent') return 'Sent successfully';
    if (result === 'scheduled') return 'Gmail draft created for manual scheduling';
    if (result === 'error') return 'Action failed';
    return fallback;
  }

  async function handleAddEmail() {
    if (manualEmail.trim() && manualEmail.includes('@')) {
      await onUpdateEmail(manualEmail.trim());
      setManualEmail('');
    }
  }

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

        {!hasEmail && (
          <div className="email-warning">
            <div className="warning-header">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2" strokeLinecap="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
              </svg>
              <span>No client email found on this event</span>
            </div>
            <p className="warning-detail">Add an attendee to your calendar event, or enter an email below to enable email actions.</p>
            <div className="email-input-row">
              <input
                type="email"
                placeholder="client@email.com"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddEmail(); }}
              />
              <button
                className="btn-primary"
                onClick={handleAddEmail}
                disabled={!manualEmail.trim() || !manualEmail.includes('@') || updatingEmail}
              >
                {updatingEmail ? <div className="spinner-sm" /> : 'Add'}
              </button>
            </div>
          </div>
        )}

        {hasEmail && (
          <div className="email-confirmed">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="var(--success)">
              <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm3.5 5.5L7 10 4.5 7.5l1-1L7 8l3.5-3.5 1 1z"/>
            </svg>
            <span>{attendeeEmail}</span>
          </div>
        )}

        <LinkedDocsSection
          event={event}
          onCreateDoc={onCreateDoc}
          onCreateSlides={onCreateSlides}
          creatingDoc={creatingDoc}
          creatingSlides={creatingSlides}
        />

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
                  className={`action-card ${result && result !== 'error' ? 'action-done' : ''} ${action.priority === 'high' ? 'action-high' : ''}`}
                  onClick={() => onAction(action.id)}
                  disabled={isLoading || (result !== undefined && result !== 'error')}
                >
                  <div className="action-icon">
                    {isLoading ? (
                      <div className="spinner-sm" />
                    ) : result && result !== 'error' ? (
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
                    <div className="action-desc">{getResultLabel(result, action.description)}</div>
                  </div>
                  {action.priority === 'high' && !result && (
                    <span className="priority-dot" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="detail-sidebar">
        <ClientPanel
          contact={contact}
          loading={contactLoading}
          attendeeEmail={attendeeEmail}
          suggestedName={suggestedClientName}
          contactSuggestions={contactSuggestions}
          contactsLoading={contactsLoading}
          onSearchContacts={onSearchContacts}
          onSelectContact={onSelectContact}
          onUpdateEmail={onUpdateEmail}
          updatingEmail={updatingEmail}
          onCreateContact={onCreateContact}
          creatingContact={creatingContact}
        />
      </aside>
    </main>
  );
}

function LinkedDocsSection({
  event,
  onCreateDoc,
  onCreateSlides,
  creatingDoc,
  creatingSlides,
}: {
  event: CalendarEvent;
  onCreateDoc: () => void;
  onCreateSlides: () => void;
  creatingDoc: boolean;
  creatingSlides: boolean;
}) {
  const linkedDocs = getLinkedDocuments(event);
  const hasDoc = linkedDocs.some((d) => d.type === 'doc');
  const hasSlides = linkedDocs.some((d) => d.type === 'slides');

  return (
    <div className="linked-docs-section">
      <h3>Documents</h3>

      {linkedDocs.length > 0 && (
        <div className="linked-docs-list">
          {linkedDocs.map((doc) => (
            <a
              key={doc.id}
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`linked-doc-card linked-doc-${doc.type}`}
            >
              <div className="linked-doc-icon">
                {doc.type === 'doc' ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                )}
              </div>
              <div className="linked-doc-info">
                <span className="linked-doc-title">{doc.title}</span>
                <span className="linked-doc-meta">
                  {doc.type === 'doc' ? 'Google Doc' : 'Google Slides'} &middot; {new Date(doc.createdAt).toLocaleDateString()}
                </span>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          ))}
        </div>
      )}

      <div className="linked-docs-actions">
        {!hasDoc && (
          <button className="btn-secondary" onClick={onCreateDoc} disabled={creatingDoc}>
            {creatingDoc ? (
              <div className="spinner-sm" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            )}
            Create Google Doc
          </button>
        )}
        {!hasSlides && (
          <button className="btn-secondary" onClick={onCreateSlides} disabled={creatingSlides}>
            {creatingSlides ? (
              <div className="spinner-sm" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="12" y1="17" x2="12" y2="21" />
                <line x1="8" y1="21" x2="16" y2="21" />
              </svg>
            )}
            Create Google Slides
          </button>
        )}
      </div>
    </div>
  );
}
