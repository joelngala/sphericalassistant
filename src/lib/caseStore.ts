import type {
  CaseData,
  CaseTask,
  CaseDocument,
  CaseChatMessage,
  ActivityLogEntry,
  ActivityAction,
  IndustryType,
  DocCategory,
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
): CaseDocument {
  const doc: CaseDocument = { id: uid(), name, category, uploadedAt: now(), size, textContent };
  const data = loadCase(eventId);
  data.documents.push(doc);
  logActivity(eventId, 'document_uploaded', `Document uploaded: ${name}`, `Category: ${category}`);
  saveCase(data);
  return doc;
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
