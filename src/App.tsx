import { useState, useEffect, useCallback } from 'react';
import type { GoogleUser, CalendarEvent, ClientContact, AppointmentAnalysis, WorkflowState } from './types.ts';
import { initAuth, requestToken, revokeToken } from './lib/auth.ts';
import { fetchUpcomingEvents, getAttendeeEmails, getWorkflowState, updateEventWorkflow, parseServiceType } from './lib/calendar.ts';
import { lookupContactByEmail, createContact } from './lib/contacts.ts';
import { createDraft } from './lib/gmail.ts';
import { analyzeAppointment, generateEmailDraft, generateEstimate } from './lib/gemini.ts';
import Login from './components/Login.tsx';
import Header from './components/Header.tsx';
import Dashboard from './components/Dashboard.tsx';
import AppointmentDetail from './components/AppointmentDetail.tsx';

type View = 'login' | 'dashboard' | 'detail';

export default function App() {
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const [view, setView] = useState<View>('login');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [clientContact, setClientContact] = useState<ClientContact | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const [creatingContact, setCreatingContact] = useState(false);
  const [attendeeEmail, setAttendeeEmail] = useState('');

  const [analysis, setAnalysis] = useState<AppointmentAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [actionResults, setActionResults] = useState<Record<string, 'success' | 'error'>>({});

  const [error, setError] = useState('');

  // Initialize Google auth on mount
  useEffect(() => {
    initAuth(
      (googleUser) => {
        setUser(googleUser);
        setAuthLoading(false);
        setAuthError('');
        setView('dashboard');
      },
      (err) => {
        setAuthError(err);
        setAuthLoading(false);
      }
    );
  }, []);

  // Fetch events when entering dashboard
  const loadEvents = useCallback(async () => {
    if (!user) return;
    setEventsLoading(true);
    setError('');
    try {
      const items = await fetchUpcomingEvents(user.accessToken);
      setEvents(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setEventsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (view === 'dashboard' && user) {
      loadEvents();
    }
  }, [view, user, loadEvents]);

  // --- Handlers ---

  function handleSignIn() {
    setAuthLoading(true);
    setAuthError('');
    requestToken();
  }

  function handleLogout() {
    if (user) revokeToken(user.accessToken);
    setUser(null);
    setView('login');
    setEvents([]);
    setSelectedEvent(null);
    setClientContact(null);
    setAnalysis(null);
    setActionLoading({});
    setActionResults({});
    setError('');
  }

  async function handleSelectEvent(event: CalendarEvent) {
    setSelectedEvent(event);
    setAnalysis(null);
    setActionLoading({});
    setActionResults({});
    setClientContact(null);
    setView('detail');

    const emails = getAttendeeEmails(event);
    const email = emails[0] || '';
    setAttendeeEmail(email);

    if (email && user) {
      setContactLoading(true);
      try {
        const contact = await lookupContactByEmail(user.accessToken, email);
        setClientContact(contact);
      } catch {
        // Contact not found is not an error
      } finally {
        setContactLoading(false);
      }
    }
  }

  function handleBack() {
    setView('dashboard');
    setSelectedEvent(null);
    setClientContact(null);
    setAnalysis(null);
    setActionLoading({});
    setActionResults({});
  }

  async function handleAnalyze() {
    if (!selectedEvent || !user) return;
    setAnalyzing(true);
    try {
      const result = await analyzeAppointment(selectedEvent, clientContact);
      setAnalysis(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleCreateContact(data: { name: string; email: string; phone: string; address: string }) {
    if (!user) return;
    setCreatingContact(true);
    try {
      const contact = await createContact(user.accessToken, data);
      setClientContact(contact);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create contact');
    } finally {
      setCreatingContact(false);
    }
  }

  async function handleAction(actionId: string) {
    if (!selectedEvent || !user) return;

    setActionLoading((prev) => ({ ...prev, [actionId]: true }));

    try {
      const actionType = actionId as 'confirm' | 'confirmation' | 'reminder' | 'followup' | 'estimate';
      const email = attendeeEmail;

      if (actionType === 'estimate') {
        const serviceType = parseServiceType(selectedEvent.summary);
        const estimate = await generateEstimate(serviceType, selectedEvent.description || '', clientContact);
        if (email) {
          await createDraft(
            user.accessToken,
            email,
            `Service Estimate: ${serviceType}`,
            estimate.estimateText
          );
        }
      } else {
        const draftType = actionType === 'confirm' ? 'confirmation' as const : actionType as 'reminder' | 'followup';
        const draft = await generateEmailDraft(draftType, selectedEvent, clientContact);
        if (email) {
          await createDraft(user.accessToken, email, draft.subject, draft.body);
        }
      }

      setActionResults((prev) => ({ ...prev, [actionId]: 'success' }));

      // Update workflow status
      const currentState = getWorkflowState(selectedEvent);
      const newState: WorkflowState = { ...currentState };

      if (actionType === 'confirm') {
        newState.status = 'confirmed';
        newState.confirmedAt = new Date().toISOString();
      } else if (actionType === 'reminder') {
        newState.status = 'reminded';
        newState.remindedAt = new Date().toISOString();
      } else if (actionType === 'followup') {
        newState.status = 'followed-up';
        newState.followedUpAt = new Date().toISOString();
      } else if (actionType === 'estimate') {
        newState.estimateSent = true;
      }

      await updateEventWorkflow(user.accessToken, selectedEvent.id, newState);

      // Update the event in our local state
      setSelectedEvent((prev) => prev ? {
        ...prev,
        extendedProperties: {
          ...prev.extendedProperties,
          private: {
            ...prev.extendedProperties?.private,
            sphericalAssistant: JSON.stringify(newState),
          },
        },
      } : prev);

    } catch (err) {
      setActionResults((prev) => ({ ...prev, [actionId]: 'error' }));
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading((prev) => ({ ...prev, [actionId]: false }));
    }
  }

  return (
    <div className="app">
      {view === 'login' && (
        <Login onSignIn={handleSignIn} loading={authLoading} error={authError} />
      )}

      {view === 'dashboard' && user && (
        <>
          <Header user={user} onLogout={handleLogout} />
          <Dashboard
            events={events}
            loading={eventsLoading}
            onRefresh={loadEvents}
            onSelectEvent={handleSelectEvent}
          />
        </>
      )}

      {view === 'detail' && user && selectedEvent && (
        <>
          <Header user={user} onLogout={handleLogout} onBack={handleBack} showBack />
          <AppointmentDetail
            event={selectedEvent}
            contact={clientContact}
            contactLoading={contactLoading}
            attendeeEmail={attendeeEmail}
            onCreateContact={handleCreateContact}
            creatingContact={creatingContact}
            analysis={analysis}
            analyzing={analyzing}
            onAnalyze={handleAnalyze}
            actionLoading={actionLoading}
            actionResults={actionResults}
            onAction={handleAction}
          />
        </>
      )}

      {error && view !== 'login' && (
        <div className="error-bar">
          {error}
          <button className="error-dismiss" onClick={() => setError('')}>&times;</button>
        </div>
      )}

      <footer>Spherical Assistant &middot; SphereLabs AI</footer>
    </div>
  );
}
