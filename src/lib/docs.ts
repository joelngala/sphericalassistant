import type { CaseDocument, DocCategory, GoogleDocOutline, SlidesDeckOutline } from '../types.ts';

export interface LinkedDocument {
  type: 'doc' | 'slides';
  id: string;
  url: string;
  title: string;
  createdAt: string;
}

const DOCS_BASE = 'https://docs.googleapis.com/v1/documents';
const SLIDES_BASE = 'https://slides.googleapis.com/v1/presentations';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const ROOT_FOLDER_NAME = 'Spherical Assistant';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_SLIDES = 8;
const MAX_BULLETS = 6;
const MAX_DOC_SECTIONS = 8;
const MAX_DOC_BULLETS = 8;

export async function createGoogleDoc(
  accessToken: string,
  title: string,
  outline?: GoogleDocOutline,
): Promise<LinkedDocument> {
  const response = await fetch(DOCS_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Google Docs API error: ${response.status}`);
  }

  const data = await response.json();

  if (outline) {
    await populateGoogleDoc(accessToken, data.documentId, outline);
  }

  return {
    type: 'doc',
    id: data.documentId,
    url: `https://docs.google.com/document/d/${data.documentId}/edit`,
    title,
    createdAt: new Date().toISOString(),
  };
}

export async function updateGoogleDoc(
  accessToken: string,
  documentId: string,
  outline: GoogleDocOutline,
): Promise<void> {
  await populateGoogleDoc(accessToken, documentId, outline, true);
}

interface DocBlock {
  text: string;
  style: 'TITLE' | 'SUBTITLE' | 'HEADING_1' | 'HEADING_2' | 'NORMAL_TEXT';
  bullet?: boolean;
}

