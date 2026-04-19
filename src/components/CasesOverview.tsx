import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, WorkflowStatus } from '../types.ts';
import {
  formatEventTime,
  getCaseNumberFromEvent,
  getClientNameFromSummary,
  getCourtRecords,
  getEventDateTime,
  getWorkflowState,
  parseServiceType,
} from '../lib/calendar.ts';
import { loadCase } from '../lib/caseStore.ts';
import { formatAmount, statusCls, statusLabel } from '../lib/billing.ts';
import { buildMatterFolderName, findMatterFolder, listMatterFolderFiles } from '../lib/docs.ts';

interface CasesOverviewProps {
  events: CalendarEvent[];
  accessToken: string;
  onOpenMatter: (event: CalendarEvent) => void;
}

type WorkflowFilter = 'all' | WorkflowStatus;
type PaymentFilter = 'all' | 'no-plan' | 'active' | 'trialing' | 'past_due' | 'paused' | 'canceled';

interface CaseRow {
  event: CalendarEvent;
  workflow: ReturnType<typeof getWorkflowState>;
  clientName: string;
  matter: string;
  caseNumber: string;
  upcomingLabel: string;
  upcomingSort: number;
  docsCount: number;
  docsLoading: boolean;
  openTasks: number;
  paymentBucket: PaymentFilter;
  paymentLabel: string;
  paymentBadgeClass: string;
  paymentDetail: string;
  hasEmail: boolean;
  hasLocation: boolean;
  urgent: boolean;
  conflictFlagged: boolean;
  courtRecordsCount: number;
  courtHearingsCount: number;
  driveFolderName: string;
  driveFolderUrl: string;
}

const WORKFLOW_LABELS: Record<WorkflowStatus, string> = {
  new: 'New',
  confirmed: 'Confirmed',
  reminded: 'Reminded',
  completed: 'Completed',
  'followed-up': 'Followed Up',
};

const WORKFLOW_BADGE_CLASS: Record<WorkflowStatus, string> = {
  new: 'badge-new',
  confirmed: 'badge-confirmed',
  reminded: 'badge-reminded',
  completed: 'badge-completed',
  'followed-up': 'badge-followedup',
};

function paymentBucketFromStatus(status: string | undefined): PaymentFilter {
  if (!status) return 'no-plan';
  if (status === 'active' || status === 'trialing' || status === 'past_due' || status === 'paused' || status === 'canceled') {
    return status;
  }
  return 'no-plan';
}

