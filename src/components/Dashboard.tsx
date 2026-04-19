import { useState } from 'react';
import type { AssistantActionItem, BusinessInsights, CalendarEvent, MorningBrief } from '../types.ts';
import { groupEventsByDate, getEventDateTime } from '../lib/calendar.ts';
import AppointmentCard from './AppointmentCard.tsx';
import IntakeConnectCard from './IntakeConnectCard.tsx';
import NowBar from './NowBar.tsx';

interface DashboardProps {
  events: CalendarEvent[];
  loading: boolean;
  onRefresh: () => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onCreateAppointment: () => void;
  onOpenCases: () => void;
  onOpenOrganizer: () => void;
  insights: BusinessInsights | null;
  insightsLoading: boolean;
  onGenerateInsights: () => void;
  morningBrief: MorningBrief | null;
  morningBriefLoading: boolean;
  onGenerateMorningBrief: () => void;
  onCreateMorningBriefReminder: () => void;
  actionItems: AssistantActionItem[];
  onCreateActionReminder: (action: AssistantActionItem) => void;
  creatingReminderId: string | null;
  firmName: string;
}

function isToday(date: Date): boolean {
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function isThisWeek(date: Date): boolean {
  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return date >= now && date <= weekEnd;
}

export default function Dashboard({
  events,
  loading,
  onRefresh,
  onSelectEvent,
  onCreateAppointment,
  onOpenCases,
  onOpenOrganizer,
  insights,
  insightsLoading,
  onGenerateInsights,
  morningBrief,
  morningBriefLoading,
  onGenerateMorningBrief,
  onCreateMorningBriefReminder,
  actionItems,
  onCreateActionReminder,
  creatingReminderId,
  firmName,
}: DashboardProps) {
  const [showDeeperView, setShowDeeperView] = useState(false);

  const grouped = groupEventsByDate(events);

  const todayEvents = events.filter((event) => {
    const d = getEventDateTime(event);
    return !isNaN(d.getTime()) && isToday(d);
  });
  const weekEvents = events.filter((event) => {
    const d = getEventDateTime(event);
    return !isNaN(d.getTime()) && isThisWeek(d);
  });

  const highPriorityActions = actionItems.filter((a) => a.priority === 'high').length;
  const appointmentsMissingClient = events.filter(
    (event) => !event.attendees?.some((attendee) => !attendee.self)
  ).length;
  const appointmentsMissingLocation = events.filter((event) => !event.location?.trim()).length;
  const needsAttention = highPriorityActions + appointmentsMissingClient + appointmentsMissingLocation;

  const todayLabels = new Set(['Today', 'Tomorrow']);
  const todayGroups = Array.from(grouped.entries()).filter(([label]) => todayLabels.has(label));
  const laterGroups = Array.from(grouped.entries()).filter(([label]) => !todayLabels.has(label));

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <div>
          <h2>Command Center</h2>
          <p className="subtitle">
            {todayEvents.length
              ? `${todayEvents.length} on your plate today`
              : 'No appointments scheduled today'}
          </p>
        </div>
        <div className="dashboard-actions">
          <button className="btn-primary" onClick={onCreateAppointment}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
            New Appointment
          </button>
          <button className="btn-secondary" onClick={onOpenOrganizer}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            Documents
          </button>
          <button className="btn-secondary" onClick={onOpenCases}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4h18v4H3zM3 10h18v10H3zM8 14h8M8 18h5" />
            </svg>
            Cases
          </button>
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
      </div>

      <NowBar events={events} onOpen={onSelectEvent} />

      <section className="insight-grid">
        <div className="insight-card insight-today">
          <span className="insight-label">Today</span>
          <strong>{todayEvents.length}</strong>
          <p>Appointments on the calendar today</p>
        </div>
        <div className="insight-card insight-week">
          <span className="insight-label">This week</span>
          <strong>{weekEvents.length}</strong>
          <p>Scheduled within the next seven days</p>
        </div>
        <div className={`insight-card insight-attention ${needsAttention ? 'insight-attention-active' : ''}`}>
          <span className="insight-label">Needs attention</span>
          <strong>{needsAttention}</strong>
          <p>High-priority actions and missing scheduling data</p>
        </div>
      </section>

      <section className="dashboard-panel action-center-panel">
        <div className="panel-header">
          <div>
            <h3>Action Center</h3>
            <p className="subtitle">Catch missing info, confirmations, follow-ups, and retention opportunities.</p>
          </div>
        </div>
        {actionItems.length > 0 ? (
          <div className="action-list">
            {actionItems.map((action) => (
              <div key={action.id} className={`action-row action-priority-${action.priority}`}>
                <div className="action-row-main">
                  <div className="action-row-header">
                    <h4>{action.title}</h4>
                    <span className={`priority-pill priority-${action.priority}`}>{action.priority}</span>
                  </div>
                  <p>{action.detail}</p>
                  <button className="text-link" onClick={() => {
                    const relatedEvent = events.find((event) => event.id === action.eventId);
                    if (relatedEvent) onSelectEvent(relatedEvent);
                  }}>
                    Open appointment
                  </button>
                </div>
                <button className="btn-secondary" onClick={() => onCreateActionReminder(action)} disabled={creatingReminderId === action.id}>
                  {creatingReminderId === action.id ? <div className="spinner-sm" /> : 'Create Reminder'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="panel-empty">Nothing urgent. You're clear.</p>
        )}
      </section>

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
          <button className="btn-primary" onClick={onCreateAppointment}>Create First Appointment</button>
        </div>
      ) : (
        <>
          {todayGroups.length > 0 && (
            <div className="event-list event-list-today">
              {todayGroups.map(([dateLabel, dateEvents]) => (
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

          {laterGroups.length > 0 && (
            <details className="event-list-later">
              <summary>
                <span>The rest of the week</span>
                <span className="event-list-later-count">{laterGroups.reduce((n, [, ev]) => n + ev.length, 0)}</span>
              </summary>
              <div className="event-list">
                {laterGroups.map(([dateLabel, dateEvents]) => (
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
            </details>
          )}
        </>
      )}

      <IntakeConnectCard firmName={firmName} compact />

      <button
        className="btn-secondary dashboard-toggle-deeper"
        onClick={() => setShowDeeperView((v) => !v)}
      >
        {showDeeperView ? 'Hide' : 'Show'} business insights & morning brief
      </button>

      {showDeeperView && (
        <section className="dashboard-panels">
          <div className="dashboard-panel">
            <div className="panel-header">
              <div>
                <h3>State Of Business</h3>
                <p className="subtitle">Patterns and growth opportunities from the schedule</p>
              </div>
              <button className="btn-secondary" onClick={onGenerateInsights} disabled={insightsLoading}>
                {insightsLoading ? <div className="spinner-sm" /> : 'Generate Insights'}
              </button>
            </div>
            {insights ? (
              <div className="panel-stack">
                <p className="panel-summary">{insights.overview}</p>
                <div className="pattern-list">
                  {insights.patterns.map((pattern) => (
                    <div key={pattern.title} className={`pattern-card pattern-${pattern.impact}`}>
                      <div className="pattern-title-row">
                        <h4>{pattern.title}</h4>
                        <span>{pattern.impact}</span>
                      </div>
                      <p>{pattern.insight}</p>
                    </div>
                  ))}
                </div>
                {insights.opportunities.length > 0 && (
                  <div className="bullet-panel">
                    <h4>Opportunities</h4>
                    <ul className="checklist">
                      {insights.opportunities.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {insights.recommendedAutomations.length > 0 && (
                  <div className="bullet-panel">
                    <h4>Recommended Automations</h4>
                    <ul className="checklist">
                      {insights.recommendedAutomations.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="panel-empty">Generate a business snapshot to see operational risks, growth patterns, and automation opportunities.</p>
            )}
          </div>

          <div className="dashboard-panel">
            <div className="panel-header">
              <div>
                <h3>Morning Brief</h3>
                <p className="subtitle">Daily owner briefing generated from today's calendar</p>
              </div>
              <div className="dashboard-actions">
                <button className="btn-secondary" onClick={onGenerateMorningBrief} disabled={morningBriefLoading}>
                  {morningBriefLoading ? <div className="spinner-sm" /> : 'Generate Brief'}
                </button>
                <button className="btn-primary" onClick={onCreateMorningBriefReminder} disabled={!morningBrief || creatingReminderId === 'morning-brief'}>
                  {creatingReminderId === 'morning-brief' ? <div className="spinner-sm" /> : 'Create 7AM Reminder'}
                </button>
              </div>
            </div>
            {morningBrief ? (
              <div className="panel-stack">
                <div className="brief-card">
                  <h4>{morningBrief.headline}</h4>
                  <p>{morningBrief.summary}</p>
                </div>
                <div className="bullet-panel">
                  <h4>Priorities</h4>
                  <ul className="checklist">
                    {morningBrief.priorities.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="bullet-panel">
                  <h4>Risks</h4>
                  <ul className="checklist">
                    {morningBrief.risks.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <p className="panel-summary"><strong>Suggested focus:</strong> {morningBrief.suggestedFocus}</p>
              </div>
            ) : (
              <p className="panel-empty">Generate the owner's morning brief, then turn it into a Google Calendar reminder event with email + popup notifications.</p>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
