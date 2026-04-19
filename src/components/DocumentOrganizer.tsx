import { useMemo, useState, useEffect } from 'react';
import type { CalendarEvent, DocCategory, IndustryType } from '../types.ts';
import { listAllDocuments, getCategoriesForIndustry, getIndustry, type OrganizedDocument } from '../lib/caseStore.ts';
import { getCaseNumberFromEvent, getClientNameFromSummary, parseServiceType } from '../lib/calendar.ts';
import { findMatterFolder, listMatterFolderFiles, mapDriveFilesToCaseDocuments } from '../lib/docs.ts';

interface DocumentOrganizerProps {
  events: CalendarEvent[];
  onOpenMatter: (event: CalendarEvent) => void;
  onBack: () => void;
  accessToken: string;
}

interface MatterLookup {
  label: string;
  event: CalendarEvent | null;
}

export default function DocumentOrganizer({ events, onOpenMatter, onBack, accessToken }: DocumentOrganizerProps) {
  const industry: IndustryType = getIndustry();
  const categories = getCategoriesForIndustry(industry);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<DocCategory | 'all'>('all');
  const [matterFilter, setMatterFilter] = useState<string>('all');
  const [allDocs, setAllDocs] = useState<OrganizedDocument[]>(() => listAllDocuments());

  useEffect(() => {
    let cancelled = false;

    async function loadFromDrive() {
      try {
        const docsByMatter = await Promise.all(events.map(async (event) => {
          const client = getClientNameFromSummary(event.summary) || 'Unknown Client';
          const caseNo = getCaseNumberFromEvent(event);
          const matterCode = !caseNo
            ? (event.extendedProperties?.private?.sphericalMatterType || parseServiceType(event.summary) || 'gen')
            : undefined;
          const folder = await findMatterFolder(accessToken, client, caseNo, matterCode);
          if (!folder) return [] as OrganizedDocument[];
          const files = await listMatterFolderFiles(accessToken, folder.id);
          return mapDriveFilesToCaseDocuments(files).map((doc) => ({ ...doc, eventId: event.id }));
        }));

        const driveDocs = docsByMatter.flat();
        const localDocs = listAllDocuments();
        const driveIds = new Set(driveDocs.map((d) => d.driveFileId || d.id));
        const localOnly = localDocs.filter((d) => !d.driveFileId || !driveIds.has(d.driveFileId));
        const merged = [...driveDocs, ...localOnly].sort(
          (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
        );
        if (!cancelled) setAllDocs(merged);
      } catch (err) {
        console.warn('Failed to load organizer docs from Drive, using local cache', err);
        if (!cancelled) setAllDocs(listAllDocuments());
      }
    }

    void loadFromDrive();
    return () => {
      cancelled = true;
    };
  }, [accessToken, events]);

  const matterByEventId = useMemo(() => {
    const map = new Map<string, MatterLookup>();
    for (const event of events) {
      const client = getClientNameFromSummary(event.summary);
      const service = parseServiceType(event.summary);
      const label = client ? `${client} — ${service}` : service;
      map.set(event.id, { label, event });
    }
    return map;
  }, [events]);

  function getMatterLabel(eventId: string): string {
    return matterByEventId.get(eventId)?.label || 'Unlinked matter';
  }

  const mattersPresent = useMemo(() => {
    const eventIds = new Set(allDocs.map((d) => d.eventId));
    return Array.from(eventIds).map((id) => ({
      eventId: id,
      label: getMatterLabel(id),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDocs, matterByEventId]);

  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allDocs.filter((doc) => {
      if (categoryFilter !== 'all' && doc.category !== categoryFilter) return false;
      if (matterFilter !== 'all' && doc.eventId !== matterFilter) return false;
      if (!q) return true;
      const hay = `${doc.name} ${doc.category} ${getMatterLabel(doc.eventId)}`.toLowerCase();
      return hay.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDocs, query, categoryFilter, matterFilter, matterByEventId]);

  const categoryStats = useMemo(() => {
    const stats = new Map<DocCategory, number>();
    for (const doc of allDocs) {
      stats.set(doc.category, (stats.get(doc.category) || 0) + 1);
    }
    return stats;
  }, [allDocs]);

  const grouped = useMemo(() => {
    const byCategory = new Map<DocCategory, OrganizedDocument[]>();
    for (const doc of filteredDocs) {
      const list = byCategory.get(doc.category) || [];
      list.push(doc);
      byCategory.set(doc.category, list);
    }
    return byCategory;
  }, [filteredDocs]);

  function handleOpen(doc: OrganizedDocument) {
    const entry = matterByEventId.get(doc.eventId);
    if (entry?.event) onOpenMatter(entry.event);
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const totalDocs = allDocs.length;
  const totalMatters = mattersPresent.length;

  return (
    <main className="dashboard document-organizer">
      <div className="dashboard-header">
        <div>
          <h2>Document Organizer</h2>
          <p className="subtitle">
            Every document across every matter — auto-organized by AI on upload
          </p>
        </div>
        <div className="dashboard-actions">
          <button className="btn-secondary" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M10 3 5 8l5 5" />
            </svg>
            Back to dashboard
          </button>
        </div>
      </div>

      <section className="insight-grid">
        <div className="insight-card insight-today">
          <span className="insight-label">Documents</span>
          <strong>{totalDocs}</strong>
          <p>Filed across every matter</p>
        </div>
        <div className="insight-card insight-week">
          <span className="insight-label">Matters</span>
          <strong>{totalMatters}</strong>
          <p>With at least one document on file</p>
        </div>
        <div className="insight-card">
          <span className="insight-label">Categories</span>
          <strong>{categoryStats.size}</strong>
          <p>In active use across the library</p>
        </div>
      </section>

      <section className="organizer-toolbar">
        <input
          type="search"
          className="organizer-search"
          placeholder="Search by file name, matter, or category…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="organizer-select"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as DocCategory | 'all')}
        >
          <option value="all">All categories</option>
          {categories.map((cat) => (
            <option key={cat.key} value={cat.key}>
              {cat.icon} {cat.label} ({categoryStats.get(cat.key) || 0})
            </option>
          ))}
        </select>
        <select
          className="organizer-select"
          value={matterFilter}
          onChange={(e) => setMatterFilter(e.target.value)}
        >
          <option value="all">All matters</option>
          {mattersPresent.map((m) => (
            <option key={m.eventId} value={m.eventId}>
              {m.label}
            </option>
          ))}
        </select>
      </section>

      {totalDocs === 0 ? (
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <h3>No documents yet</h3>
          <p className="subtitle">Open a matter and drop a PDF — it'll be categorized automatically and land here.</p>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="empty-state">
          <h3>No matches</h3>
          <p className="subtitle">Try a different search term or clear the filters.</p>
        </div>
      ) : (
        <div className="organizer-columns">
          {categories.map((cat) => {
            const docs = grouped.get(cat.key);
            if (!docs || docs.length === 0) return null;
            return (
              <div key={cat.key} className="organizer-column">
                <div className="organizer-column-header">
                  <span className="organizer-column-icon">{cat.icon}</span>
                  <h3>{cat.label}</h3>
                  <span className="organizer-column-count">{docs.length}</span>
                </div>
                <div className="organizer-doc-list">
                  {docs.map((doc) => (
                    <button
                      key={doc.id}
                      className="organizer-doc-card"
                      onClick={() => handleOpen(doc)}
                      title="Open matter"
                    >
                      <div className="organizer-doc-main">
                        <span className="organizer-doc-name">{doc.name}</span>
                        {doc.aiSummary && (
                          <span className="organizer-doc-summary">{doc.aiSummary}</span>
                        )}
                        <span className="organizer-doc-matter">
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" opacity="0.6">
                            <path d="M2 4a2 2 0 0 1 2-2h4l2 2h4a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z" />
                          </svg>
                          {getMatterLabel(doc.eventId)}
                        </span>
                      </div>
                      <span className="organizer-doc-meta">
                        {formatSize(doc.size)} · {new Date(doc.uploadedAt).toLocaleDateString()}
                        {doc.driveUrl && (
                          <>
                            {' '}·{' '}
                            <a
                              className="organizer-doc-drive"
                              href={doc.driveUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Drive ↗
                            </a>
                          </>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
