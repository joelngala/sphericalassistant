import { ROOT_FOLDER_NAME } from './config.js';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function driveFetch(accessToken, path, init = {}) {
  const res = await fetch(`${DRIVE_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message || `Drive API error ${res.status}`);
  }
  return res.json();
}

async function findFolderByName(accessToken, name, parentId) {
  const parentClause = parentId ? ` and '${escapeDriveQuery(parentId)}' in parents` : '';
  const q = `name = '${escapeDriveQuery(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false${parentClause}`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,webViewLink)',
    pageSize: '1',
  });
  const data = await driveFetch(accessToken, `/files?${params.toString()}`);
  const file = data?.files?.[0];
  if (!file) return null;
  return {
    id: file.id,
    name: file.name,
    url: file.webViewLink || `https://drive.google.com/drive/folders/${file.id}`,
  };
}

async function createFolder(accessToken, name, parentId) {
  const body = { name, mimeType: FOLDER_MIME };
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

export async function ensureFolder(accessToken, name, parentId) {
  return (await findFolderByName(accessToken, name, parentId)) || createFolder(accessToken, name, parentId);
}

export async function ensureRootFolder(accessToken) {
  return ensureFolder(accessToken, ROOT_FOLDER_NAME);
}

export async function listMatterFolders(accessToken) {
  const root = await ensureRootFolder(accessToken);
  const q = `'${escapeDriveQuery(root.id)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,webViewLink)',
    pageSize: '200',
    orderBy: 'name',
  });
  const data = await driveFetch(accessToken, `/files?${params.toString()}`);
  return (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    url: f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`,
  }));
}

export async function uploadFile(accessToken, {
  blob,
  filename,
  contentType = 'application/octet-stream',
  parentFolderId,
  appProperties = {},
}) {
  if (!parentFolderId) throw new Error('parentFolderId is required');
  const metadata = { name: filename, parents: [parentFolderId], appProperties };
  const boundary = `-------spherical-${Date.now().toString(36)}`;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);

  const res = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message || `Drive upload failed: ${res.status}`);
  }
  const data = await res.json();
  return {
    id: data.id,
    name: data.name,
    url: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
  };
}
