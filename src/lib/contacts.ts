import type { ClientContact } from '../types.ts';

const PEOPLE_BASE = 'https://people.googleapis.com/v1';

async function peopleFetch<T>(accessToken: string, url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url.startsWith('http') ? url : `${PEOPLE_BASE}${url}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `People API error: ${response.status}`);
  }

  return response.json();
}

export async function lookupContactByEmail(
  accessToken: string,
  email: string
): Promise<ClientContact | null> {
  const params = new URLSearchParams({
    query: email,
    readMask: 'names,emailAddresses,phoneNumbers,addresses,organizations,photos,biographies',
    pageSize: '5',
  });

  try {
    const data = await peopleFetch<{ results?: Array<{ person: Record<string, unknown> }> }>(
      accessToken,
      `${PEOPLE_BASE}/people:searchContacts?${params}`
    );

    if (!data.results || data.results.length === 0) return null;

    const person = data.results[0].person as Record<string, unknown>;
    return extractContact(person);
  } catch {
    return null;
  }
}

export async function searchContacts(
  accessToken: string,
  query: string,
  pageSize: number = 8
): Promise<ClientContact[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const params = new URLSearchParams({
    query: trimmedQuery,
    readMask: 'names,emailAddresses,phoneNumbers,addresses,organizations,photos,biographies',
    pageSize: String(pageSize),
  });

  const data = await peopleFetch<{ results?: Array<{ person: Record<string, unknown> }> }>(
    accessToken,
    `${PEOPLE_BASE}/people:searchContacts?${params}`
  );

  return (data.results || [])
    .map((result) => extractContact(result.person as Record<string, unknown>))
    .filter((contact) => Boolean(contact.email));
}

export async function listContacts(
  accessToken: string,
  pageSize: number = 12
): Promise<ClientContact[]> {
  const params = new URLSearchParams({
    personFields: 'names,emailAddresses,phoneNumbers,addresses,organizations,photos,biographies',
    pageSize: String(pageSize),
    sortOrder: 'LAST_MODIFIED_DESCENDING',
  });

  const data = await peopleFetch<{ connections?: Array<Record<string, unknown>> }>(
    accessToken,
    `${PEOPLE_BASE}/people/me/connections?${params}`
  );

  return (data.connections || [])
    .map((person) => extractContact(person))
    .filter((contact) => Boolean(contact.email));
}

export async function createContact(
  accessToken: string,
  contact: { name: string; email: string; phone?: string; address?: string }
): Promise<ClientContact> {
  const body: Record<string, unknown> = {
    names: [{ givenName: contact.name.split(' ')[0], familyName: contact.name.split(' ').slice(1).join(' ') }],
    emailAddresses: [{ value: contact.email }],
  };

  if (contact.phone) {
    body.phoneNumbers = [{ value: contact.phone }];
  }

  if (contact.address) {
    body.addresses = [{ formattedValue: contact.address }];
  }

  const person = await peopleFetch<Record<string, unknown>>(
    accessToken,
    `${PEOPLE_BASE}/people:createContact`,
    { method: 'POST', body: JSON.stringify(body) }
  );

  return extractContact(person);
}

function extractContact(person: Record<string, unknown>): ClientContact {
  const names = person.names as Array<{ displayName?: string }> | undefined;
  const emails = person.emailAddresses as Array<{ value?: string }> | undefined;
  const phones = person.phoneNumbers as Array<{ value?: string }> | undefined;
  const addrs = person.addresses as Array<{ formattedValue?: string }> | undefined;
  const orgs = person.organizations as Array<{ name?: string }> | undefined;
  const photos = person.photos as Array<{ url?: string }> | undefined;
  const bios = person.biographies as Array<{ value?: string }> | undefined;

  return {
    resourceName: (person.resourceName as string) || '',
    name: names?.[0]?.displayName || 'Unknown',
    email: emails?.[0]?.value || '',
    phone: phones?.[0]?.value,
    address: addrs?.[0]?.formattedValue,
    organization: orgs?.[0]?.name,
    photoUrl: photos?.[0]?.url,
    notes: bios?.[0]?.value,
  };
}
