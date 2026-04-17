import { useEffect, useState } from 'react';
import type { CalendarEvent } from '../types.ts';
import { getEventDateTime, formatEventTime, parseServiceType, getClientNameFromSummary, getAttendeeEmails } from '../lib/calendar.ts';

interface NowBarProps {
  events: CalendarEvent[];
  onOpen: (event: CalendarEvent) => void;
}

function nextUpcoming(events: CalendarEvent[]): CalendarEvent | null {
  const now = Date.now();
  const future = events
    .map((event) => ({ event, t: getEventDateTime(event).getTime() }))
    .filter(({ t }) => !isNaN(t) && t > now)
    .sort((a, b) => a.t - b.t);
  return future[0]?.event || null;
}

function formatCountdown(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 1) return 'now';
  if (totalMinutes < 60) return `in ${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `in ${hours}h ${minutes}m` : `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

function prepState(event: CalendarEvent): { label: string; tone: 'ready' | 'warn' | 'risk' } {
  const hasClient = (event.attendees || []).some((a) => !a.self);
  const hasLocation = Boolean(event.location?.trim());
  const hasNotes = Boolean(event.description?.trim());
  if (!hasClient) return { label: 'no client attached', tone: 'risk' };
  if (!hasLocation) return { label: 'no location set', tone: 'warn' };
  if (!hasNotes) return { label: 'no prep notes', tone: 'warn' };
  return { label: 'prepped', tone: 'ready' };
}

export default function NowBar({ events, onOpen }: NowBarProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const next = nextUpcoming(events);
  if (!next) return null;

  const startMs = getEventDateTime(next).getTime();
  const diff = startMs - Date.now();
  const within2h = diff <= 2 * 60 * 60 * 1000;
  const title = parseServiceType(next.summary);
  const client = getClientNameFromSummary(next.summary) || getAttendeeEmails(next)[0] || '';
  const prep = prepState(next);

  return (
    <div className={`now-bar now-bar-${within2h ? 'hot' : 'warm'}`} data-tick={tick}>
      <div className="now-bar-pulse" aria-hidden />
      <div className="now-bar-main">
        <span className="now-bar-label">Next up</span>
        <strong className="now-bar-title">{title}</strong>
        {client && <span className="now-bar-client">with {client}</span>}
        <span className="now-bar-countdown">{formatCountdown(diff)}</span>
        <span className="now-bar-time">· {formatEventTime(next)}</span>
      </div>
      <div className="now-bar-right">
        <span className={`now-bar-prep now-bar-prep-${prep.tone}`}>{prep.label}</span>
        <button className="btn-primary now-bar-open" onClick={() => onOpen(next)}>Open</button>
      </div>
    </div>
  );
}