async function populateGoogleDoc(
  accessToken: string,
  documentId: string,
  outline: GoogleDocOutline,
  replaceExisting = false,
) {
  const title = (outline.title || 'Case Notes').trim();
  const subtitle = (outline.subtitle || '').trim();
  const executiveSummary = (outline.executiveSummary || '').trim();
  const sections = (outline.sections || []).slice(0, MAX_DOC_SECTIONS);

  const blocks: DocBlock[] = [];
  blocks.push({ text: title, style: 'TITLE' });
  if (subtitle) blocks.push({ text: subtitle, style: 'SUBTITLE' });
  blocks.push({ text: `Prepared ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, style: 'NORMAL_TEXT' });
  blocks.push({ text: '', style: 'NORMAL_TEXT' });

  if (executiveSummary) {
    blocks.push({ text: 'Executive Summary', style: 'HEADING_1' });
    blocks.push({ text: executiveSummary, style: 'NORMAL_TEXT' });
    blocks.push({ text: '', style: 'NORMAL_TEXT' });
  }

  for (const section of sections) {
    const heading = (section.heading || '').trim();
    if (!heading) continue;
    blocks.push({ text: heading, style: 'HEADING_1' });
    const bullets = (section.bullets || [])
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_DOC_BULLETS);
    for (const bullet of bullets) {
      blocks.push({ text: bullet, style: 'NORMAL_TEXT', bullet: true });
    }
    blocks.push({ text: '', style: 'NORMAL_TEXT' });
  }

  if (blocks.length === 0) return;

  const requests: Record<string, unknown>[] = [];

  if (replaceExisting) {
    const endIndex = await getDocumentEndIndex(accessToken, documentId);
    if (endIndex > 2) {
      requests.push({
        deleteContentRange: {
          range: {
            startIndex: 1,
            endIndex: endIndex - 1,
          },
        },
      });
    }
  }

  // Insert all text in one pass, then apply paragraph styles and bullets by range.
  let cursor = 1;
  const blockRanges: { block: DocBlock; start: number; end: number }[] = [];
  const combined = blocks.map((b) => b.text).join('\n') + '\n';

  requests.push({
    insertText: {
      location: { index: 1 },
      text: combined,
    },
  });

  for (const block of blocks) {
    const length = block.text.length + 1; // +1 for newline
    const start = cursor;
    const end = cursor + length;
    blockRanges.push({ block, start, end });
    cursor = end;
  }

  for (const { block, start, end } of blockRanges) {
    if (block.text.length === 0) continue;
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: start, endIndex: end },
        paragraphStyle: { namedStyleType: block.style },
        fields: 'namedStyleType',
      },
    });
    if (block.bullet) {
      requests.push({
        createParagraphBullets: {
          range: { startIndex: start, endIndex: end },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
        },
      });
    }
  }

  const response = await fetch(`${DOCS_BASE}/${documentId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Google Docs batchUpdate error: ${response.status}`);
  }
}

async function getDocumentEndIndex(accessToken: string, documentId: string): Promise<number> {
  const response = await fetch(`${DOCS_BASE}/${documentId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Google Docs get document error: ${response.status}`);
  }

  const data = await response.json();
  const content = Array.isArray(data?.body?.content) ? data.body.content : [];
  const maxEndIndex = content.reduce((max: number, node: { endIndex?: number }) => {
    return Math.max(max, Number(node?.endIndex || 1));
  }, 1);
  return maxEndIndex;
}

export async function createGoogleSlides(
  accessToken: string,
  title: string,
  outline?: SlidesDeckOutline,
): Promise<LinkedDocument> {
  const response = await fetch(SLIDES_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Google Slides API error: ${response.status}`);
  }

  const data = await response.json();

  if (outline) {
    await populateGoogleSlides(accessToken, data.presentationId, outline);
  }

  return {
    type: 'slides',
    id: data.presentationId,
    url: `https://docs.google.com/presentation/d/${data.presentationId}/edit`,
    title,
    createdAt: new Date().toISOString(),
  };
}

export async function updateGoogleSlides(
  accessToken: string,
  presentationId: string,
  outline: SlidesDeckOutline,
): Promise<void> {
  await populateGoogleSlides(accessToken, presentationId, outline);
}

interface SlideShell {
  objectId: string;
  speakerNotesObjectId?: string;
}

async function fetchSlideShells(accessToken: string, presentationId: string): Promise<SlideShell[]> {
  const response = await fetch(`${SLIDES_BASE}/${presentationId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Google Slides get presentation error: ${response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data?.slides)) return [];
  return data.slides
    .map((slide: { objectId?: string; notesPage?: { notesProperties?: { speakerNotesObjectId?: string } } }) => ({
      objectId: slide?.objectId || '',
      speakerNotesObjectId: slide?.notesPage?.notesProperties?.speakerNotesObjectId,
    }))
    .filter((s: SlideShell) => Boolean(s.objectId));
}

async function populateGoogleSlides(
  accessToken: string,
  presentationId: string,
  outline: SlidesDeckOutline,
) {
  // 1. Delete all existing slides (fresh canvas for both create + update flows).
  const existingShells = await fetchSlideShells(accessToken, presentationId);
  const slideIdsToDelete = existingShells.map((s) => s.objectId);

  // 2. Build the deck: title slide + content slides.
  const contentSlides = (outline.slides || []).slice(0, MAX_SLIDES - 1);
  const idPrefix = `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  const deleteRequests: Record<string, unknown>[] = slideIdsToDelete.map((id) => ({
    deleteObject: { objectId: id },
  }));

  // Create slides request (ids generated, but speaker notes ids are only known AFTER the create batch runs).
  const titleSlideId = `${idPrefix}_slide_0`;
  const titleTitleId = `${idPrefix}_title_0`;
  const titleSubtitleId = `${idPrefix}_subtitle_0`;

  const createRequests: Record<string, unknown>[] = [
    {
      createSlide: {
        objectId: titleSlideId,
        slideLayoutReference: { predefinedLayout: 'TITLE' },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: 'CENTERED_TITLE', index: 0 }, objectId: titleTitleId },
          { layoutPlaceholder: { type: 'SUBTITLE', index: 0 }, objectId: titleSubtitleId },
        ],
      },
    },
  ];

  contentSlides.forEach((_, index) => {
    const i = index + 1;
    createRequests.push({
      createSlide: {
        objectId: `${idPrefix}_slide_${i}`,
        slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: 'TITLE', index: 0 }, objectId: `${idPrefix}_title_${i}` },
          { layoutPlaceholder: { type: 'BODY', index: 0 }, objectId: `${idPrefix}_body_${i}` },
        ],
      },
    });
  });

  // Execute delete + create first so we can then look up per-slide notes IDs.
  const phase1 = [...deleteRequests, ...createRequests];
  if (phase1.length > 0) {
    await batchUpdateSlides(accessToken, presentationId, phase1);
  }

  // Now fetch the new slide shells so we can populate speaker notes.
  const newShells = await fetchSlideShells(accessToken, presentationId);
  const slideIdToNotesId = new Map<string, string>();
  for (const shell of newShells) {
    if (shell.speakerNotesObjectId) slideIdToNotesId.set(shell.objectId, shell.speakerNotesObjectId);
  }

  // Phase 2: insert text + bullets + speaker notes.
  const phase2: Record<string, unknown>[] = [];

  const titleText = (outline.title || 'Presentation').trim();
  const subtitleText = (outline.subtitle || '').trim();

  phase2.push({ insertText: { objectId: titleTitleId, insertionIndex: 0, text: titleText } });
  if (subtitleText) {
    phase2.push({ insertText: { objectId: titleSubtitleId, insertionIndex: 0, text: subtitleText } });
  }

  contentSlides.forEach((slide, index) => {
    const i = index + 1;
    const titleId = `${idPrefix}_title_${i}`;
    const bodyId = `${idPrefix}_body_${i}`;
    const slideObjId = `${idPrefix}_slide_${i}`;

    const bullets = (slide.bullets || [])
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_BULLETS);

    phase2.push({
      insertText: { objectId: titleId, insertionIndex: 0, text: slide.title || `Slide ${i}` },
    });

    if (bullets.length > 0) {
      phase2.push({
        insertText: { objectId: bodyId, insertionIndex: 0, text: bullets.join('\n') },
      });
      phase2.push({
        createParagraphBullets: {
          objectId: bodyId,
          textRange: { type: 'ALL' },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
        },
      });
    }

    const notes = (slide.speakerNotes || '').trim();
    const notesId = slideIdToNotesId.get(slideObjId);
    if (notes && notesId) {
      phase2.push({
        insertText: { objectId: notesId, insertionIndex: 0, text: notes },
      });
    }
  });

  if (phase2.length > 0) {
    await batchUpdateSlides(accessToken, presentationId, phase2);
  }
}

