import type { CalendarEvent } from '../types.ts';
import { groupEventsByDate } from '../lib/calendar.ts';
import AppointmentCard from './AppointmentCard.tsx';

interface DashboardProps {
  events: CalendarEvent[];
  loading: boolean;
  onRefresh: () => void;
  onSelectEvent: (event: CalendarEvent) => void;
}

export default function Dashboard({ events, loading, onRefresh, onSelectEvent }: DashboardProps) {
  const grouped = groupEventsByDate(events);

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <div>
          <h2>Appointments</h2>
          <p className="subtitle">Next 14 days</p>
        </div>
        <button className="btn-secondary" onClick={onRefresh} disabled={loading}>
          {loading ? (
            <div className="spinner-sm" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 8a7 7 0 0 1 13-3.5M15 8a7 7 0 0 1-13 3.5" />
              <path d="M14 1v3.5h-3.5M2 15v-3.5h3.5" />
            </svg>
          )}
          Refresh
        </button>
      </div>

      {loading && events.length === 0 ? (
        <div className="empty-state">
          <div className="spinner" />
          <p>Loading your calendar...</p>
        </div>
      ) : events.length === 0 ? (
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
            <rect x="4" y="8" width="40" height="36" rx="4" />
            <path d="M4 18h40M16 4v8M32 4v8" />
          </svg>
          <h3>No upcoming appointments</h3>
          <p className="subtitle">Create a Google Calendar event with an attendee to get started.</p>
        </div>
      ) : (
        <div className="event-list">
          {Array.from(grouped.entries()).map(([dateLabel, dateEvents]) => (
            <div key={dateLabel} className="date-group">
              <h3 className="date-label">{dateLabel}</h3>
              {dateEvents.map((event) => (
                <AppointmentCard
                  key={event.id}
                  event={event}
                  onClick={() => onSelectEvent(event)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
