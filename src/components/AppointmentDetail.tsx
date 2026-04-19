import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  CalendarEvent,
  ClientContact,
  AppointmentAnalysis,
  WorkflowState,
  ActionResultStatus,
  CaseData,
  CaseDocument,
  DocCategory,
  IndustryType,
  ActivityLogEntry,
  BillingInterval,
} from '../types.ts';
import { formatEventTime, parseServiceType, getWorkflowState, getClientNameFromSummary, getLinkedDocuments, getEventDateTime, getCaseNumberFromEvent, getCourtRecords } from '../lib/calendar.ts';
import CourtRecordsCard from './CourtRecordsCard.tsx';
import {
  ensureMatterFolder,
  uploadFileToDrive,
  buildMatterFolderName,
  findMatterFolder,
  listMatterFolderFiles,
  mapDriveFilesToCaseDocuments,
  trashDriveFile,
} from '../lib/docs.ts';
import {
  syncMatterRow,
  syncDocumentRow,
  removeDocumentRow,
  syncInBackground,
} from '../lib/caseSheet.ts';
import {
  loadCase,
  addTask,
  toggleTask,
  removeTask,
  acceptSuggestion,
  acceptAllSuggestions,
  dismissSuggestion,
  addSuggestions,
  addDocument,
  removeDocument,
  addChatMessage,
  clearChat,
  logActivity,
  getIndustry,
  setPaymentPlan,
  updatePaymentPlan,
  clearPaymentPlan,
  setDriveFolder,
} from '../lib/caseStore.ts';
import {
  createMockPlan,
  simulateSuccessfulCharge,
  simulateFailedCharge,
  pausePlan,
  resumePlan,
  cancelPlan,
  formatAmount,
  intervalAdverb,
  statusLabel,
  statusCls,
  FAILURE_PAUSE_THRESHOLD,
} from '../lib/billing.ts';
import {
  isStripeLiveMode,
  createCheckoutSession,
  syncSubscription,
  performAction,
  mergeStripeSyncIntoPlan,
} from '../lib/stripeClient.ts';
import { parseDocument } from '../lib/parseDocument.ts';
import { generateCaseSummaryPdf } from '../lib/generatePdf.ts';
import { sendCaseChat, categorizeDocument, summarizeDocument, suggestTasks } from '../lib/gemini.ts';
import ClientPanel from './ClientPanel.tsx';
import CaseTasks from './CaseTasks.tsx';
import type { TaskActionType } from './CaseTasks.tsx';
import CaseDocuments from './CaseDocuments.tsx';
import CaseChat from './CaseChat.tsx';
import ActivityLog from './ActivityLog.tsx';
import CaseBilling from './CaseBilling.tsx';

type CaseTab = 'details' | 'tasks' | 'docs' | 'chat' | 'billing' | 'activity';

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
  onUpdateDescription: (description: string) => Promise<void>;
  onCreateContact: (data: { name: string; email: string; phone: string; address: string }) => void;
  creatingContact: boolean;
  onCreateDoc: (goal?: string) => Promise<void> | void;
  onCreateSlides: (goal?: string) => Promise<void> | void;
  onDraftTaskEmail: (goal: string, taskId: string) => Promise<void>;
  onDraftBillingEmail: (input: {
    to: string;
    clientName: string;
    amountCents: number;
    currency: string;
    interval: BillingInterval;
    checkoutUrl: string;
    serviceType: string;
    upfrontRetainerCents?: number;
  }) => Promise<void>;
  creatingDoc: boolean;
  creatingSlides: boolean;
  analysis: AppointmentAnalysis | null;
  analyzing: boolean;
  onAnalyze: () => void;
  actionLoading: Record<string, boolean>;
  actionResults: Record<string, ActionResultStatus>;
  onAction: (actionType: string) => void;
  onReviseAsset: (assetType: 'doc' | 'slides', feedback: string) => Promise<{ type: 'doc' | 'slides'; url: string; title: string }>;
  accessToken: string;
}

