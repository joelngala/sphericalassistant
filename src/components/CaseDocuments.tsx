import { useState, useRef } from 'react';
import type { CaseDocument, IndustryType, DocCategory } from '../types.ts';
import type { MatterFolderPin } from '../lib/calendar.ts';
import type { DriveFolderRef } from '../lib/docs.ts';
import { getCategoriesForIndustry } from '../lib/caseStore.ts';

interface CaseDocumentsProps {
  documents: CaseDocument[];
  industry: IndustryType;
  onUpload: (file: File) => Promise<void>;
  onRemove: (docId: string) => void;
  uploading: boolean;
  driveFolderUrl?: string;
  driveFolderName?: string;
  matterPin?: MatterFolderPin | null;
  availableMatters?: DriveFolderRef[];
  mattersLoading?: boolean;
  pinBusy?: boolean;
  onAttachMatter?: (folderId: string) => Promise<void> | void;
  onDetachMatter?: () => Promise<void> | void;
  onRefreshMatters?: () => Promise<void> | void;
}

export default function CaseDocuments({
  documents,
  industry,
  onUpload,
  onRemove,
  uploading,
  driveFolderUrl,
  driveFolderName,
  matterPin,
  availableMatters = [],
  mattersLoading = false,
  pinBusy = false,
  onAttachMatter,
  onDetachMatter,
  onRefreshMatters,
}: CaseDocumentsProps) {
  const [dragOver, setDragOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickedFolderId, setPickedFolderId] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const categories = getCategoriesForIndustry(industry);

  const grouped = new Map<DocCategory, CaseDocument[]>();
  for (const doc of documents) {
    const list = grouped.get(doc.category) || [];
    list.push(doc);
    grouped.set(doc.category, list);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    if (inputRef.current) inputRef.current.value = '';
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const canAttach = !!onAttachMatter;

  async function handleConfirmAttach() {
    if (!pickedFolderId || !onAttachMatter) return;
    await onAttachMatter(pickedFolderId);
    setPicking(false);
    setPickedFolderId('');
  }

  return (
    <div className="case-docs">
      {canAttach && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 12px',
            border: '1px solid var(--border, #2a2a33)',
            borderRadius: 8,
            marginBottom: 10,
            background: 'var(--bg-subtle, rgba(255,255,255,0.03))',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 16 }}>{matterPin ? '📎' : '📁'}</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted, #9aa)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {matterPin
                ? <>Pinned matter: <strong style={{ color: 'var(--text, #eee)' }}>{matterPin.name || matterPin.id}</strong></>
                : <>No matter attached. Docs go to <strong>{driveFolderName || 'default folder'}</strong> until you attach one.</>}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!picking && (
              <button
                type="button"
                onClick={() => {
                  setPicking(true);
                  setPickedFolderId(matterPin?.id || '');
                  onRefreshMatters?.();
                }}
                disabled={pinBusy}
                style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border, #2a2a33)', background: 'transparent', color: 'var(--text, #eee)', cursor: 'pointer' }}
              >
                {matterPin ? 'Change' : 'Attach matter'}
              </button>
            )}
            {matterPin && !picking && (
              <button
                type="button"
                onClick={() => onDetachMatter?.()}
                disabled={pinBusy}
                style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border, #2a2a33)', background: 'transparent', color: 'var(--text-muted, #9aa)', cursor: 'pointer' }}
              >
                Detach
              </button>
            )}
          </div>
          {picking && (
            <div style={{ flexBasis: '100%', display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={pickedFolderId}
                onChange={(e) => setPickedFolderId(e.target.value)}
                disabled={mattersLoading || pinBusy}
                style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border, #2a2a33)', background: 'var(--bg, #111)', color: 'var(--text, #eee)', fontSize: 13 }}
              >
                <option value="">{mattersLoading ? 'Loading matters…' : availableMatters.length ? 'Pick a matter folder…' : 'No matter folders yet'}</option>
                {availableMatters.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleConfirmAttach}
                disabled={!pickedFolderId || pinBusy || pickedFolderId === matterPin?.id}
                style={{ padding: '6px 12px', fontSize: 12, borderRadius: 6, border: 'none', background: '#1a73e8', color: '#fff', cursor: 'pointer' }}
              >
                {pinBusy ? 'Saving…' : 'Attach'}
              </button>
              <button
                type="button"
                onClick={() => { setPicking(false); setPickedFolderId(''); }}
                disabled={pinBusy}
                style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border, #2a2a33)', background: 'transparent', color: 'var(--text-muted, #9aa)', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
      {driveFolderUrl && (
        <a
          className="case-docs-drive-link"
          href={driveFolderUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span>Open matter folder{driveFolderName ? `: ${driveFolderName}` : ''} in Google Drive</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17L17 7M9 7h8v8" />
          </svg>
        </a>
      )}
      <div
        className={`case-docs-upload ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <div className="case-docs-upload-loading">
            <div className="spinner-sm" />
            <span>Parsing & categorizing...</span>
          </div>
        ) : (
          <>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Drop file here or click to upload</span>
            <span className="case-docs-upload-hint">PDF, DOCX, or TXT</span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt"
          onChange={handleFileSelect}
          hidden
        />
      </div>

      {documents.length > 0 ? (
        <div className="case-docs-categories">
          {categories.map((cat) => {
            const docs = grouped.get(cat.key);
            if (!docs || docs.length === 0) return null;
            return (
              <div key={cat.key} className="case-docs-category">
                <h4>
                  <span className="case-docs-cat-icon">{cat.icon}</span>
                  {cat.label}
                  <span className="case-docs-count">{docs.length}</span>
                </h4>
                <ul className="case-docs-list">
                  {docs.map((doc) => (
                    <li key={doc.id} className="case-doc-item">
                      <div className="case-doc-info">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <div>
                          <span className="case-doc-name">{doc.name}</span>
                          {doc.aiSummary && (
                            <span className="case-doc-summary">{doc.aiSummary}</span>
                          )}
                          <span className="case-doc-meta">
                            {formatSize(doc.size)} &middot; {new Date(doc.uploadedAt).toLocaleDateString()}
                            {doc.driveUrl && (
                              <>
                                {' '}&middot;{' '}
                                <a
                                  className="case-doc-drive"
                                  href={doc.driveUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Open in Drive
                                </a>
                              </>
                            )}
                          </span>
                        </div>
                      </div>
                      <button className="case-doc-remove" onClick={() => onRemove(doc.id)} title="Remove">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="case-docs-empty">
          <p>No documents yet. Upload files to organize them by category.</p>
        </div>
      )}
    </div>
  );
}
