import type {
  CaseData,
  CaseTask,
  CaseDocument,
  CaseChatMessage,
  ActivityLogEntry,
  ActivityAction,
  IndustryType,
  DocCategory,
  PaymentPlan,
  PaymentInvoice,
} from '../types.ts';

const STORAGE_PREFIX = 'spherical:case:';
const INDUSTRY_KEY = 'spherical:industry';

export function getIndustry(): IndustryType {
  return (localStorage.getItem(INDUSTRY_KEY) as IndustryType) || 'legal';
}

export function setIndustry(industry: IndustryType) {
  localStorage.setItem(INDUSTRY_KEY, industry);
}

function caseKey(eventId: string): string {
  return `${STORAGE_PREFIX}${eventId}`;
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

export function loadCase(eventId: string): CaseData {
  const raw = localStorage.getItem(caseKey(eventId));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as CaseData;
      // Migrate older case objects that don't have suggestion fields yet
      if (!Array.isArray(parsed.taskSuggestions)) parsed.taskSuggestions = [];
      if (!Array.isArray(parsed.dismissedSuggestions)) parsed.dismissedSuggestions = [];
      return parsed;
    } catch {
      // corrupted — reset
    }
  }
  return {
    eventId,
    industry: getIndustry(),
    tasks: [],
    taskSuggestions: [],
    dismissedSuggestions: [],
    documents: [],
    chatHistory: [],
    activityLog: [],
    updatedAt: now(),
  };
}

function saveCase(data: CaseData) {
  data.updatedAt = now();
  localStorage.setItem(caseKey(data.eventId), JSON.stringify(data));
}

// --- Activity Log ---

export function logActivity(
  eventId: string,
  action: ActivityAction,
  label: string,
  detail?: string,
): ActivityLogEntry {
  const entry: ActivityLogEntry = { id: uid(), action, label, detail, timestamp: now() };
  const data = loadCase(eventId);
  data.activityLog.unshift(entry);
  saveCase(data);
  return entry;
}

// --- Tasks ---

export function addTask(eventId: string, label: string, auto = false): CaseTask {
  const task: CaseTask = { id: uid(), label, done: false, createdAt: now(), auto };
  const data = loadCase(eventId);
  data.tasks.push(task);
  logActivity(eventId, 'task_added', `Task added: ${label}`);
  saveCase(data);
  return task;
}

export function toggleTask(eventId: string, taskId: string): CaseTask | null {
  const data = loadCase(eventId);
  const task = data.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  task.done = !task.done;
  task.completedAt = task.done ? now() : undefined;
  if (task.done) {
    logActivity(eventId, 'task_completed', `Task completed: ${task.label}`);
  }
  saveCase(data);
  return task;
}

export function removeTask(eventId: string, taskId: string) {
  const data = loadCase(eventId);
  data.tasks = data.tasks.filter((t) => t.id !== taskId);
  saveCase(data);
}

export function acceptSuggestion(eventId: string, label: string): CaseTask | null {
  const data = loadCase(eventId);
  if (!data.taskSuggestions.includes(label)) return null;
  const task: CaseTask = { id: uid(), label, done: false, createdAt: now(), auto: true };
  data.tasks.push(task);
  data.taskSuggestions = data.taskSuggestions.filter((s) => s !== label);
  logActivity(eventId, 'task_added', `Task added: ${label}`);
  saveCase(data);
  return task;
}

export function acceptAllSuggestions(eventId: string) {
  const data = loadCase(eventId);
  if (data.taskSuggestions.length === 0) return;
  for (const label of data.taskSuggestions) {
    const task: CaseTask = { id: uid(), label, done: false, createdAt: now(), auto: true };
    data.tasks.push(task);
    logActivity(eventId, 'task_added', `Task added: ${label}`);
  }
  data.taskSuggestions = [];
  saveCase(data);
}

export function dismissSuggestion(eventId: string, label: string) {
  const data = loadCase(eventId);
  data.taskSuggestions = data.taskSuggestions.filter((s) => s !== label);
  if (!data.dismissedSuggestions.includes(label)) {
    data.dismissedSuggestions.push(label);
  }
  saveCase(data);
}

export function addSuggestions(eventId: string, labels: string[]) {
  const data = loadCase(eventId);
  const existing = new Set([
    ...data.taskSuggestions,
    ...data.dismissedSuggestions,
    ...data.tasks.map((t) => t.label),
  ]);
  for (const label of labels) {
    if (!existing.has(label)) data.taskSuggestions.push(label);
  }
  saveCase(data);
}

// --- Documents ---

