import { useState, useEffect, useCallback } from 'react';
import type {
  AssistantActionItem,
  AssistantReminderData,
  BusinessInsights,
  GoogleUser,
  CalendarEvent,
  ClientContact,
  AppointmentAnalysis,
  MorningBrief,
  WorkflowState,
  DraftPreviewData,
  ActionResultStatus,
  ContactFormData,
  AppointmentFormData,
  EmailPreferences,
} from './types.ts';
import { initAuth, requestToken, revokeToken } from './lib/auth.ts';
import {
  createAssistantReminderEvent,
  fetchCalendarEvent,
  fetchUpcomingEvents,
  createCalendarEvent,
  getAttendeeEmails,
  getAssistantReminder,
  getLinkedDocuments,
  getWorkflowState,
  isAssistantReminderEvent,
  updateEventAttendee,
  updateEventDescription,
  updateEventWorkflow,
  getEventDateTime,
  parseServiceType,
  addLinkedDocument,
} from './lib/calendar.ts';
import { lookupContactByEmail, createContact, listContacts, searchContacts } from './lib/contacts.ts';
import { createDraft, sendMessage, sendScheduled } from './lib/gmail.ts';
import {
  analyzeAppointment,
  generateBusinessInsights,
  generateDocOutline,
  generateEmailDraft,
  generateEstimate,
  generateMorningBrief,
  generateSlidesOutline,
  generateTaskEmailDraft,
  refineEmailDraft,
} from './lib/gemini.ts';
import { loadEmailPreferences, saveEmailPreferences } from './lib/preferences.ts';
import { createGoogleDoc, createGoogleSlides, updateGoogleDoc, updateGoogleSlides } from './lib/docs.ts';
import { logActivity, loadCase, getIndustry } from './lib/caseStore.ts';
import Login from './components/Login.tsx';
import Header from './components/Header.tsx';
import Dashboard from './components/Dashboard.tsx';
import AppointmentDetail from './components/AppointmentDetail.tsx';
import DraftPreview from './components/DraftPreview.tsx';
import NewAppointmentModal from './components/NewAppointmentModal.tsx';
import EmailPreferencesModal from './components/EmailPreferencesModal.tsx';

type View = 'login' | 'dashboard' | 'detail';

