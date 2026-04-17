import { useState, useRef, useEffect } from 'react';
import type { CaseChatMessage, CaseDocument, IndustryType } from '../types.ts';

interface CaseChatProps {
  messages: CaseChatMessage[];
  documents: CaseDocument[];
  industry: IndustryType;
  caseTitle: string;
  clientName: string;
  pendingTasks: number;
  prefillMessage?: string;
  revisionTarget?: 'doc' | 'slides' | null;
  onSend: (message: string) => Promise<void>;
  onClear: () => void;
  sending: boolean;
}

export default function CaseChat({
  messages,
  documents,
  industry: _industry,
  caseTitle: _caseTitle,
  clientName: _clientName,
  pendingTasks: _pendingTasks,
  prefillMessage,
  revisionTarget,
  onSend,
  onClear,
  sending,
}: CaseChatProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  useEffect(() => {
    if (!prefillMessage) return;
    setInput(prefillMessage);
    inputRef.current?.focus();
  }, [prefillMessage]);

  function handleSubmit() {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    onSend(text);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const quickPrompts = documents.length > 0
    ? [
        'Summarize all documents',
        'What are the key dates?',
        'Flag any issues',
        'Draft a summary email',
      ]
    : [
        'What should I do first?',
        'Summarize this case',
        'What information is missing?',
      ];

  return (
    <div className="case-chat">
      <div className="case-chat-messages">
        {messages.length === 0 && (
          <div className="case-chat-welcome">
            <div className="case-chat-welcome-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round">
                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 10 14.556l-.548-.547z" />
              </svg>
            </div>
            <p>Ask me anything about this case{documents.length > 0 ? ` or the ${documents.length} document${documents.length > 1 ? 's' : ''} on file` : ''}.</p>
            <div className="case-chat-quick-prompts">
              {quickPrompts.map((prompt) => (
                <button key={prompt} className="case-chat-quick" onClick={() => onSend(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`case-chat-msg ${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="case-chat-avatar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 10 14.556l-.548-.547z" />
                </svg>
              </div>
            )}
            <div className={`case-chat-bubble ${msg.role}`}>
              {msg.text}
            </div>
          </div>
        ))}

        {sending && (
          <div className="case-chat-msg assistant">
            <div className="case-chat-avatar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
                <path d="M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 10 14.556l-.548-.547z" />
              </svg>
            </div>
            <div className="case-chat-bubble assistant">
              <div className="typing"><span /><span /><span /></div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="case-chat-input-area">
        {revisionTarget && (
          <div className="case-chat-revision-banner">
            Editing linked Google {revisionTarget === 'doc' ? 'Doc' : 'Slides'} directly on send.
          </div>
        )}
        {messages.length > 0 && (
          <button className="case-chat-clear" onClick={onClear} title="Clear chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        )}
        <textarea
          ref={inputRef}
          className="case-chat-input"
          placeholder="Ask about this case..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className="case-chat-send"
          onClick={handleSubmit}
          disabled={!input.trim() || sending}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
