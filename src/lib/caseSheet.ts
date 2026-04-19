// Google Sheets "Case Database" — backend-of-record for the assistant.
// Lawyer never needs to open this sheet; it's where the assistant reads/writes case state
// so it survives across devices and sessions without us running our own database.

import type { CalendarEvent, CaseData, CaseDocument } from '../types.ts';
import {
  ensureRootFolder,
  findSpreadsheetInFolder,
  createSpreadsheetInFolder,
} from './docs.ts';
import {
  getClientNameFromSummary,
  parseServiceType,
  getCaseNumberFromEvent,
  getWorkflowState,
  getEventDateTime,
} from './calendar.ts';
import { loadCase } from './caseStore.ts';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DATABASE_SHEET_NAME = 'Case Database';
const LS_SHEET_ID_KEY = 'spherical:caseSheetId';
const LS_SHEET_URL_KEY = 'spherical:caseSheetUrl';
const LS_TABS_READY_KEY = 'spherical:caseSheetTabsReady';

const MATTERS_HEADER = [
  'EventID',
  'Client',
  'Case #',
  'Matter',
  'Status',
  'Paid?',
  'Retainer balance',
  'Next hearing',
  'Judge',
  'Open tasks',
  'Doc count',
  'Last activity',
  'Notes',
];

const DOCUMENTS_HEADER = [
  'DocID',
  'EventID',
  'Client',
  'Name',
  'Category',
  'AI Summary',
  'Drive URL',
  'Uploaded',
];

async function sheetsFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(`${SHEETS_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const msg = (error as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(msg || `Google Sheets error: ${response.status}`);
  }
  return response.json();
}

export interface CaseSheetRef {
  id: string;
  url: string;
}

export async function ensureCaseSheet(accessToken: string): Promise<CaseSheetRef> {
  const cachedId = localStorage.getItem(LS_SHEET_ID_KEY);
  const cachedUrl = localStorage.getItem(LS_SHEET_URL_KEY);
  if (cachedId && cachedUrl) {
    try {
      await sheetsFetch(accessToken, `/${cachedId}?fields=spreadsheetId`);
      return { id: cachedId, url: cachedUrl };
    } catch {
      // cached id invalid (deleted/permissions) — fall through to re-create
      localStorage.removeItem(LS_SHEET_ID_KEY);
      localStorage.removeItem(LS_SHEET_URL_KEY);
      localStorage.removeItem(LS_TABS_READY_KEY);
    }
  }

  const root = await ensureRootFolder(accessToken);
  let file = await findSpreadsheetInFolder(accessToken, DATABASE_SHEET_NAME, root.id);
  if (!file) {
    file = await createSpreadsheetInFolder(accessToken, DATABASE_SHEET_NAME, root.id);
  }
  localStorage.setItem(LS_SHEET_ID_KEY, file.id);
  localStorage.setItem(LS_SHEET_URL_KEY, file.url);
  await ensureTabs(accessToken, file.id);
  return { id: file.id, url: file.url };
}

async function ensureTabs(accessToken: string, spreadsheetId: string) {
  if (localStorage.getItem(LS_TABS_READY_KEY) === spreadsheetId) return;

  const meta = (await sheetsFetch(accessToken, `/${spreadsheetId}?fields=sheets(properties(title))`)) as {
    sheets?: { properties?: { title?: string } }[];
  };
  const titles = new Set(
    (meta.sheets || []).map((s) => s?.properties?.title).filter(Boolean) as string[],
  );

  const requests: Record<string, unknown>[] = [];
  if (!titles.has('Matters')) {
    requests.push({ addSheet: { properties: { title: 'Matters' } } });
  }
  if (!titles.has('Documents')) {
    requests.push({ addSheet: { properties: { title: 'Documents' } } });
  }
  if (titles.has('Sheet1') && !titles.has('Matters')) {
    // leave Sheet1 alone; we'll use explicit Matters/Documents tabs
  }

  if (requests.length > 0) {
    await sheetsFetch(accessToken, `/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests }),
    });
  }

  // Write headers (idempotent — overwrites row 1 on each boot, cheap)
  await sheetsFetch(
    accessToken,
    `/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: [
          { range: 'Matters!A1:M1', values: [MATTERS_HEADER] },
          { range: 'Documents!A1:H1', values: [DOCUMENTS_HEADER] },
        ],
      }),
    },
  );

  localStorage.setItem(LS_TABS_READY_KEY, spreadsheetId);
}

// --- Row lookup / upsert ---

async function findRowIndexByKey(
  accessToken: string,
  spreadsheetId: string,
  tab: string,
  keyColumn: string,
  keyValue: string,
): Promise<number> {
  // Returns the 1-based row index, or -1 if not found.
  const range = `${tab}!${keyColumn}:${keyColumn}`;
  const data = (await sheetsFetch(
    accessToken,
    `/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=COLUMNS`,
  )) as { values?: string[][] };
  const column = (data.values && data.values[0]) || [];
  for (let i = 1; i < column.length; i++) {
    if (column[i] === keyValue) return i + 1;
  }
  return -1;
}

async function writeRange(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: (string | number)[][],
) {
  await sheetsFetch(
    accessToken,
    `/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      body: JSON.stringify({ values }),
    },
  );
}

