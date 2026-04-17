import { useState, useRef } from 'react';
import type { CaseDocument, IndustryType, DocCategory } from '../types.ts';
import { getCategoriesForIndustry } from '../lib/caseStore.ts';

interface CaseDocumentsProps {
  documents: CaseDocument[];
  industry: IndustryType;
  onUpload: (file: File) => Promise<void>;
  onRemove: (docId: string) => void;
  uploading: boolean;
}

export default function CaseDocuments({
  documents,
  industry,
  onUpload,
  onRemove,
  uploading,
}: CaseDocumentsProps) {
  const [dragOver, setDragOver] = useState(false);
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

  return (
    <div className="case-docs">
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
                          <span className="case-doc-meta">
                            {formatSize(doc.size)} &middot; {new Date(doc.uploadedAt).toLocaleDateString()}
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