// --- Google Drive: matter folders + file uploads ---

export interface DriveFolderRef {
  id: string;
  name: string;
  url: string;
}

export interface DriveFileRef {
  id: string;
  name: string;
  url: string;
}

export interface DriveMatterFile {
  id: string;
  name: string;
  size: number;
  uploadedAt: string;
  url: string;
  category?: DocCategory;
}

async function driveFetch(accessToken: string, path: string, init?: RequestInit) {
  const response = await fetch(`${DRIVE_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Google Drive error: ${response.status}`);
  }
  return response.json();
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function slugifyPart(input: string): string {
  return (input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

async function findFolderByName(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<DriveFolderRef | null> {
  const parentClause = parentId ? ` and '${escapeDriveQuery(parentId)}' in parents` : '';
  const q = `name = '${escapeDriveQuery(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false${parentClause}`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,webViewLink)',
    pageSize: '1',
  });
  const data = await driveFetch(accessToken, `/files?${params.toString()}`);
  const file = Array.isArray(data?.files) && data.files[0];
  if (!file) return null;
  return {
    id: file.id,
    name: file.name,
    url: file.webViewLink || `https://drive.google.com/drive/folders/${file.id}`,
  };
}

async function createFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<DriveFolderRef> {
  const body: Record<string, unknown> = { name, mimeType: FOLDER_MIME };
  if (parentId) body.parents = [parentId];
  const data = await driveFetch(accessToken, '/files?fields=id,name,webViewLink', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return {
    id: data.id,
    name: data.name,
    url: data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`,
  };
}

async function ensureFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<DriveFolderRef> {
  const existing = await findFolderByName(accessToken, name, parentId);
  if (existing) return existing;
  return createFolder(accessToken, name, parentId);
}

function deriveCaseToken(caseNumber?: string, matterCode?: string): string {
  const explicit = slugifyPart(matterCode || '');
  if (explicit) return explicit.slice(0, 12);

  const raw = (caseNumber || '').toLowerCase();
  const tokens = raw.split(/[^a-z0-9]+/).filter(Boolean);
  const alphaTokens = tokens.filter((token) => /[a-z]/.test(token) && token.length <= 12);
  if (alphaTokens.length > 0) {
    const strongest = [...alphaTokens].sort((a, b) => b.length - a.length)[0];
    return strongest;
  }

  return 'gen';
}

function buildLegacyMatterFolderName(clientName: string, caseNumber?: string): string {
  const client = (clientName || 'Unknown Client').trim().replace(/[\\/:*?"<>|]/g, '-');
  const caseRef = (caseNumber || '').trim().replace(/[\\/:*?"<>|]/g, '-');
  return caseRef ? `${client} — ${caseRef}` : client;
}

export function buildMatterFolderName(clientName: string, caseNumber?: string, matterCode?: string): string {
  const clientSlug = slugifyPart(clientName || '') || 'unknown-client';
  const caseToken = deriveCaseToken(caseNumber, matterCode);
  return `${clientSlug}-case-${caseToken}`;
}

export async function ensureRootFolder(accessToken: string): Promise<DriveFolderRef> {
  return ensureFolder(accessToken, ROOT_FOLDER_NAME);
}

export async function ensureMatterFolder(
  accessToken: string,
  clientName: string,
  caseNumber?: string,
  matterCode?: string,
): Promise<DriveFolderRef> {
  const root = await ensureRootFolder(accessToken);
  const canonical = buildMatterFolderName(clientName, caseNumber, matterCode);
  const existingCanonical = await findFolderByName(accessToken, canonical, root.id);
  if (existingCanonical) return existingCanonical;

  // Backward compatibility: keep using legacy folders when they already exist.
  const legacy = buildLegacyMatterFolderName(clientName, caseNumber);
  const existingLegacy = await findFolderByName(accessToken, legacy, root.id);
  if (existingLegacy) return existingLegacy;

  return ensureFolder(accessToken, canonical, root.id);
}

export async function findMatterFolder(
  accessToken: string,
  clientName: string,
  caseNumber?: string,
  matterCode?: string,
): Promise<DriveFolderRef | null> {
  const root = await ensureRootFolder(accessToken);
  const canonical = buildMatterFolderName(clientName, caseNumber, matterCode);
  const foundCanonical = await findFolderByName(accessToken, canonical, root.id);
  if (foundCanonical) return foundCanonical;
  const legacy = buildLegacyMatterFolderName(clientName, caseNumber);
  return findFolderByName(accessToken, legacy, root.id);
}

function toDocCategory(value: string | undefined): DocCategory | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  const allowed: DocCategory[] = [
    'intake',
    'court',
    'medical',
    'correspondence',
    'financial',
    'evidence',
    'discovery',
    'contracts',
    'property',
    'inspections',
    'title',
    'other',
  ];
  return allowed.includes(v as DocCategory) ? (v as DocCategory) : undefined;
}

function inferDocCategoryFromName(name: string): DocCategory {
  const n = name.toLowerCase();
  if (/\b(intake|retainer|engagement)\b/.test(n)) return 'intake';
  if (/\b(court|hearing|motion|order|complaint|citation|arrest)\b/.test(n)) return 'court';
  if (/\b(medical|hospital|diagnosis|treatment|records?)\b/.test(n)) return 'medical';
  if (/\b(email|letter|correspondence|message)\b/.test(n)) return 'correspondence';
  if (/\b(invoice|bill|receipt|payment|financial|statement)\b/.test(n)) return 'financial';
  if (/\b(photo|image|video|evidence|exhibit)\b/.test(n)) return 'evidence';
  if (/\b(discovery|interrogator|deposition|disclosure)\b/.test(n)) return 'discovery';
  if (/\b(contract|agreement|offer|addendum)\b/.test(n)) return 'contracts';
  if (/\b(property|listing|deed|survey)\b/.test(n)) return 'property';
  if (/\b(inspection|appraisal|condition report)\b/.test(n)) return 'inspections';
  if (/\b(title|closing|escrow|settlement)\b/.test(n)) return 'title';
  return 'other';
}

export async function listMatterFolderFiles(
  accessToken: string,
  folderId: string,
): Promise<DriveMatterFile[]> {
  const files: DriveMatterFile[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${escapeDriveQuery(folderId)}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`,
      fields: 'nextPageToken,files(id,name,size,mimeType,createdTime,webViewLink,appProperties)',
      pageSize: '200',
      orderBy: 'createdTime desc',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = (await driveFetch(accessToken, `/files?${params.toString()}`)) as {
      files?: Array<{
        id?: string;
        name?: string;
        size?: string;
        mimeType?: string;
        createdTime?: string;
        webViewLink?: string;
        appProperties?: Record<string, string>;
      }>;
      nextPageToken?: string;
    };
    for (const file of data.files || []) {
      if (!file?.id || !file?.name) continue;
      if (typeof file.mimeType === 'string' && (file.mimeType.startsWith('image/') || file.mimeType.startsWith('video/'))) {
        continue;
      }
      const category = toDocCategory(file.appProperties?.sphericalCategory);
      const uploadedAt = file.appProperties?.sphericalUploadedAt || file.createdTime || new Date().toISOString();
      const size = Number(file.size || 0);
      files.push({
        id: file.id,
        name: file.name,
        size: Number.isFinite(size) ? size : 0,
        uploadedAt,
        url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
        category,
      });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files;
}

export function mapDriveFilesToCaseDocuments(files: DriveMatterFile[]): CaseDocument[] {
  return files.map((file) => ({
    id: file.id,
    name: file.name,
    category: file.category || inferDocCategoryFromName(file.name),
    uploadedAt: file.uploadedAt,
    size: file.size,
    textContent: '',
    driveFileId: file.id,
    driveUrl: file.url,
  }));
}

export async function findSpreadsheetInFolder(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<{ id: string; name: string; url: string } | null> {
  const q = `name = '${escapeDriveQuery(name)}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false and '${escapeDriveQuery(parentId)}' in parents`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,webViewLink)',
    pageSize: '1',
  });
  const data = await driveFetch(accessToken, `/files?${params.toString()}`);
  const file = Array.isArray(data?.files) && data.files[0];
  if (!file) return null;
  return {
    id: file.id,
    name: file.name,
    url: file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
  };
}

export async function createSpreadsheetInFolder(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<{ id: string; name: string; url: string }> {
  const data = await driveFetch(accessToken, '/files?fields=id,name,webViewLink', {
    method: 'POST',
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [parentId],
    }),
  });
  return {
    id: data.id,
    name: data.name,
    url: data.webViewLink || `https://docs.google.com/spreadsheets/d/${data.id}/edit`,
  };
}