async function appendRow(
  accessToken: string,
  spreadsheetId: string,
  tab: string,
  values: (string | number)[],
) {
  await sheetsFetch(
    accessToken,
    `/${spreadsheetId}/values/${encodeURIComponent(`${tab}!A:A`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      body: JSON.stringify({ values: [values] }),
    },
  );
}

// --- Matter row shape ---

function matterRow(event: CalendarEvent, data: CaseData): string[] {
  const client = getClientNameFromSummary(event.summary) || 'Unknown';
  const caseNo = getCaseNumberFromEvent(event);
  const matter = parseServiceType(event.summary);
  const workflow = getWorkflowState(event);
  const plan = data.paymentPlan;
  const paid = plan
    ? plan.retainerStatus === 'paid' || plan.status === 'active'
      ? 'yes'
      : plan.status === 'past_due'
        ? 'past due'
        : plan.retainerStatus === 'awaiting_payment'
          ? 'awaiting retainer'
          : plan.status
    : 'no plan';
  const balance = plan
    ? `${(plan.amountCents / 100).toFixed(2)} ${plan.currency?.toUpperCase() || 'USD'} / ${plan.interval}`
    : '';
  const openTasks = data.tasks.filter((t) => !t.done).length;
  const docCount = data.documents.length;
  const nextHearing = getEventDateTime(event).toISOString();
  const judge = event.extendedProperties?.private?.sphericalJudge || '';
  const lastActivity = data.activityLog[0]?.label || data.updatedAt;
  const notes = (event.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 280);

  return [
    event.id,
    client,
    caseNo,
    matter,
    workflow.status,
    paid,
    balance,
    nextHearing,
    judge,
    String(openTasks),
    String(docCount),
    lastActivity,
    notes,
  ];
}

function documentRow(eventId: string, clientName: string, doc: CaseDocument): string[] {
  return [
    doc.id,
    eventId,
    clientName,
    doc.name,
    doc.category,
    doc.aiSummary || '',
    doc.driveUrl || '',
    doc.uploadedAt,
  ];
}

// --- Public sync API ---

export async function syncMatterRow(accessToken: string, event: CalendarEvent): Promise<void> {
  const sheet = await ensureCaseSheet(accessToken);
  const data = loadCase(event.id);
  const row = matterRow(event, data);
  const rowIndex = await findRowIndexByKey(accessToken, sheet.id, 'Matters', 'A', event.id);
  if (rowIndex > 0) {
    await writeRange(accessToken, sheet.id, `Matters!A${rowIndex}:M${rowIndex}`, [row]);
  } else {
    await appendRow(accessToken, sheet.id, 'Matters', row);
  }
}

export async function syncDocumentRow(
  accessToken: string,
  event: CalendarEvent,
  doc: CaseDocument,
): Promise<void> {
  const sheet = await ensureCaseSheet(accessToken);
  const clientName = getClientNameFromSummary(event.summary) || 'Unknown';
  const row = documentRow(event.id, clientName, doc);
  const rowIndex = await findRowIndexByKey(accessToken, sheet.id, 'Documents', 'A', doc.id);
  if (rowIndex > 0) {
    await writeRange(accessToken, sheet.id, `Documents!A${rowIndex}:H${rowIndex}`, [row]);
  } else {
    await appendRow(accessToken, sheet.id, 'Documents', row);
  }
}

export async function removeDocumentRow(accessToken: string, docId: string): Promise<void> {
  const cachedId = localStorage.getItem(LS_SHEET_ID_KEY);
  if (!cachedId) return;
  const rowIndex = await findRowIndexByKey(accessToken, cachedId, 'Documents', 'A', docId);
  if (rowIndex > 0) {
    await writeRange(
      accessToken,
      cachedId,
      `Documents!A${rowIndex}:H${rowIndex}`,
      [['', '', '', '', '', '', '', '']],
    );
  }
}

// Fire-and-forget wrapper — never throws so UI mutations stay fast and resilient
// if the Sheet is briefly unreachable. Logs failures for debugging.
export function syncInBackground(fn: () => Promise<void>, label: string) {
  fn().catch((err) => {
    console.warn(`[caseSheet] ${label} failed:`, err);
  });
}