export default function App() {
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const [view, setView] = useState<View>('login');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [assistantReminderEvents, setAssistantReminderEvents] = useState<CalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [creatingAppointment, setCreatingAppointment] = useState(false);
  const [showNewAppointmentModal, setShowNewAppointmentModal] = useState(false);
  const [showPreferencesModal, setShowPreferencesModal] = useState(false);

  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [clientContact, setClientContact] = useState<ClientContact | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const [creatingContact, setCreatingContact] = useState(false);
  const [updatingEmail, setUpdatingEmail] = useState(false);
  const [attendeeEmail, setAttendeeEmail] = useState('');
  const [contactSuggestions, setContactSuggestions] = useState<ClientContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  const [analysis, setAnalysis] = useState<AppointmentAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [insights, setInsights] = useState<BusinessInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [morningBrief, setMorningBrief] = useState<MorningBrief | null>(null);
  const [morningBriefLoading, setMorningBriefLoading] = useState(false);
  const [creatingReminder, setCreatingReminder] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [actionResults, setActionResults] = useState<Record<string, ActionResultStatus>>({});

  const [creatingDoc, setCreatingDoc] = useState(false);
  const [creatingSlides, setCreatingSlides] = useState(false);

  const [draftPreview, setDraftPreview] = useState<DraftPreviewData | null>(null);
  const [sendingDraft, setSendingDraft] = useState(false);
  const [refiningDraft, setRefiningDraft] = useState(false);
  const [emailPreferences, setEmailPreferences] = useState<EmailPreferences>(() => loadEmailPreferences());

  const [error, setError] = useState('');

  // Initialize Google auth on mount
  useEffect(() => {
    initAuth(
      (googleUser) => {
        setUser(googleUser);
        setAuthLoading(false);
        setAuthError('');
        setEmailPreferences((current) => ({
          ...current,
          businessName: current.businessName || 'Spherical Assistant',
          senderName: current.senderName || googleUser.name,
        }));
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
      setEvents(items.filter((event) => !isAssistantReminderEvent(event)));
      setAssistantReminderEvents(items.filter((event) => isAssistantReminderEvent(event)));
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

  useEffect(() => {
    if (view !== 'detail' || !user || !selectedEvent) return;
    const selectedEventId = selectedEvent.id;

    const syncSelectedEvent = async () => {
      try {
        const fresh = await fetchCalendarEvent(user.accessToken, selectedEventId);
        setSelectedEvent((current) => {
          if (!current || current.id !== fresh.id) return current;
          if (current.description === fresh.description) return current;
          return fresh;
        });
        setEvents((prev) => prev.map((event) => (event.id === fresh.id ? fresh : event)));
      } catch {
        // ignore transient sync errors
      }
    };

    const intervalId = window.setInterval(() => {
      void syncSelectedEvent();
    }, 30000);

    const handleFocus = () => {
      void syncSelectedEvent();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [view, user, selectedEvent?.id]);

  // Keep dashboard in sync with inbound intake events without manual refresh.
  useEffect(() => {
    if (view !== 'dashboard' || !user) return;

    const intervalId = window.setInterval(() => {
      void loadEvents();
    }, 30000);

    const handleFocus = () => {
      void loadEvents();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
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
    setInsights(null);
    setMorningBrief(null);
    setActionLoading({});
    setActionResults({});
    setDraftPreview(null);
    setContactSuggestions([]);
    setError('');
  }

  async function handleSelectEvent(event: CalendarEvent) {
    setSelectedEvent(event);
    setAnalysis(null);
    setInsights(null);
    setMorningBrief(null);
    setActionLoading({});
    setActionResults({});
    setClientContact(null);
    setDraftPreview(null);
    setContactSuggestions([]);
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

    if (user) {
      void loadContactSuggestions('');
    }
  }

  function handleBack() {
    setView('dashboard');
    setSelectedEvent(null);
    setClientContact(null);
    setAnalysis(null);
    setMorningBrief(null);
    setActionLoading({});
    setActionResults({});
    setDraftPreview(null);
    setContactSuggestions([]);
  }

  function handleOpenNewAppointmentModal() {
    setError('');
    setShowNewAppointmentModal(true);
  }

  function handleCloseNewAppointmentModal() {
    setShowNewAppointmentModal(false);
  }

  function handleOpenPreferencesModal() {
    setShowPreferencesModal(true);
  }

  function handleSavePreferences(preferences: EmailPreferences) {
    setEmailPreferences(preferences);
    saveEmailPreferences(preferences);
    setShowPreferencesModal(false);
  }

  async function handleAnalyze() {
    if (!selectedEvent || !user) return;
    setAnalyzing(true);
    try {
      const result = await analyzeAppointment(selectedEvent, clientContact, emailPreferences);
      setAnalysis(result);
      logActivity(selectedEvent.id, 'ai_analysis', 'AI analysis completed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleCreateContact(data: ContactFormData) {
    if (!user) return;
    setCreatingContact(true);
    setError('');
    try {
      const contact = await createContact(user.accessToken, data);
      setClientContact(contact);
      setAttendeeEmail(data.email);
      if (selectedEvent) {
        logActivity(selectedEvent.id, 'contact_created', `Contact created: ${data.name}`, data.email);
      }
      try {
        await syncAppointmentEmail(data.email, data.name);
      } catch (err) {
        setError(err instanceof Error ? `Contact saved, but failed to sync appointment email: ${err.message}` : 'Contact saved, but failed to sync appointment email');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create contact');
    } finally {
      setCreatingContact(false);
    }
  }

  function buildOutlineCaseContext(eventId: string) {
    const caseData = loadCase(eventId);
    return {
      industry: caseData.industry || getIndustry(),
      tasks: caseData.tasks.map((t) => ({ label: t.label, done: t.done })),
      documents: caseData.documents.map((d) => ({
        name: d.name,
        category: d.category,
        textContent: (d.textContent || '').slice(0, 4000),
      })),
    };
  }

  async function handleCreateDoc(goal?: string) {
    if (!user || !selectedEvent) return;
    setCreatingDoc(true);
    setError('');
    try {
      const base = parseServiceType(selectedEvent.summary);
      const fallbackTitle = goal ? `${base} - ${goal}` : `${base} - Brief`;
      const caseContext = buildOutlineCaseContext(selectedEvent.id);
      const feedback = goal
        ? `The user wants this document to help them accomplish the following task: "${goal}". Decide what TYPE of document (contract, notes, agenda, memo, proposal, letter, plan, etc.) best serves that goal and produce it. Ground it in the appointment notes.`
        : undefined;
      let doc;
      let finalTitle = fallbackTitle;
      try {
        const outline = await generateDocOutline(selectedEvent, clientContact, analysis, caseContext, emailPreferences, feedback);
        if (outline.title) {
          finalTitle = outline.title.slice(0, 180);
        }
        doc = await createGoogleDoc(user.accessToken, finalTitle, outline);
      } catch {
        doc = await createGoogleDoc(user.accessToken, fallbackTitle);
        finalTitle = fallbackTitle;
      }
      const updatedEvent = await addLinkedDocument(user.accessToken, selectedEvent, doc);
      setSelectedEvent(updatedEvent);
      setEvents((prev) => prev.map((e) => (e.id === updatedEvent.id ? updatedEvent : e)));
      const detail = goal ? `For task: ${goal}` : undefined;
      logActivity(selectedEvent.id, 'doc_created', `Google Doc created: ${finalTitle}`, detail ? `${detail}\n${doc.url}` : doc.url);
      window.open(doc.url, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Google Doc');
    } finally {
      setCreatingDoc(false);
    }
  }

  async function handleCreateSlides(goal?: string) {
    if (!user || !selectedEvent) return;
    setCreatingSlides(true);
    setError('');
    try {
      const base = parseServiceType(selectedEvent.summary);
      const fallbackTitle = goal ? `${base} - ${goal}` : `${base} - Presentation`;
      const caseContext = buildOutlineCaseContext(selectedEvent.id);
      const feedback = goal
        ? `The user wants this deck to help them accomplish the following task: "${goal}". Decide what TYPE of deck (pitch, update, agenda, teaching, recap, etc.) best serves that goal and produce it. Ground it in the appointment notes.`
        : undefined;
      let slides;
      let finalTitle = fallbackTitle;
      try {
        const outline = await generateSlidesOutline(selectedEvent, clientContact, analysis, caseContext, emailPreferences, feedback);
        if (outline.title) {
          finalTitle = outline.title.slice(0, 180);
        }
        slides = await createGoogleSlides(user.accessToken, finalTitle, outline);
      } catch {
        slides = await createGoogleSlides(user.accessToken, fallbackTitle);
        finalTitle = fallbackTitle;
      }
      const updatedEvent = await addLinkedDocument(user.accessToken, selectedEvent, slides);
      setSelectedEvent(updatedEvent);
      setEvents((prev) => prev.map((e) => (e.id === updatedEvent.id ? updatedEvent : e)));
      const detail = goal ? `For task: ${goal}` : undefined;
      logActivity(selectedEvent.id, 'slides_created', `Google Slides created: ${finalTitle}`, detail ? `${detail}\n${slides.url}` : slides.url);
      window.open(slides.url, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Google Slides');
    } finally {
      setCreatingSlides(false);
    }
  }

  async function handleTaskEmail(goal: string, taskId: string) {
    if (!selectedEvent || !user) return;
    setError('');
    try {
      const draft = await generateTaskEmailDraft(goal, selectedEvent, clientContact, emailPreferences);
      setDraftPreview({
        to: attendeeEmail,
        subject: draft.subject,
        body: draft.body,
        actionId: `task-${taskId}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to draft task email');
      throw err;
    }
  }

  async function handleReviseAsset(assetType: 'doc' | 'slides', feedback: string) {
    if (!user || !selectedEvent) {
      throw new Error('Missing authenticated user or selected appointment');
    }

    const linkedDocs = getLinkedDocuments(selectedEvent)
      .filter((doc) => doc.type === assetType)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const target = linkedDocs[0];

    if (!target) {
      throw new Error(assetType === 'doc' ? 'No Google Doc linked to this appointment.' : 'No Google Slides linked to this appointment.');
    }

    const caseContext = buildOutlineCaseContext(selectedEvent.id);

    if (assetType === 'slides') {
      const outline = await generateSlidesOutline(
        selectedEvent,
        clientContact,
        analysis,
        caseContext,
        emailPreferences,
        feedback,
      );
      await updateGoogleSlides(user.accessToken, target.id, outline);
      logActivity(selectedEvent.id, 'slides_updated', `Google Slides updated: ${target.title}`, target.url);
    } else {
      const outline = await generateDocOutline(
        selectedEvent,
        clientContact,
        analysis,
        caseContext,
        emailPreferences,
        feedback,
      );
      await updateGoogleDoc(user.accessToken, target.id, outline);
      logActivity(selectedEvent.id, 'doc_updated', `Google Doc updated: ${target.title}`, target.url);
    }

    return target;
  }

  async function syncAppointmentEmail(email: string, displayName?: string) {
    if (!user || !selectedEvent) {
      setAttendeeEmail(email);
      return;
    }

    try {
      const updatedEvent = await updateEventAttendee(user.accessToken, selectedEvent, email, displayName);
      setSelectedEvent(updatedEvent);
      setEvents((prev) => prev.map((event) => (event.id === updatedEvent.id ? updatedEvent : event)));
      setAttendeeEmail(email);
    } catch (err) {
      setAttendeeEmail(email);
      throw err;
    }
  }

  async function handleUpdateDescription(description: string) {
    if (!user || !selectedEvent) return;
    const updated = await updateEventDescription(user.accessToken, selectedEvent.id, description);
    setSelectedEvent(updated);
    setEvents((prev) => prev.map((event) => (event.id === updated.id ? updated : event)));
  }

  async function handleUpdateAttendeeEmail(email: string) {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !user) return;

    setUpdatingEmail(true);
    setError('');
    try {
      await syncAppointmentEmail(normalizedEmail, clientContact?.name);
      const contact = await lookupContactByEmail(user.accessToken, normalizedEmail);
      setClientContact(contact);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update appointment email');
    } finally {
      setUpdatingEmail(false);
    }
  }

  const loadContactSuggestions = useCallback(async (query: string) => {
    if (!user) return;

    setContactsLoading(true);
    try {
      const results = query.trim()
        ? await searchContacts(user.accessToken, query)
        : await listContacts(user.accessToken);
      setContactSuggestions(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contacts');
    } finally {
      setContactsLoading(false);
    }
  }, [user]);

  async function handleSelectContact(contact: ClientContact) {
    setClientContact(contact);
    await handleUpdateAttendeeEmail(contact.email);
  }

  // Generate the email via AI, then show preview
  async function handleAction(actionId: string) {
    if (!selectedEvent || !user) return;

    setActionLoading((prev) => ({ ...prev, [actionId]: true }));
    setError('');

    try {
      const actionType = actionId as 'confirm' | 'reminder' | 'followup' | 'estimate';
      let subject: string;
      let body: string;

      if (actionType === 'estimate') {
        const serviceType = parseServiceType(selectedEvent.summary);
        const estimate = await generateEstimate(serviceType, selectedEvent.description || '', clientContact);
        subject = `Service Estimate: ${serviceType}`;
        body = estimate.estimateText;
      } else {
        const draftType = actionType === 'confirm' ? 'confirmation' as const : actionType as 'reminder' | 'followup';
        const draft = await generateEmailDraft(draftType, selectedEvent, clientContact, emailPreferences);
        subject = draft.subject;
        body = draft.body;
      }

      // Show preview instead of silently creating draft
      setDraftPreview({
        to: attendeeEmail,
        subject,
        body,
        actionId,
      });

    } catch (err) {
      setActionResults((prev) => ({ ...prev, [actionId]: 'error' }));
      setError(err instanceof Error ? err.message : 'Failed to generate email');
    } finally {
      setActionLoading((prev) => ({ ...prev, [actionId]: false }));
    }
  }

  async function updateWorkflowAfterAction(actionId: string) {
    if (!selectedEvent || !user) return;

    const currentState = getWorkflowState(selectedEvent);
    const newState: WorkflowState = { ...currentState };

    if (actionId === 'confirm') {
      newState.status = 'confirmed';
      newState.confirmedAt = new Date().toISOString();
    } else if (actionId === 'reminder') {
      newState.status = 'reminded';
      newState.remindedAt = new Date().toISOString();
    } else if (actionId === 'followup') {
      newState.status = 'followed-up';
      newState.followedUpAt = new Date().toISOString();
    } else if (actionId === 'estimate') {
      newState.estimateSent = true;
    }

    try {
      await updateEventWorkflow(user.accessToken, selectedEvent.id, newState);
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
    } catch {
      // Non-critical -- workflow update failed but email was sent/saved
    }
  }

  async function handleSaveDraft(draft: DraftPreviewData) {
    if (!user) return;
    setSendingDraft(true);
    setError('');
    try {
      await createDraft(user.accessToken, draft.to, draft.subject, draft.body);
      setActionResults((prev) => ({ ...prev, [draft.actionId]: 'drafted' }));
      await updateWorkflowAfterAction(draft.actionId);
      if (selectedEvent) {
        logActivity(selectedEvent.id, 'email_drafted', `Email drafted: ${draft.subject}`, `To: ${draft.to}`);
      }
      setDraftPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setSendingDraft(false);
    }
  }

  async function handleSendNow(draft: DraftPreviewData) {
    if (!user) return;
    setSendingDraft(true);
    setError('');
    try {
      await sendMessage(user.accessToken, draft.to, draft.subject, draft.body);
      setActionResults((prev) => ({ ...prev, [draft.actionId]: 'sent' }));
      await updateWorkflowAfterAction(draft.actionId);
      if (selectedEvent) {
        logActivity(selectedEvent.id, 'email_sent', `Email sent: ${draft.subject}`, `To: ${draft.to}`);
      }
      setDraftPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email');
    } finally {
      setSendingDraft(false);
    }
  }

  async function handleSchedule(draft: DraftPreviewData, sendAt: Date) {
    if (!user) return;
    setSendingDraft(true);
    setError('');
    try {
      await sendScheduled(user.accessToken, draft.to, draft.subject, draft.body, sendAt);
      setActionResults((prev) => ({ ...prev, [draft.actionId]: 'scheduled' }));
      await updateWorkflowAfterAction(draft.actionId);
      if (selectedEvent) {
        logActivity(selectedEvent.id, 'email_scheduled', `Email scheduled: ${draft.subject}`, `To: ${draft.to}, Send at: ${sendAt.toLocaleString()}`);
      }
      setDraftPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule email');
    } finally {
      setSendingDraft(false);
    }
  }

  async function handleRefineDraft(draft: DraftPreviewData, instruction: string) {
    if (!selectedEvent) return;

    setRefiningDraft(true);
    setError('');
    try {
      const refined = await refineEmailDraft(instruction, draft, selectedEvent, clientContact, emailPreferences);
      setDraftPreview({
        ...draft,
        subject: refined.subject,
        body: refined.body,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refine draft');
    } finally {
      setRefiningDraft(false);
    }
  }

  async function handleCreateAppointment(form: AppointmentFormData) {
    if (!user) return;

    setCreatingAppointment(true);
    setError('');
    try {
      const createdEvent = await createCalendarEvent(user.accessToken, form);
      setEvents((prev) =>
        [...prev, createdEvent].sort((a, b) => getEventDateTime(a).getTime() - getEventDateTime(b).getTime())
      );
      setShowNewAppointmentModal(false);
      await handleSelectEvent(createdEvent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create appointment');
    } finally {
      setCreatingAppointment(false);
    }
  }

  async function handleGenerateInsights() {
    if (!user || events.length === 0) return;

    setInsightsLoading(true);
    setError('');
    try {
      const result = await generateBusinessInsights(events, emailPreferences);
      setInsights(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate business insights');
    } finally {
      setInsightsLoading(false);
    }
  }

  async function handleGenerateMorningBrief() {
    if (!user) return;

    const todaysEvents = getEventsForDate(events, new Date());
    setMorningBriefLoading(true);
    setError('');
    try {
      const result = await generateMorningBrief(todaysEvents, emailPreferences);
      setMorningBrief(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate morning brief');
    } finally {
      setMorningBriefLoading(false);
    }
  }

  async function handleCreateActionReminder(action: AssistantActionItem) {
    if (!user) return;

    const existingReminder = assistantReminderEvents.some((event) => {
      const reminder = getAssistantReminder(event);
      return reminder?.type === mapActionTypeToReminderType(action.type) && reminder?.eventId === action.eventId;
    });

    if (existingReminder) {
      setError('A reminder already exists for that action.');
      return;
    }

    setCreatingReminder(action.id);
    setError('');
    try {
      const reminder = buildReminderFromAction(action);
      const reminderTime = getReminderTimeForAction(action);
      const created = await createAssistantReminderEvent(user.accessToken, reminder, reminderTime);
      setAssistantReminderEvents((prev) => [...prev, created]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create reminder event');
    } finally {
      setCreatingReminder(null);
    }
  }

  async function handleCreateMorningBriefReminder() {
    if (!user || !morningBrief) return;

    const existingReminder = assistantReminderEvents.some((event) => {
      const reminder = getAssistantReminder(event);
      return reminder?.type === 'morning-brief';
    });

    if (existingReminder) {
      setError('A morning brief reminder already exists.');
      return;
    }

    setCreatingReminder('morning-brief');
    setError('');
    try {
      const reminderTime = getNextMorningBriefTime();
      const created = await createAssistantReminderEvent(
        user.accessToken,
        {
          type: 'morning-brief',
          title: morningBrief.headline,
          detail: [
            morningBrief.summary,
            '',
            'Priorities:',
            ...morningBrief.priorities.map((item) => `- ${item}`),
            '',
            'Risks:',
            ...morningBrief.risks.map((item) => `- ${item}`),
            '',
            `Suggested focus: ${morningBrief.suggestedFocus}`,
          ].join('\n'),
        },
        reminderTime
      );
      setAssistantReminderEvents((prev) => [...prev, created]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create morning brief reminder');
    } finally {
      setCreatingReminder(null);
    }
  }

  const actionItems = buildAssistantActionItems(events, emailPreferences);

  return (
    <div className="app">
      {view === 'login' && (
        <Login onSignIn={handleSignIn} loading={authLoading} error={authError} />
      )}

      {view === 'dashboard' && user && (
        <>
          <Header user={user} onLogout={handleLogout} onOpenSettings={handleOpenPreferencesModal} />
          <Dashboard
            events={events}
            loading={eventsLoading}
            onRefresh={loadEvents}
            onSelectEvent={handleSelectEvent}
            onCreateAppointment={handleOpenNewAppointmentModal}
            insights={insights}
            insightsLoading={insightsLoading}
            onGenerateInsights={handleGenerateInsights}
            morningBrief={morningBrief}
            morningBriefLoading={morningBriefLoading}
            onGenerateMorningBrief={handleGenerateMorningBrief}
            onCreateMorningBriefReminder={handleCreateMorningBriefReminder}
            actionItems={actionItems}
            onCreateActionReminder={handleCreateActionReminder}
            creatingReminderId={creatingReminder}
            firmName={emailPreferences.businessName || 'Your Firm'}
          />
        </>
      )}

      {view === 'detail' && user && selectedEvent && (
        <>
          <Header user={user} onLogout={handleLogout} onOpenSettings={handleOpenPreferencesModal} onBack={handleBack} showBack />
          <AppointmentDetail
            event={selectedEvent}
            contact={clientContact}
            contactLoading={contactLoading}
            attendeeEmail={attendeeEmail}
            contactSuggestions={contactSuggestions}
            contactsLoading={contactsLoading}
            onSearchContacts={loadContactSuggestions}
            onSelectContact={handleSelectContact}
            onUpdateEmail={handleUpdateAttendeeEmail}
            updatingEmail={updatingEmail}
            onUpdateDescription={handleUpdateDescription}
            onCreateContact={handleCreateContact}
            creatingContact={creatingContact}
            onCreateDoc={handleCreateDoc}
            onCreateSlides={handleCreateSlides}
            onDraftTaskEmail={handleTaskEmail}
            creatingDoc={creatingDoc}
            creatingSlides={creatingSlides}
            analysis={analysis}
            analyzing={analyzing}
            onAnalyze={handleAnalyze}
            actionLoading={actionLoading}
            actionResults={actionResults}
            onAction={handleAction}
            onReviseAsset={handleReviseAsset}
          />
        </>
      )}

      {draftPreview && (
        <DraftPreview
          draft={draftPreview}
          onSaveDraft={handleSaveDraft}
          onSendNow={handleSendNow}
          onSchedule={handleSchedule}
          onRefine={handleRefineDraft}
          onClose={() => setDraftPreview(null)}
          sending={sendingDraft}
          refining={refiningDraft}
        />
      )}

      {showNewAppointmentModal && (
        <NewAppointmentModal
          suggestions={contactSuggestions}
          contactsLoading={contactsLoading}
          saving={creatingAppointment}
          onSearchContacts={loadContactSuggestions}
          onCreate={handleCreateAppointment}
          onClose={handleCloseNewAppointmentModal}
        />
      )}

      {showPreferencesModal && (
        <EmailPreferencesModal
          initialPreferences={emailPreferences}
          onSave={handleSavePreferences}
          onClose={() => setShowPreferencesModal(false)}
        />
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

function buildAssistantActionItems(events: CalendarEvent[], preferences: EmailPreferences): AssistantActionItem[] {
  const now = new Date();
  const items: AssistantActionItem[] = [];

  for (const event of events) {
    const startParsed = getEventDateTime(event);
    const start = isNaN(startParsed.getTime()) ? null : startParsed;
    const startIso = start ? start.toISOString() : '';
    const endIso = event.end.dateTime || event.end.date || '';
    const end = endIso ? new Date(endIso) : null;
    const workflow = getWorkflowState(event);
    const attendeeEmails = getAttendeeEmails(event);
    const serviceType = parseServiceType(event.summary);

    if (start && start.getTime() - now.getTime() <= 24 * 60 * 60 * 1000 && start > now && workflow.status === 'new') {
      items.push({
        id: `${event.id}-confirm`,
        eventId: event.id,
        eventTitle: event.summary,
        eventStart: start.toISOString(),
        type: 'confirmation',
        title: `Confirmation needed for ${serviceType}`,
        detail: 'This appointment is coming up soon and has not been marked confirmed yet.',
        priority: 'high',
      });
    }

    if (attendeeEmails.length === 0) {
      items.push({
        id: `${event.id}-email`,
        eventId: event.id,
        eventTitle: event.summary,
        eventStart: startIso,
        type: 'missing-info',
        title: `Missing client email for ${serviceType}`,
        detail: 'Add an attendee email so confirmations, reminders, and follow-ups can be drafted.',
        priority: 'high',
      });
    }

    if (!event.location?.trim()) {
      items.push({
        id: `${event.id}-location`,
        eventId: event.id,
        eventTitle: event.summary,
        eventStart: startIso,
        type: 'missing-info',
        title: `Missing location for ${serviceType}`,
        detail: 'Add the service address or meeting location so the schedule stays reliable.',
        priority: 'medium',
      });
    }

    if (
      start &&
      end &&
      start <= now &&
      end <= now &&
      now.getTime() - end.getTime() <= 12 * 60 * 60 * 1000 &&
      workflow.status !== 'followed-up'
    ) {
      items.push({
        id: `${event.id}-followup`,
        eventId: event.id,
        eventTitle: event.summary,
        eventStart: end.toISOString(),
        type: preferences.reviewLink ? 'review' : 'followup',
        title: preferences.reviewLink ? `Review request ready for ${serviceType}` : `Post-appointment follow-up for ${serviceType}`,
        detail: preferences.reviewLink
          ? 'The appointment ended recently. Queue a thank-you and review request while the experience is still fresh.'
          : 'The appointment ended recently. A thank-you or follow-up is likely due.',
        priority: 'medium',
      });
    }

    if (/estimate/i.test(event.summary) && !workflow.estimateSent) {
      items.push({
        id: `${event.id}-estimate`,
        eventId: event.id,
        eventTitle: event.summary,
        eventStart: startIso,
        type: 'estimate',
        title: `Estimate workflow for ${serviceType}`,
        detail: 'This looks like an estimate-related appointment. Make sure a follow-up estimate gets drafted and tracked.',
        priority: 'medium',
      });
    }
  }

  if (preferences.repeatBusinessGoals.trim()) {
    items.push({
      id: 'marketing-reactivation',
      eventId: 'marketing-reactivation',
      eventTitle: 'Retention campaign',
      eventStart: now.toISOString(),
      type: 'marketing',
      title: 'Retention campaign opportunity',
      detail: `Based on the stated repeat-business goals, prepare a nurture or reactivation campaign: ${preferences.repeatBusinessGoals}`,
      priority: 'low',
    });
  }

  const deduped = new Map(items.map((item) => [item.id, item]));
  return Array.from(deduped.values()).sort((a, b) => priorityScore(b.priority) - priorityScore(a.priority)).slice(0, 8);
}

function getEventsForDate(events: CalendarEvent[], date: Date): CalendarEvent[] {
  const target = date.toDateString();
  return events.filter((event) => {
    const start = getEventDateTime(event);
    return !isNaN(start.getTime()) && start.toDateString() === target;
  });
}

function buildReminderFromAction(action: AssistantActionItem): AssistantReminderData {
  return {
    type: mapActionTypeToReminderType(action.type),
    eventId: action.eventId,
    title: action.title,
    detail: `${action.detail}\n\nRelated appointment: ${action.eventTitle}`,
  };
}

function mapActionTypeToReminderType(actionType: AssistantActionItem['type']): AssistantReminderData['type'] {
  if (actionType === 'confirmation' || actionType === 'estimate' || actionType === 'marketing') {
    return 'approval';
  }
  if (actionType === 'missing-info') return 'missing-info';
  if (actionType === 'review') return 'review-request';
  return 'followup';
}

function getReminderTimeForAction(action: AssistantActionItem): Date {
  const now = new Date();
  const reference = action.eventStart ? new Date(action.eventStart) : now;

  if (action.type === 'confirmation') {
    const reminder = new Date(reference.getTime() - 4 * 60 * 60 * 1000);
    return reminder > now ? reminder : new Date(now.getTime() + 15 * 60 * 1000);
  }

  if (action.type === 'missing-info') {
    return new Date(now.getTime() + 30 * 60 * 1000);
  }

  if (action.type === 'review' || action.type === 'followup') {
    return new Date(now.getTime() + 60 * 60 * 1000);
  }

  return new Date(now.getTime() + 2 * 60 * 60 * 1000);
}

function getNextMorningBriefTime(): Date {
  const next = new Date();
  next.setHours(7, 0, 0, 0);
  if (next <= new Date()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function priorityScore(priority: AssistantActionItem['priority']): number {
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}
