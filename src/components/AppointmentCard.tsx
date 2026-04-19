import type { CalendarEvent, WorkflowStatus } from '../types.ts';
import { formatEventTime, getWorkflowState, parseServiceType, getAttendeeEmails, getClientNameFromSummary, getEventDateTime, isFreshIntake } from '../lib/calendar.ts';

interface AppointmentCardProps {
  event: CalendarEvent;
  onClick: () => void;
}

const STATUS_CONFIG: Record<WorkflowStatus, { label: string; className: string }> = {
  new: { label: 'New', className: 'badge-new' },
  confirmed: { label: 'Confirmed', className: 'badge-confirmed' },
  reminded: { label: 'Reminded', className: 'badge-reminded' },
  completed: { label: 'Completed', className: 'badge-completed' },
  'followed-up': { label: 'Followed Up', className: 'badge-followedup' },
};

type PrepTone = 'ready' | 'warn' | 'risk';
function prepInfo(event: CalendarEvent): { label: string; tone: PrepTone } | null {
  const start = getEventDateTime(event);
  if (isNaN(start.getTime())) return null;
  if (start.getTime() < Date.now()) return null;
  const hasClient = (event.attendees || []).some((a) => !a.self);
  const hasLocation = Boolean(event.location?.trim());
  const hasNotes = Boolean(event.description?.trim());
  if (!hasClient) return { label: 'no client', tone: 'risk' };
  if (!hasLocation) return { label: 'no location', tone: 'warn' };
  if (!hasNotes) return { label: 'no notes', tone: 'warn' };
  return { label: 'ready', tone: 'ready' };
}

export default function AppointmentCard({ event, onClick }: AppointmentCardProps) {
  const workflow = getWorkflowState(event);
  const status = STATUS_CONFIG[workflow.status];
  const serviceType = parseServiceType(event.summary);
  const clientName = getClientNameFromSummary(event.summary);
  const attendees = getAttendeeEmails(event);
  const time = formatEventTime(event);
  const prep = prepInfo(event);
  const freshIntake = isFreshIntake(event);
  const urgentIntake = freshIntake && workflow.urgent === true;

  return (
    <button
      className={`appointment-card ${prep ? `appointment-card-prep-${prep.tone}` : ''} ${freshIntake ? 'appointment-card-fresh-intake' : ''}`}
      onClick={onClick}
    >
      {freshIntake && (
        <span className={`new-lead-ribbon ${urgentIntake ? 'new-lead-ribbon-urgent' : ''}`}>
          {urgentIntake ? '🔥 URGENT LEAD' : '✨ NEW LEAD'}
        </span>
      )}
      <div className="card-time">{time}</div>
      <div className="card-content">
        <div className="card-service">{serviceType}</div>
        {(clientName || attendees.length > 0) && (
          <div className="card-client">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" opacity="0.5">
              <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm5 6a5 5 0 0 0-10 0h10z"/>
            </svg>
            {clientName || attendees[0]}
          </div>
        )}
        {event.location && (
          <div className="card-location">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" opacity="0.5">
              <path d="M8 0a5 5 0 0 1 5 5c0 3.5-5 9-5 9S3 8.5 3 5a5 5 0 0 1 5-5zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>
            </svg>
            {event.location}
          </div>
        )}
      </div>
      <div className="card-right">
        {prep && <span className={`prep-badge prep-badge-${prep.tone}`}>{prep.label}</span>}
        <div className={`status-badge ${status.className}`}>{status.label}</div>
      </div>
    </button>
  );
}
