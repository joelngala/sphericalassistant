import { useState } from 'react';
import type { CaseTask, IndustryType } from '../types.ts';

export type TaskActionType = 'email' | 'doc' | 'slides' | 'chat';

interface CaseTasksProps {
  tasks: CaseTask[];
  suggestions: string[];
  industry: IndustryType;
  onToggle: (taskId: string) => void;
  onAdd: (label: string) => void;
  onRemove: (taskId: string) => void;
  onAcceptSuggestion: (label: string) => void;
  onDismissSuggestion: (label: string) => void;
  onAcceptAllSuggestions: () => void;
  onSuggest: () => void;
  suggesting: boolean;
  onTaskAction: (task: CaseTask, action: TaskActionType) => void;
  taskActionLoading: Record<string, TaskActionType | null>;
}

export default function CaseTasks({
  tasks,
  suggestions,
  industry: _industry,
  onToggle,
  onAdd,
  onRemove,
  onAcceptSuggestion,
  onDismissSuggestion,
  onAcceptAllSuggestions,
  onSuggest,
  suggesting,
  onTaskAction,
  taskActionLoading,
}: CaseTasksProps) {
  const [newTask, setNewTask] = useState('');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const pending = tasks.filter((t) => !t.done);
  const completed = tasks.filter((t) => t.done);
  const progress = tasks.length ? Math.round((completed.length / tasks.length) * 100) : 0;

  function handleAdd() {
    const label = newTask.trim();
    if (!label) return;
    onAdd(label);
    setNewTask('');
  }

  return (
    <div className="case-tasks">
      {tasks.length > 0 && (
        <div className="case-tasks-progress">
          <div className="case-tasks-progress-bar">
            <div className="case-tasks-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="case-tasks-progress-label">{completed.length}/{tasks.length} complete</span>
        </div>
      )}

      <div className="case-tasks-add">
        <input
          type="text"
          placeholder="Add a task..."
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
        />
        <button className="btn-primary btn-sm" onClick={handleAdd} disabled={!newTask.trim()}>Add</button>
        <button className="btn-secondary btn-sm" onClick={onSuggest} disabled={suggesting}>
          {suggesting ? (
            <div className="spinner-sm" />
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 10 14.556l-.548-.547z" />
              </svg>
              AI Suggest
            </>
          )}
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="case-tasks-suggestions">
          <div className="case-tasks-suggestions-header">
            <h4>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 10 14.556l-.548-.547z" />
              </svg>
              Suggested ({suggestions.length})
            </h4>
            <button className="case-tasks-accept-all" onClick={onAcceptAllSuggestions}>
              Accept all
            </button>
          </div>
          <p className="case-tasks-suggestions-hint">
            Review and add the ones that apply to this case.
          </p>
          <ul className="case-tasks-suggestions-list">
            {suggestions.map((label) => (
              <li key={label} className="case-tasks-suggestion-item">
                <span className="case-tasks-suggestion-label">{label}</span>
                <div className="case-tasks-suggestion-actions">
                  <button
                    className="case-tasks-suggestion-accept"
                    onClick={() => onAcceptSuggestion(label)}
                    title="Add to tasks"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Add
                  </button>
                  <button
                    className="case-tasks-suggestion-dismiss"
                    onClick={() => onDismissSuggestion(label)}
                    title="Dismiss"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pending.length > 0 && (
        <div className="case-tasks-section">
          <h4>Pending ({pending.length})</h4>
          <ul className="case-tasks-list">
            {pending.map((task) => {
              const expanded = expandedTaskId === task.id;
              const loadingAction = taskActionLoading[task.id] ?? null;
              return (
                <li key={task.id} className={`case-task-item ${expanded ? 'expanded' : ''}`}>
                  <div className="case-task-row">
                    <label className="case-task-check">
                      <input type="checkbox" checked={false} onChange={() => onToggle(task.id)} />
                      <span className="case-task-label">{task.label}</span>
                    </label>
                    <div className="case-task-row-actions">
                      <button
                        className="case-task-help"
                        onClick={() => setExpandedTaskId(expanded ? null : task.id)}
                        title={expanded ? 'Hide actions' : 'Help me with this'}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 10 14.556l-.548-.547z" />
                        </svg>
                        {expanded ? 'Hide' : 'Help with this'}
                      </button>
                      <button className="case-task-remove" onClick={() => onRemove(task.id)} title="Remove">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <div className="case-task-actions">
                      <button
                        className="case-task-action"
                        onClick={() => onTaskAction(task, 'email')}
                        disabled={loadingAction !== null}
                      >
                        {loadingAction === 'email' ? <div className="spinner-sm" /> : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" />
                          </svg>
                        )}
                        Draft email
                      </button>
                      <button
                        className="case-task-action"
                        onClick={() => onTaskAction(task, 'doc')}
                        disabled={loadingAction !== null}
                      >
                        {loadingAction === 'doc' ? <div className="spinner-sm" /> : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                          </svg>
                        )}
                        Create Doc
                      </button>
                      <button
                        className="case-task-action"
                        onClick={() => onTaskAction(task, 'slides')}
                        disabled={loadingAction !== null}
                      >
                        {loadingAction === 'slides' ? <div className="spinner-sm" /> : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                            <line x1="8" y1="21" x2="16" y2="21" />
                            <line x1="12" y1="17" x2="12" y2="21" />
                          </svg>
                        )}
                        Create Slides
                      </button>
                      <button
                        className="case-task-action"
                        onClick={() => onTaskAction(task, 'chat')}
                        disabled={loadingAction !== null}
                      >
                        {loadingAction === 'chat' ? <div className="spinner-sm" /> : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                        )}
                        Ask AI
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {completed.length > 0 && (
        <div className="case-tasks-section case-tasks-completed">
          <h4>Completed ({completed.length})</h4>
          <ul className="case-tasks-list">
            {completed.map((task) => (
              <li key={task.id} className="case-task-item done">
                <label className="case-task-check">
                  <input type="checkbox" checked onChange={() => onToggle(task.id)} />
                  <span className="case-task-label">{task.label}</span>
                </label>
                {task.completedAt && (
                  <span className="case-task-date">{new Date(task.completedAt).toLocaleDateString()}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tasks.length === 0 && suggestions.length === 0 && (
        <div className="case-tasks-empty">
          <p>No tasks yet. Add one or let AI suggest tasks for this case.</p>
        </div>
      )}
    </div>
  );
}