const ACTION_ICONS: Record<string, string> = {
  confirm: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0 1 12 2.944a11.955 11.955 0 0 1-8.618 3.04A12.02 12.02 0 0 0 3 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  reminder: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0 1 18 14.158V11a6.002 6.002 0 0 0-4-5.659V5a2 2 0 1 0-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9',
  followup: 'M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z',
  estimate: 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z',
  contact: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7z',
  custom: 'M13 10V3L4 14h7v7l9-11h-7z',
};

const TAB_CONFIG: { key: CaseTab; label: string; icon: string }[] = [
  { key: 'details', label: 'Details', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
  { key: 'tasks', label: 'Tasks', icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9l2 2 4-4' },
  { key: 'docs', label: 'Docs', icon: 'M7 21h10a2 2 0 0 0 2-2V9.414a1 1 0 0 0-.293-.707l-5.414-5.414A1 1 0 0 0 12.586 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z' },
  { key: 'chat', label: 'AI Chat', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
  { key: 'billing', label: 'Billing', icon: 'M3 10h18M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z' },
  { key: 'activity', label: 'Activity', icon: 'M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
];

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
  onUpdateDescription,
  onCreateContact,
  creatingContact,
  onCreateDoc,
  onCreateSlides,
  onDraftTaskEmail,
  onDraftBillingEmail,
  creatingDoc,
  creatingSlides,
  analysis,
  analyzing,
  onAnalyze,
  actionLoading,
  actionResults,
  onAction,
  onReviseAsset,
  accessToken,
}: AppointmentDetailProps) {
  const [activeTab, setActiveTab] = useState<CaseTab>('details');
  const [manualEmail, setManualEmail] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState(event.description || '');
  const [savingDescription, setSavingDescription] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [taskActionLoading, setTaskActionLoading] = useState<Record<string, TaskActionType | null>>({});
  const [caseData, setCaseData] = useState<CaseData>(() => loadCase(event.id));
  const [uploading, setUploading] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [chatPrefill, setChatPrefill] = useState('');
  const [chatRevisionTarget, setChatRevisionTarget] = useState<'doc' | 'slides' | null>(null);
  const [billingCreating, setBillingCreating] = useState(false);
  const [billingSyncing, setBillingSyncing] = useState(false);
  const [driveDocuments, setDriveDocuments] = useState<CaseDocument[] | null>(null);
  const liveBilling = isStripeLiveMode();

  const workflow = getWorkflowState(event);
  const serviceType = parseServiceType(event.summary);
  const suggestedClientName = getClientNameFromSummary(event.summary);
  const clientName = contact?.name || suggestedClientName || 'Client';
  const caseNumber = getCaseNumberFromEvent(event);
  const matterFolderCode = !caseNumber
    ? (event.extendedProperties?.private?.sphericalMatterType || serviceType || 'gen')
    : undefined;
  const time = formatEventTime(event);
  const eventDate = getEventDateTime(event);
  const courtRecords = getCourtRecords(event);
  const industry: IndustryType = caseData.industry || getIndustry();

  const refreshCase = useCallback(() => {
    setCaseData(loadCase(event.id));
  }, [event.id]);

  useEffect(() => {
    setCaseData(loadCase(event.id));
    refreshCase();
  }, [event.id, refreshCase]);

  useEffect(() => {
    setDescriptionDraft(event.description || '');
    setEditingDescription(false);
  }, [event.id, event.description]);

  const loadDriveDocuments = useCallback(async () => {
    if (!accessToken) return;
    try {
      const folder = await findMatterFolder(accessToken, clientName, caseNumber, matterFolderCode);
      if (!folder) {
        setDriveDocuments([]);
        return;
      }
      setDriveFolder(event.id, folder.id, folder.url);
      const files = await listMatterFolderFiles(accessToken, folder.id);
      setDriveDocuments(mapDriveFilesToCaseDocuments(files));
      refreshCase();
    } catch (err) {
      console.warn('Failed to load matter docs from Drive', err);
      setDriveDocuments(null);
    }
  }, [accessToken, caseNumber, clientName, event.id, matterFolderCode, refreshCase]);

  useEffect(() => {
    setDriveDocuments(null);
    void loadDriveDocuments();
  }, [loadDriveDocuments, event.id]);

  const visibleDocuments = useMemo(() => {
    if (driveDocuments === null) return caseData.documents;

    const localByDriveId = new Map<string, CaseDocument>();
    for (const doc of caseData.documents) {
      if (doc.driveFileId) localByDriveId.set(doc.driveFileId, doc);
    }

    const merged: CaseDocument[] = driveDocuments.map((remote) => {
      const local = remote.driveFileId ? localByDriveId.get(remote.driveFileId) : undefined;
      return {
        ...remote,
        id: local?.id || remote.id,
        category: local?.category || remote.category,
        aiSummary: local?.aiSummary || remote.aiSummary,
        textContent: local?.textContent || '',
      };
    });

    const remoteIds = new Set(driveDocuments.map((d) => d.driveFileId || d.id));
    const localOnly = caseData.documents.filter((doc) => !doc.driveFileId || !remoteIds.has(doc.driveFileId));
    return [...merged, ...localOnly].sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );
  }, [driveDocuments, caseData.documents]);

  async function handleSaveDescription() {
    setSavingDescription(true);
    try {
      await onUpdateDescription(descriptionDraft.trim());
      setEditingDescription(false);
    } catch (err) {
      console.error('Failed to update description', err);
    } finally {
      setSavingDescription(false);
    }
  }

  useEffect(() => {
    refreshCase();
  }, [event.extendedProperties?.private?.sphericalLinkedDocs, refreshCase]);

  // Sync matter row to Case Database sheet whenever caseData or event changes.
  // Runs in background so UI mutations stay instant.
  useEffect(() => {
    if (!accessToken) return;
    syncInBackground(() => syncMatterRow(accessToken, event), `matter ${event.id}`);
  }, [accessToken, event, caseData.updatedAt]);

  // --- Task handlers ---
  function handleToggleTask(taskId: string) {
    toggleTask(event.id, taskId);
    refreshCase();
  }

  function handleAddTask(label: string) {
    addTask(event.id, label);
    refreshCase();
  }

  function handleRemoveTask(taskId: string) {
    removeTask(event.id, taskId);
    refreshCase();
  }

  async function handleSuggestTasks() {
    setSuggesting(true);
    try {
      const existing = caseData.tasks.map((t) => t.label);
      const suggestions = await suggestTasks(serviceType, event.description || '', industry, existing);
      addSuggestions(event.id, suggestions);
      refreshCase();
    } catch {
      // silently fail
    } finally {
      setSuggesting(false);
    }
  }

  function handleAcceptSuggestion(label: string) {
    acceptSuggestion(event.id, label);
    refreshCase();
  }

  function handleDismissSuggestion(label: string) {
    dismissSuggestion(event.id, label);
    refreshCase();
  }

  function handleAcceptAllSuggestions() {
    acceptAllSuggestions(event.id);
    refreshCase();
  }

  async function handleTaskAction(task: { id: string; label: string }, action: TaskActionType) {
    setTaskActionLoading((prev) => ({ ...prev, [task.id]: action }));
    try {
      if (action === 'doc') {
        await Promise.resolve(onCreateDoc(task.label));
        logActivity(event.id, 'ai_chat', `Started Google Doc for task: "${task.label}"`);
      } else if (action === 'slides') {
        await Promise.resolve(onCreateSlides(task.label));
        logActivity(event.id, 'ai_chat', `Started Google Slides for task: "${task.label}"`);
      } else if (action === 'email') {
        await onDraftTaskEmail(task.label, task.id);
        logActivity(event.id, 'ai_chat', `Drafted email for task: "${task.label}"`);
      } else if (action === 'chat') {
        const prompt = `Help me complete this task: "${task.label}". Suggest concrete next steps, and if it involves text I need to write, produce the full text for me to review.`;
        setChatPrefill(prompt);
        setChatRevisionTarget(null);
        setActiveTab('chat');
      }
      refreshCase();
    } finally {
      setTaskActionLoading((prev) => ({ ...prev, [task.id]: null }));
    }
  }

  // --- Document handlers ---
  async function handleUploadDocument(file: File) {
    setUploading(true);
    try {
      const textContent = await parseDocument(file);
      const [categoryRaw, aiSummary] = await Promise.all([
        categorizeDocument(file.name, textContent, industry),
        summarizeDocument(file.name, textContent, industry).catch(() => ''),
      ]);
      const category = categoryRaw as DocCategory;

      let driveFileId: string | undefined;
      let driveUrl: string | undefined;
      try {
        const folder = await ensureMatterFolder(accessToken, clientName, caseNumber, matterFolderCode);
        setDriveFolder(event.id, folder.id, folder.url);
        const uploaded = await uploadFileToDrive(accessToken, file, folder.id, {
          category,
          uploadedAt: new Date().toISOString(),
        });
        driveFileId = uploaded.id;
        driveUrl = uploaded.url;
      } catch (driveErr) {
        console.error('Drive upload failed — keeping local copy only:', driveErr);
      }

      const doc = addDocument(event.id, file.name, category, textContent, file.size, {
        driveFileId,
        driveUrl,
        aiSummary,
      });
      refreshCase();
      syncInBackground(() => syncDocumentRow(accessToken, event, doc), `doc ${doc.id}`);
      void loadDriveDocuments();
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  }

  function handleRemoveDocument(docId: string) {
    const localDoc = caseData.documents.find((d) => d.id === docId);
    const visibleDoc = visibleDocuments.find((d) => d.id === docId);
    const driveFileId = localDoc?.driveFileId || visibleDoc?.driveFileId;
    if (driveFileId) {
      syncInBackground(async () => {
        await trashDriveFile(accessToken, driveFileId);
        await loadDriveDocuments();
      }, `doc-drive-remove ${driveFileId}`);
    }
    if (localDoc) {
      removeDocument(event.id, docId);
      refreshCase();
      syncInBackground(() => removeDocumentRow(accessToken, docId), `doc-remove ${docId}`);
    }
  }

  // --- Chat handlers ---
  async function handleSendChat(message: string) {
    addChatMessage(event.id, 'user', message);
    refreshCase();
    setChatSending(true);
    try {
      if (chatRevisionTarget) {
        const updated = await onReviseAsset(chatRevisionTarget, message);
        const reply = `Done. I updated the linked Google ${chatRevisionTarget === 'doc' ? 'Doc' : 'Slides'}: ${updated.title}\n${updated.url}`;
        addChatMessage(event.id, 'assistant', reply);
        setChatRevisionTarget(null);
        setChatPrefill('');
        refreshCase();
        return;
      }

      const pendingTasks = caseData.tasks.filter((t) => !t.done).length;
      const reply = await sendCaseChat(
        message,
        caseData.chatHistory,
        caseData.documents,
        { title: serviceType, clientName, pendingTasks },
        industry,
      );
      addChatMessage(event.id, 'assistant', reply);
      logActivity(event.id, 'ai_chat', `AI chat: "${message.slice(0, 50)}${message.length > 50 ? '...' : ''}"`);
      refreshCase();
    } catch (err) {
      addChatMessage(event.id, 'assistant', 'Sorry, I had trouble processing that. Please try again.');
      refreshCase();
      console.error('Case chat error:', err);
    } finally {
      setChatSending(false);
    }
  }

  function handleClearChat() {
    clearChat(event.id);
    setChatRevisionTarget(null);
    setChatPrefill('');
    refreshCase();
  }

  function handleChatAboutActivity(entry: ActivityLogEntry) {
    let prompt = '';

    if (entry.action === 'slides_created') {
      prompt = 'Tell me exactly what to change in the presentation (tone, sections, structure, bullets, length). I will update the actual Google Slides file directly.';
      setChatRevisionTarget('slides');
    } else if (entry.action === 'doc_created') {
      prompt = 'Tell me exactly what to change in the document (sections, headings, bullet detail, tone). I will update the actual Google Doc directly.';
      setChatRevisionTarget('doc');
    } else if (entry.action === 'slides_updated') {
      prompt = 'Share the next round of presentation changes and I will apply them directly to the same Google Slides file.';
      setChatRevisionTarget('slides');
    } else if (entry.action === 'doc_updated') {
      prompt = 'Share the next round of document changes and I will apply them directly to the same Google Doc file.';
      setChatRevisionTarget('doc');
    }

    if (!prompt) return;
    setChatPrefill(prompt);
    setActiveTab('chat');
  }

  // --- Billing ---
  async function handleCreatePlan(input: {
    clientName: string;
    clientEmail: string;
    amountCents: number;
    interval: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
    startDate: string;
    upfrontRetainerCents?: number;
    notes?: string;
  }) {
    if (liveBilling) {
      setBillingCreating(true);
      try {
        const session = await createCheckoutSession({
          clientName: input.clientName,
          clientEmail: input.clientEmail,
          amountCents: input.amountCents,
          interval: input.interval,
          upfrontRetainerCents: input.upfrontRetainerCents,
          eventId: event.id,
          notes: input.notes,
          successUrl: `${window.location.origin}${window.location.pathname}?billing=success`,
          cancelUrl: `${window.location.origin}${window.location.pathname}?billing=canceled`,
        });

        const base = createMockPlan(input);
        const livePlan = {
          ...base,
          liveMode: true,
          stripeCustomerId: session.customerId,
          stripeSessionId: session.sessionId,
          stripeCheckoutUrl: session.checkoutUrl,
          stripePriceId: session.priceId,
          stripeSubscriptionId: undefined,
          invoices: [],
          upfrontRetainerCents: input.upfrontRetainerCents,
        };
        setPaymentPlan(event.id, livePlan);
        logActivity(
          event.id,
          'billing_plan_created',
          `Payment plan created for ${input.clientName}`,
          `Live Stripe Checkout: ${formatAmount(input.amountCents)} ${intervalAdverb(input.interval).toLowerCase()}`,
        );
        refreshCase();
        window.open(session.checkoutUrl, '_blank', 'noopener,noreferrer');
      } catch (err) {
        console.error('Stripe checkout failed:', err);
        alert(`Stripe checkout failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      } finally {
        setBillingCreating(false);
      }
      return;
    }

    const plan = createMockPlan(input);
    setPaymentPlan(event.id, plan);
    const detail = `${formatAmount(plan.amountCents, plan.currency)} ${intervalAdverb(plan.interval).toLowerCase()}${
      plan.upfrontRetainerCents ? ` + ${formatAmount(plan.upfrontRetainerCents, plan.currency)} retainer` : ''
    }`;
    logActivity(event.id, 'billing_plan_created', `Payment plan created for ${plan.clientName}`, detail);
    refreshCase();
  }

  async function handleSyncPlan() {
    const current = caseData.paymentPlan;
    if (!current || !liveBilling) return;
    setBillingSyncing(true);
    try {
      const sync = await syncSubscription({
        sessionId: current.stripeSessionId,
        subscriptionId: current.stripeSubscriptionId,
      });
      const merged = mergeStripeSyncIntoPlan(current, sync);
      setPaymentPlan(event.id, merged);
      const seenInvoiceIds = new Set(current.invoices.map((inv) => inv.id));
      const newInvoices = merged.invoices.filter((inv) => !seenInvoiceIds.has(inv.id));
      for (const invoice of newInvoices) {
        if (invoice.status === 'paid') {
          logActivity(
            event.id,
            'billing_payment_succeeded',
            `Payment received: ${formatAmount(invoice.amountCents, invoice.currency)}`,
            invoice.description,
          );
        } else if (invoice.status === 'failed') {
          logActivity(
            event.id,
            'billing_payment_failed',
            `Payment failed`,
            invoice.description,
          );
        }
      }
      if (current.retainerStatus !== 'paid' && merged.retainerStatus === 'paid') {
        logActivity(
          event.id,
          'billing_payment_succeeded',
          'Upfront retainer paid',
          merged.retainerRequiredCents
            ? formatAmount(merged.retainerRequiredCents, merged.currency)
            : undefined,
        );
      }
      logActivity(event.id, 'billing_plan_updated', 'Synced subscription from Stripe', `Status: ${merged.status}`);
      refreshCase();
    } catch (err) {
      console.error('Stripe sync failed:', err);
      alert(`Stripe sync failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBillingSyncing(false);
    }
  }

  async function handleDraftPaymentEmail() {
    const plan = caseData.paymentPlan;
    if (!plan?.stripeCheckoutUrl) return;
    const recipient = (plan.clientEmail || attendeeEmail || '').trim();
    if (!recipient || !recipient.includes('@')) {
      alert('Add a valid client email first.');
      return;
    }
    await onDraftBillingEmail({
      to: recipient,
      clientName: plan.clientName || clientName,
      amountCents: plan.amountCents,
      currency: plan.currency,
      interval: plan.interval,
      checkoutUrl: plan.stripeCheckoutUrl,
      serviceType,
      upfrontRetainerCents: plan.upfrontRetainerCents,
    });
    logActivity(
      event.id,
      'email_drafted',
      'Billing payment link draft prepared',
      `To: ${recipient}`,
    );
    refreshCase();
  }

  function handleAdjustPlan(input: {
    amountCents: number;
    interval: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
    notes?: string;
  }) {
    const current = caseData.paymentPlan;
    if (!current) return;
    const updated = updatePaymentPlan(event.id, input);
    if (updated) {
      const detail = `${formatAmount(current.amountCents, current.currency)} → ${formatAmount(input.amountCents, current.currency)}, ${intervalAdverb(input.interval).toLowerCase()}`;
      logActivity(event.id, 'billing_plan_updated', 'Payment plan adjusted', detail);
    }
    refreshCase();
  }

  async function handlePausePlan() {
    const plan = caseData.paymentPlan;
    if (!plan) return;
    if (liveBilling && plan.stripeSubscriptionId) {
      try {
        await performAction({ subscriptionId: plan.stripeSubscriptionId, action: 'pause' });
      } catch (err) {
        alert(`Stripe pause failed: ${err instanceof Error ? err.message : 'unknown'}`);
        return;
      }
    }
    setPaymentPlan(event.id, pausePlan(plan));
    logActivity(event.id, 'billing_plan_paused', 'Representation paused', liveBilling ? 'Stripe collection paused' : 'Manual pause by attorney');
    refreshCase();
  }

  async function handleResumePlan() {
    const plan = caseData.paymentPlan;
    if (!plan) return;
    if (liveBilling && plan.stripeSubscriptionId) {
      try {
        await performAction({ subscriptionId: plan.stripeSubscriptionId, action: 'resume' });
      } catch (err) {
        alert(`Stripe resume failed: ${err instanceof Error ? err.message : 'unknown'}`);
        return;
      }
    }
    setPaymentPlan(event.id, resumePlan(plan));
    logActivity(event.id, 'billing_plan_resumed', 'Representation resumed');
    refreshCase();
  }

  async function handleCancelPlan() {
    const plan = caseData.paymentPlan;
    if (!plan) return;
    if (liveBilling && plan.stripeSubscriptionId) {
      try {
        await performAction({ subscriptionId: plan.stripeSubscriptionId, action: 'cancel' });
      } catch (err) {
        alert(`Stripe cancel failed: ${err instanceof Error ? err.message : 'unknown'}`);
        return;
      }
    }
    setPaymentPlan(event.id, cancelPlan(plan));
    logActivity(event.id, 'billing_plan_canceled', 'Payment plan canceled');
    refreshCase();
  }

  function handleSimulateSuccess() {
    if (!caseData.paymentPlan) return;
    const updated = simulateSuccessfulCharge(caseData.paymentPlan);
    setPaymentPlan(event.id, updated);
    const last = updated.invoices[0];
    logActivity(
      event.id,
      'billing_payment_succeeded',
      `Payment received: ${formatAmount(last.amountCents, last.currency)}`,
      last.description,
    );
    refreshCase();
  }

  function handleSimulateFailure() {
    if (!caseData.paymentPlan) return;
    const previous = caseData.paymentPlan;
    const updated = simulateFailedCharge(previous);
    setPaymentPlan(event.id, updated);
    const last = updated.invoices[0];
    logActivity(
      event.id,
      'billing_payment_failed',
      `Payment failed (attempt ${updated.failureCount})`,
      last.description,
    );
    if (updated.status === 'paused' && previous.status !== 'paused') {
      logActivity(
        event.id,
        'billing_plan_paused',
        'Representation auto-paused',
        `Triggered after ${FAILURE_PAUSE_THRESHOLD} failed payments`,
      );
    }
    refreshCase();
  }

  function handleRemovePlan() {
    clearPaymentPlan(event.id);
    refreshCase();
  }

  // --- PDF ---
  function handleExportPdf() {
    generateCaseSummaryPdf(caseData, serviceType, clientName);
    logActivity(event.id, 'pdf_generated', 'Case summary PDF exported');
    refreshCase();
  }

  // --- Helpers ---
  const defaultActions = [
    { id: 'confirm', type: 'confirm' as const, label: 'Draft Confirmation', description: 'Create a confirmation email', priority: 'high' as const },
    { id: 'reminder', type: 'reminder' as const, label: 'Draft Reminder', description: 'Create a reminder email', priority: 'medium' as const },
    { id: 'estimate', type: 'estimate' as const, label: 'Generate Estimate', description: 'Create a service estimate', priority: 'medium' as const },
    { id: 'followup', type: 'followup' as const, label: 'Draft Follow-up', description: 'Create a follow-up email', priority: 'low' as const },
  ];

  const actions = analysis?.suggestedActions || defaultActions;
  const hasEmail = attendeeEmail.trim().length > 0;
  const pendingTaskCount = caseData.tasks.filter((t) => !t.done).length;
  const docCount = caseData.documents.length;
  const activityCount = caseData.activityLog.length;

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
          <div className="detail-header-actions">
            <button className="btn-secondary btn-sm" onClick={handleExportPdf} title="Export case summary PDF">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              Export PDF
            </button>
            {caseData.paymentPlan && (
              <span
                className={`status-badge ${statusCls(caseData.paymentPlan.status)}`}
                title={`Payment plan: ${statusLabel(caseData.paymentPlan.status)}`}
              >
                {statusLabel(caseData.paymentPlan.status)}
              </span>
            )}
            <StatusBadge workflow={workflow} />
          </div>
        </div>

        {/* Tabs */}
        <div className="case-tabs">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.key}
              className={`case-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d={tab.icon} />
              </svg>
              {tab.label}
              {tab.key === 'tasks' && pendingTaskCount > 0 && (
                <span className="case-tab-badge">{pendingTaskCount}</span>
              )}
              {tab.key === 'docs' && docCount > 0 && (
                <span className="case-tab-badge">{docCount}</span>
              )}
              {tab.key === 'activity' && activityCount > 0 && (
                <span className="case-tab-badge">{activityCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* Details tab */}
        {activeTab === 'details' && (
          <div className="case-tab-content">
            {courtRecords && <CourtRecordsCard payload={courtRecords} />}
            <div className="detail-notes">
              <div className="detail-notes-header">
                <label>Notes</label>
                {!editingDescription && (
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => setEditingDescription(true)}
                  >
                    {event.description ? 'Edit' : 'Add notes'}
                  </button>
                )}
              </div>
              {editingDescription ? (
                <div className="detail-notes-editor">
                  <textarea
                    className="detail-notes-textarea"
                    value={descriptionDraft}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    placeholder="Describe this appointment — what's it about, goals, context. The AI uses this to generate tasks and drafts."
                    rows={6}
                    autoFocus
                  />
                  <div className="detail-notes-actions">
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => {
                        setDescriptionDraft(event.description || '');
                        setEditingDescription(false);
                      }}
                      disabled={savingDescription}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn-primary btn-sm"
                      onClick={handleSaveDescription}
                      disabled={savingDescription || descriptionDraft.trim() === (event.description || '').trim()}
                    >
                      {savingDescription ? <div className="spinner-sm" /> : 'Save notes'}
                    </button>
                  </div>
                </div>
              ) : event.description ? (
                <div dangerouslySetInnerHTML={{ __html: event.description }} />
              ) : (
                <p className="text-muted detail-notes-empty">
                  No notes yet. Add a description so the AI can generate tasks and drafts for this appointment.
                </p>
              )}
            </div>

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
                  <div className="typing"><span /><span /><span /></div>
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
        )}

        {/* Tasks tab */}
        {activeTab === 'tasks' && (
          <div className="case-tab-content">
            <CaseTasks
              tasks={caseData.tasks}
              suggestions={caseData.taskSuggestions}
              industry={industry}
              onToggle={handleToggleTask}
              onAdd={handleAddTask}
              onRemove={handleRemoveTask}
              onAcceptSuggestion={handleAcceptSuggestion}
              onDismissSuggestion={handleDismissSuggestion}
              onAcceptAllSuggestions={handleAcceptAllSuggestions}
              onSuggest={handleSuggestTasks}
              suggesting={suggesting}
              onTaskAction={handleTaskAction}
              taskActionLoading={taskActionLoading}
            />
          </div>
        )}

        {/* Docs tab */}
        {activeTab === 'docs' && (
          <div className="case-tab-content">
            <CaseDocuments
              documents={visibleDocuments}
              industry={industry}
              onUpload={handleUploadDocument}
              onRemove={handleRemoveDocument}
              uploading={uploading}
              driveFolderUrl={caseData.driveFolderUrl}
              driveFolderName={buildMatterFolderName(clientName, caseNumber, matterFolderCode)}
            />
          </div>
        )}

        {/* Chat tab */}
        {activeTab === 'chat' && (
          <div className="case-tab-content case-tab-chat">
            <CaseChat
              messages={caseData.chatHistory}
              documents={caseData.documents}
              industry={industry}
              caseTitle={serviceType}
              clientName={clientName}
              pendingTasks={pendingTaskCount}
              prefillMessage={chatPrefill}
              revisionTarget={chatRevisionTarget}
              onSend={handleSendChat}
              onClear={handleClearChat}
              sending={chatSending}
            />
          </div>
        )}

        {/* Billing tab */}
        {activeTab === 'billing' && (
          <div className="case-tab-content">
            <CaseBilling
              plan={caseData.paymentPlan}
              defaultClientName={clientName}
              defaultClientEmail={attendeeEmail}
              liveMode={liveBilling}
              creating={billingCreating}
              syncing={billingSyncing}
              onCreate={handleCreatePlan}
              onAdjust={handleAdjustPlan}
              onPause={handlePausePlan}
              onResume={handleResumePlan}
              onCancel={handleCancelPlan}
              onSimulateSuccess={handleSimulateSuccess}
              onSimulateFailure={handleSimulateFailure}
              onRemove={handleRemovePlan}
              onSync={handleSyncPlan}
              onDraftPaymentEmail={handleDraftPaymentEmail}
            />
          </div>
        )}

        {/* Activity tab */}
        {activeTab === 'activity' && (
          <div className="case-tab-content">
            <ActivityLog
              entries={caseData.activityLog}
              onChatAbout={handleChatAboutActivity}
            />
          </div>
        )}
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
  onCreateDoc: (goal?: string) => Promise<void> | void;
  onCreateSlides: (goal?: string) => Promise<void> | void;
  creatingDoc: boolean;
  creatingSlides: boolean;
}) {
  const linkedDocs = getLinkedDocuments(event);
  const hasDoc = linkedDocs.some((d) => d.type === 'doc');
  const hasSlides = linkedDocs.some((d) => d.type === 'slides');

  return (
    <div className="linked-docs-section">
      <h3>Google Workspace</h3>

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
          <button className="btn-secondary" onClick={() => onCreateDoc()} disabled={creatingDoc}>
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
          <button className="btn-secondary" onClick={() => onCreateSlides()} disabled={creatingSlides}>
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