export function addDocument(
  eventId: string,
  name: string,
  category: DocCategory,
  textContent: string,
  size: number,
  extras?: { driveFileId?: string; driveUrl?: string; aiSummary?: string },
): CaseDocument {
  const doc: CaseDocument = {
    id: uid(),
    name,
    category,
    uploadedAt: now(),
    size,
    textContent,
    driveFileId: extras?.driveFileId,
    driveUrl: extras?.driveUrl,
    aiSummary: extras?.aiSummary,
  };
  const data = loadCase(eventId);
  data.documents.push(doc);
  const detailParts = [`Category: ${category}`];
  if (extras?.aiSummary) detailParts.push(extras.aiSummary);
  if (extras?.driveUrl) detailParts.push(`Drive: ${extras.driveUrl}`);
  logActivity(eventId, 'document_uploaded', `Document uploaded: ${name}`, detailParts.join(' · '));
  saveCase(data);
  return doc;
}

export function setDriveFolder(eventId: string, id: string, url: string) {
  const data = loadCase(eventId);
  data.driveFolderId = id;
  data.driveFolderUrl = url;
  saveCase(data);
}

export function removeDocument(eventId: string, docId: string) {
  const data = loadCase(eventId);
  const doc = data.documents.find((d) => d.id === docId);
  data.documents = data.documents.filter((d) => d.id !== docId);
  if (doc) {
    logActivity(eventId, 'document_removed', `Document removed: ${doc.name}`);
  }
  saveCase(data);
}

export function listAllCases(): CaseData[] {
  const out: CaseData[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as CaseData;
      if (!Array.isArray(parsed.taskSuggestions)) parsed.taskSuggestions = [];
      if (!Array.isArray(parsed.dismissedSuggestions)) parsed.dismissedSuggestions = [];
      if (!Array.isArray(parsed.documents)) parsed.documents = [];
      out.push(parsed);
    } catch {
      // skip corrupt entries
    }
  }
  return out;
}

export interface OrganizedDocument extends CaseDocument {
  eventId: string;
}

export function listAllDocuments(): OrganizedDocument[] {
  const out: OrganizedDocument[] = [];
  for (const data of listAllCases()) {
    for (const doc of data.documents) {
      out.push({ ...doc, eventId: data.eventId });
    }
  }
  return out.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
}

// --- Payment Plans ---

export function setPaymentPlan(eventId: string, plan: PaymentPlan) {
  const data = loadCase(eventId);
  data.paymentPlan = plan;
  saveCase(data);
}

export function updatePaymentPlan(
  eventId: string,
  updates: Partial<PaymentPlan>,
): PaymentPlan | null {
  const data = loadCase(eventId);
  if (!data.paymentPlan) return null;
  data.paymentPlan = { ...data.paymentPlan, ...updates, updatedAt: now() };
  saveCase(data);
  return data.paymentPlan;
}

export function addInvoice(eventId: string, invoice: PaymentInvoice) {
  const data = loadCase(eventId);
  if (!data.paymentPlan) return;
  data.paymentPlan.invoices.unshift(invoice);
  data.paymentPlan.updatedAt = now();
  saveCase(data);
}

export function clearPaymentPlan(eventId: string) {
  const data = loadCase(eventId);
  data.paymentPlan = undefined;
  saveCase(data);
}

// --- Chat ---

export function addChatMessage(
  eventId: string,
  role: 'user' | 'assistant',
  text: string,
): CaseChatMessage {
  const msg: CaseChatMessage = { id: uid(), role, text, timestamp: now() };
  const data = loadCase(eventId);
  data.chatHistory.push(msg);
  saveCase(data);
  return msg;
}

export function clearChat(eventId: string) {
  const data = loadCase(eventId);
  data.chatHistory = [];
  saveCase(data);
}

// --- Industry categories ---

export const LEGAL_CATEGORIES: { key: DocCategory; label: string; icon: string }[] = [
  { key: 'intake', label: 'Intake & Contact', icon: '📋' },
  { key: 'court', label: 'Court & Legal', icon: '⚖️' },
  { key: 'medical', label: 'Medical', icon: '🏥' },
  { key: 'correspondence', label: 'Correspondence', icon: '✉️' },
  { key: 'financial', label: 'Financial', icon: '💰' },
  { key: 'evidence', label: 'Evidence', icon: '📸' },
  { key: 'discovery', label: 'Discovery', icon: '🔍' },
];

export const REALESTATE_CATEGORIES: { key: DocCategory; label: string; icon: string }[] = [
  { key: 'intake', label: 'Lead & Contact', icon: '📋' },
  { key: 'contracts', label: 'Contracts & Offers', icon: '📝' },
  { key: 'property', label: 'Property Details', icon: '🏠' },
  { key: 'correspondence', label: 'Correspondence', icon: '✉️' },
  { key: 'financial', label: 'Financial & Mortgage', icon: '💰' },
  { key: 'inspections', label: 'Inspections & Appraisals', icon: '🔎' },
  { key: 'title', label: 'Title & Closing', icon: '📄' },
];

export function getCategoriesForIndustry(industry: IndustryType) {
  if (industry === 'realestate') return REALESTATE_CATEGORIES;
  return LEGAL_CATEGORIES;
}