export default function CasesOverview({ events, accessToken, onOpenMatter }: CasesOverviewProps) {
  const [query, setQuery] = useState('');
  const [workflowFilter, setWorkflowFilter] = useState<WorkflowFilter>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [driveDocCountByEventId, setDriveDocCountByEventId] = useState<Record<string, number>>({});
  const [driveFolderUrlByEventId, setDriveFolderUrlByEventId] = useState<Record<string, string>>({});
  const [loadingDriveDocs, setLoadingDriveDocs] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadDriveCounts() {
      setLoadingDriveDocs(true);
      try {
        const results = await Promise.all(events.map(async (event) => {
          const client = getClientNameFromSummary(event.summary) || 'Unknown Client';
          const caseNo = getCaseNumberFromEvent(event);
          const matterCode = !caseNo
            ? (event.extendedProperties?.private?.sphericalMatterType || parseServiceType(event.summary) || 'gen')
            : undefined;
          const folder = await findMatterFolder(accessToken, client, caseNo, matterCode);
          if (!folder) return { eventId: event.id, count: 0, folderUrl: '' };
          const files = await listMatterFolderFiles(accessToken, folder.id);
          return { eventId: event.id, count: files.length, folderUrl: folder.url };
        }));

        if (cancelled) return;
        const counts: Record<string, number> = {};
        const urls: Record<string, string> = {};
        for (const r of results) {
          counts[r.eventId] = r.count;
          urls[r.eventId] = r.folderUrl;
        }
        setDriveDocCountByEventId(counts);
        setDriveFolderUrlByEventId(urls);
      } catch (err) {
        console.warn('Failed to load drive doc counts for cases view:', err);
      } finally {
        if (!cancelled) setLoadingDriveDocs(false);
      }
    }

    void loadDriveCounts();
    return () => {
      cancelled = true;
    };
  }, [accessToken, events]);

  const rows = useMemo<CaseRow[]>(() => {
    return events
      .map((event) => {
        const workflow = getWorkflowState(event);
        const clientName = getClientNameFromSummary(event.summary) || 'Unknown Client';
        const matter = parseServiceType(event.summary);
        const caseNumber = getCaseNumberFromEvent(event);
        const eventDate = getEventDateTime(event);
        const caseData = loadCase(event.id);
        const openTasks = caseData.tasks.filter((t) => !t.done).length;
        const plan = caseData.paymentPlan;
        const paymentBucket = paymentBucketFromStatus(plan?.status);
        const paymentLabel = plan ? statusLabel(plan.status) : 'No plan';
        const paymentBadgeClass = plan ? statusCls(plan.status) : 'badge-new';
        const paymentDetail = plan
          ? `${formatAmount(plan.amountCents, plan.currency)} / ${plan.interval}${plan.nextChargeDate ? ` • next ${new Date(plan.nextChargeDate).toLocaleDateString()}` : ''}`
          : 'No payment plan yet';
        const localDocsCount = caseData.documents.length;
        const driveDocsCount = driveDocCountByEventId[event.id];
        const docsCount = typeof driveDocsCount === 'number' ? driveDocsCount : localDocsCount;
        const hasEmail = (event.attendees || []).some((a) => !a.self && Boolean(a.email));
        const hasLocation = Boolean(event.location?.trim());
        const court = getCourtRecords(event);
        const matterCode = !caseNumber
          ? (event.extendedProperties?.private?.sphericalMatterType || matter || 'gen')
          : undefined;
        const driveFolderName = buildMatterFolderName(clientName, caseNumber, matterCode);

        return {
          event,
          workflow,
          clientName,
          matter,
          caseNumber,
          upcomingLabel: formatEventTime(event),
          upcomingSort: isNaN(eventDate.getTime()) ? Number.MAX_SAFE_INTEGER : eventDate.getTime(),
          docsCount,
          docsLoading: typeof driveDocsCount !== 'number' && loadingDriveDocs,
          openTasks,
          paymentBucket,
          paymentLabel,
          paymentBadgeClass,
          paymentDetail,
          hasEmail,
          hasLocation,
          urgent: workflow.urgent === true,
          conflictFlagged: workflow.conflictFlagged === true,
          courtRecordsCount: court?.recordsCount || 0,
          courtHearingsCount: court?.hearingsCount || 0,
          driveFolderName,
          driveFolderUrl: driveFolderUrlByEventId[event.id] || caseData.driveFolderUrl || '',
        };
      })
      .sort((a, b) => a.upcomingSort - b.upcomingSort);
  }, [events, driveDocCountByEventId, driveFolderUrlByEventId, loadingDriveDocs]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (workflowFilter !== 'all' && row.workflow.status !== workflowFilter) return false;
      if (paymentFilter !== 'all' && row.paymentBucket !== paymentFilter) return false;
      if (!needle) return true;
      const haystack = `${row.clientName} ${row.matter} ${row.caseNumber} ${row.driveFolderName}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, query, workflowFilter, paymentFilter]);

  const urgentCount = rows.filter((r) => r.urgent).length;
  const paymentRiskCount = rows.filter((r) => r.paymentBucket === 'past_due' || r.paymentBucket === 'paused').length;
  const docsAttachedCount = rows.filter((r) => r.docsCount > 0).length;

  return (
    <main className="dashboard cases-overview">
      <div className="dashboard-header">
        <div>
          <h2>Cases</h2>
          <p className="subtitle">
            Upcoming schedule, payment status, documents, and risk signals in one place.
          </p>
        </div>
      </div>

      <section className="insight-grid">
        <div className="insight-card insight-today">
          <span className="insight-label">Open matters</span>
          <strong>{rows.length}</strong>
          <p>Upcoming events currently tracked</p>
        </div>
        <div className="insight-card insight-week">
          <span className="insight-label">Urgent</span>
          <strong>{urgentCount}</strong>
          <p>Cases flagged as urgent from intake/workflow</p>
        </div>
        <div className={`insight-card insight-attention ${paymentRiskCount ? 'insight-attention-active' : ''}`}>
          <span className="insight-label">Payment risk</span>
          <strong>{paymentRiskCount}</strong>
          <p>Past-due or paused plans</p>
        </div>
        <div className="insight-card">
          <span className="insight-label">With docs</span>
          <strong>{docsAttachedCount}</strong>
          <p>Matters with attached documents</p>
        </div>
      </section>

      <section className="cases-toolbar">
        <input
          className="cases-search"
          type="search"
          placeholder="Search by client, matter, case #, or folder name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="cases-select"
          value={workflowFilter}
          onChange={(e) => setWorkflowFilter(e.target.value as WorkflowFilter)}
        >
          <option value="all">All workflow statuses</option>
          <option value="new">New</option>
          <option value="confirmed">Confirmed</option>
          <option value="reminded">Reminded</option>
          <option value="completed">Completed</option>
          <option value="followed-up">Followed up</option>
        </select>
        <select
          className="cases-select"
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
        >
          <option value="all">All payment statuses</option>
          <option value="no-plan">No plan</option>
          <option value="active">Active</option>
          <option value="trialing">Retainer period</option>
          <option value="past_due">Past due</option>
          <option value="paused">Paused</option>
          <option value="canceled">Canceled</option>
        </select>
      </section>

      {filteredRows.length === 0 ? (
        <div className="empty-state">
          <h3>No matching cases</h3>
          <p className="subtitle">Adjust filters or search terms to see cases.</p>
        </div>
      ) : (
        <section className="cases-list">
          {filteredRows.map((row) => (
            <article key={row.event.id} className="cases-card">
              <div className="cases-card-head">
                <div>
                  <h3>{row.clientName}</h3>
                  <p className="subtitle">
                    {row.matter}
                    {row.caseNumber ? ` • ${row.caseNumber}` : ''}
                  </p>
                </div>
                <div className="cases-card-badges">
                  <span className={`status-badge ${WORKFLOW_BADGE_CLASS[row.workflow.status]}`}>
                    {WORKFLOW_LABELS[row.workflow.status]}
                  </span>
                  <span className={`status-badge ${row.paymentBadgeClass}`}>{row.paymentLabel}</span>
                  {row.urgent && <span className="cases-flag cases-flag-urgent">Urgent</span>}
                  {row.conflictFlagged && <span className="cases-flag cases-flag-conflict">Conflict</span>}
                </div>
              </div>

              <div className="cases-card-grid">
                <div>
                  <div className="cases-k">Upcoming</div>
                  <div className="cases-v">{row.upcomingLabel}</div>
                </div>
                <div>
                  <div className="cases-k">Payment</div>
                  <div className="cases-v">{row.paymentDetail}</div>
                </div>
                <div>
                  <div className="cases-k">Documents attached</div>
                  <div className="cases-v">
                    {row.docsLoading ? 'Loading…' : `${row.docsCount} file${row.docsCount === 1 ? '' : 's'}`}
                  </div>
                </div>
                <div>
                  <div className="cases-k">Open tasks</div>
                  <div className="cases-v">{row.openTasks}</div>
                </div>
                <div>
                  <div className="cases-k">Contact / location</div>
                  <div className="cases-v">
                    {row.hasEmail ? 'Email on file' : 'Missing email'} • {row.hasLocation ? 'Location set' : 'Missing location'}
                  </div>
                </div>
                <div>
                  <div className="cases-k">Court signals</div>
                  <div className="cases-v">
                    {row.courtRecordsCount || row.courtHearingsCount
                      ? `${row.courtRecordsCount} records • ${row.courtHearingsCount} hearings`
                      : 'No court data'}
                  </div>
                </div>
              </div>

              <div className="cases-card-actions">
                {row.driveFolderUrl && (
                  <a
                    className="btn-secondary btn-sm"
                    href={row.driveFolderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open folder
                  </a>
                )}
                <button className="btn-primary btn-sm" onClick={() => onOpenMatter(row.event)}>
                  Open case
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