export async function uploadFileToDrive(
  accessToken: string,
  file: File,
  folderId: string,
  metadata?: {
    category?: DocCategory;
    uploadedAt?: string;
  },
): Promise<DriveFileRef> {
  const driveMetadata = {
    name: file.name,
    parents: [folderId],
    appProperties: {
      ...(metadata?.category ? { sphericalCategory: metadata.category } : {}),
      ...(metadata?.uploadedAt ? { sphericalUploadedAt: metadata.uploadedAt } : {}),
    },
  };
  const boundary = `-------spherical-${Date.now().toString(36)}`;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(driveMetadata) +
      `\r\n--${boundary}\r\n` +
      `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const fileBuffer = new Uint8Array(await file.arrayBuffer());
  const body = new Uint8Array(head.length + fileBuffer.length + tail.length);
  body.set(head, 0);
  body.set(fileBuffer, head.length);
  body.set(tail, head.length + fileBuffer.length);

  const response = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Drive upload failed: ${response.status}`);
  }
  const data = await response.json();
  return {
    id: data.id,
    name: data.name,
    url: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
  };
}

export async function trashDriveFile(accessToken: string, fileId: string): Promise<void> {
  await driveFetch(accessToken, `/files/${encodeURIComponent(fileId)}?fields=id`, {
    method: 'PATCH',
    body: JSON.stringify({ trashed: true }),
  });
}

async function batchUpdateSlides(
  accessToken: string,
  presentationId: string,
  requests: Record<string, unknown>[],
) {
  const response = await fetch(`${SLIDES_BASE}/${presentationId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Google Slides batchUpdate error: ${response.status}`);
  }
}
