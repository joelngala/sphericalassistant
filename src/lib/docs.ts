import type { GoogleDocOutline, SlidesDeckOutline } from '../types.ts';

export interface LinkedDocument {
  type: 'doc' | 'slides';
  id: string;
  url: string;
  title: string;
  createdAt: string;
}

const DOCS_BASE = 'https://docs.googleapis.com/v1/documents';
const SLIDES_BASE = 'https://slides.googleapis.com/v1/presentations';
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
