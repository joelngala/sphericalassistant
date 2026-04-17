import type { ActivityLogEntry, ActivityAction } from '../types.ts';

interface ActivityLogProps {
  entries: ActivityLogEntry[];
  onChatAbout?: (entry: ActivityLogEntry) => void;
}

const ACTION_CONFIG: Record<ActivityAction, { icon: string; color: string }> = {
  email_drafted: { icon: 'M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z', color: 'var(--info)' },
  email_sent: { icon: 'M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z', color: 'var(--success)' },
  email_scheduled: { icon: 'M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z', color: 'var(--warning)' },
  doc_created: { icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8', color: 'var(--info)' },
  doc_updated: { icon: 'M12 20v-6M9 17l3-3 3 3M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6', color: 'var(--accent)' },
  slides_created: { icon: 'M2 3h20v14H2zM8 21h8M12 17v4', color: 'var(--info)' },
  slides_updated: { icon: 'M12 20v-6M9 17l3-3 3 3M2 3h20v14H2zM8 21h8', color: 'var(--accent)' },
  ai_analysis: { icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 10 14.556l-.548-.547z', color: 'var(--accent)' },
  task_completed: { icon: 'M5 13l4 4L19 7', color: 'var(--success)' },
  task_added: { icon: 'M12 5v14M5 12h14', color: 'var(--text-muted)' },
  document_uploaded: { icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12', color: 'var(--accent)' },
  document_removed: { icon: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', color: 'var(--danger)' },
  ai_chat: { icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', color: 'var(--accent)' },
  pdf_generated: { icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6', color: 'var(--success)' },
  contact_created: { icon: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M12.5 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM20 8v6M23 11h-6', color: 'var(--success)' },
  contact_updated: { icon: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M12.5 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z', color: 'var(--info)' },
  status_changed: { icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0 1 12 2.944a11.955 11.955 0 0 1-8.618 3.04A12.02 12.02 0 0 0 3 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', color: 'var(--warning)' },
  intake_extracted: { icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2', color: 'var(--accent)' },
  billing_plan_created: { icon: 'M3 10h18M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z', color: 'var(--accent)' },
  billing_plan_updated: { icon: 'M12 20v-6M9 17l3-3 3 3M3 10h18M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z', color: 'var(--info)' },
  billing_payment_succeeded: { icon: 'M5 13l4 4L19 7', color: 'var(--success)' },
  billing_payment_failed: { icon: 'M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', color: 'var(--warning)' },
  billing_plan_paused: { icon: 'M10 4H6v16h4zM18 4h-4v16h4z', color: 'var(--danger)' },
  billing_plan_resumed: { icon: 'M5 3l14 9-14 9V3z', color: 'var(--success)' },
  billing_plan_canceled: { icon: 'M18 6L6 18M6 6l12 12', color: 'var(--text-muted)' },
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return d.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function supportsChatFollowup(action: ActivityAction): boolean {
  return action === 'doc_created' || action === 'slides_created' || action === 'doc_updated' || action === 'slides_updated';
}

export default function ActivityLog({ entries, onChatAbout }: ActivityLogProps) {
  if (entries.length === 0) {
    return (
      <div className="activity-log-empty">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
        <p>No activity yet. Actions taken on this case will appear here.</p>
      </div>
    );
  }

  return (
    <div className="activity-log">
      <div className="activity-log-timeline">
        {entries.map((entry, i) => {
          const config = ACTION_CONFIG[entry.action] || ACTION_CONFIG.ai_chat;
          const isLast = i === entries.length - 1;

          return (
            <div key={entry.id} className="activity-log-entry">
              <div className="activity-log-connector">
                <div className="activity-log-dot" style={{ borderColor: config.color }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={config.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={config.icon} />
                  </svg>
                </div>
                {!isLast && <div className="activity-log-line" />}
              </div>
              <div className="activity-log-content">
                <span className="activity-log-label">{entry.label}</span>
                {entry.detail && <span className="activity-log-detail">{entry.detail}</span>}
                {supportsChatFollowup(entry.action) && onChatAbout && (
                  <button
                    className="activity-log-chat-btn"
                    onClick={() => onChatAbout(entry)}
                    type="button"
                  >
                    Chat about this
                  </button>
                )}
                <span className="activity-log-time">{formatTimestamp(entry.timestamp)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
