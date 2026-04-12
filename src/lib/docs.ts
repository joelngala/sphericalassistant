export interface LinkedDocument {
  type: 'doc' | 'slides';
  id: string;
  url: string;
  title: string;
  createdAt: string;
}

const DOCS_BASE = 'https://docs.googleapis.com/v1/documents';
const SLIDES_BASE = 'https://slides.googleapis.com/v1/presentations';

export async function createGoogleDoc(
  accessToken: string,
  title: string
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
  return {
    type: 'doc',
    id: data.documentId,
    url: `https://docs.google.com/document/d/${data.documentId}/edit`,
    title,
    createdAt: new Date().toISOString(),
  };
}

export async function createGoogleSlides(
  accessToken: string,
  title: string
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
  return {
    type: 'slides',
    id: data.presentationId,
    url: `https://docs.google.com/presentation/d/${data.presentationId}/edit`,
    title,
    createdAt: new Date().toISOString(),
  };
}
