import { useState } from 'react';
import type { BillingInterval, PaymentPlan } from '../types.ts';
import {
  formatAmount,
  formatDate,
  intervalAdverb,
  statusCls,
  statusLabel,
  FAILURE_PAUSE_THRESHOLD,
} from '../lib/billing.ts';

interface CaseBillingProps {
  plan: PaymentPlan | undefined;
  defaultClientName: string;
  defaultClientEmail: string;
  liveMode: boolean;
  creating: boolean;
  syncing: boolean;
  onCreate: (input: {
    clientName: string;
    clientEmail: string;
    amountCents: number;
    interval: BillingInterval;
    startDate: string;
    upfrontRetainerCents?: number;
    notes?: string;
  }) => void;
  onAdjust: (input: {
    amountCents: number;
    interval: BillingInterval;
    notes?: string;
  }) => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onSimulateSuccess: () => void;
  onSimulateFailure: () => void;
  onRemove: () => void;
  onSync: () => void;
  onDraftPaymentEmail: () => void;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDollarsToCents(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  if (!isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100);
}

export default function CaseBilling({
  plan,
  defaultClientName,
  defaultClientEmail,
  liveMode,
  creating,
  syncing,
  onCreate,
  onAdjust,
  onPause,
  onResume,
  onCancel,
  onSimulateSuccess,
  onSimulateFailure,
  onRemove,
  onSync,
  onDraftPaymentEmail,
}: CaseBillingProps) {
  const [showSetup, setShowSetup] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);

  if (!plan) {
    return (
      <div className="billing-panel">
        {liveMode && <LiveModeBadge />}
        {!showSetup ? (
          <EmptyState liveMode={liveMode} onStart={() => setShowSetup(true)} />
        ) : (
          <SetupForm
            defaultClientName={defaultClientName}
            defaultClientEmail={defaultClientEmail}
            liveMode={liveMode}
            creating={creating}
            onCancel={() => setShowSetup(false)}
            onCreate={onCreate}
          />
        )}
      </div>
    );
  }

  const paidTotal = plan.invoices
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + i.amountCents, 0);
  const failedCount = plan.invoices.filter((i) => i.status === 'failed').length;
  const retainerRequired = plan.retainerRequiredCents ?? plan.upfrontRetainerCents ?? 0;
  const retainerPaid = plan.retainerPaidCents ?? 0;
  const retainerStatus = plan.retainerStatus || (retainerRequired > 0 ? 'awaiting_payment' : 'not_required');

  return (
    <div className="billing-panel">
      {liveMode && <LiveModeBadge />}

      {liveMode && plan.stripeCheckoutUrl && plan.status === 'active' && plan.invoices.length === 0 && (
        <div className="billing-pastdue-banner">
          <strong>Awaiting first payment.</strong>{' '}
          <a href={plan.stripeCheckoutUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
            Reopen Stripe Checkout
          </a>{' '}
          or share the link with the client. Use card <code>4242 4242 4242 4242</code> in test mode.
        </div>
      )}

      <div className="billing-summary">
        <div className="billing-summary-top">
          <div>
            <div className="billing-amount">
              {formatAmount(plan.amountCents, plan.currency)}
              <span className="billing-interval"> / {intervalAdverb(plan.interval).toLowerCase()}</span>
            </div>
            <div className="billing-client">
              {plan.clientName}
              {plan.clientEmail ? ` · ${plan.clientEmail}` : ''}
            </div>
          </div>
          <span className={`status-badge ${statusCls(plan.status)}`}>{statusLabel(plan.status)}</span>
        </div>

        {plan.status === 'paused' && (
          <div className="billing-paused-banner">
            <strong>Representation paused.</strong> Resume the plan once the client is current on payment.
          </div>
        )}

        {plan.status === 'past_due' && (
          <div className="billing-pastdue-banner">
            <strong>{plan.failureCount} failed payment{plan.failureCount === 1 ? '' : 's'}.</strong>{' '}
            Representation pauses automatically after {FAILURE_PAUSE_THRESHOLD} failed attempts.
          </div>
        )}

        <div className="billing-stats">
          <Stat label="Next charge" value={plan.nextChargeDate && plan.status !== 'canceled' ? formatDate(plan.nextChargeDate) : '—'} />
          <Stat label="Collected" value={formatAmount(paidTotal, plan.currency)} />
          <Stat label="Failures" value={String(failedCount)} />
          <Stat label="Started" value={formatDate(plan.startDate)} />
        </div>
        {retainerRequired > 0 && (
          <div className="billing-retainer-summary">
            <strong>Retainer:</strong>{' '}
            {formatAmount(retainerPaid, plan.currency)} / {formatAmount(retainerRequired, plan.currency)} · {retainerLabel(retainerStatus)}
          </div>
        )}

        <div className="billing-actions">
          {liveMode && plan.stripeCheckoutUrl && (
            <button
              className="btn-secondary btn-sm"
              onClick={onDraftPaymentEmail}
              disabled={!plan.clientEmail || !plan.clientEmail.includes('@')}
              title={!plan.clientEmail || !plan.clientEmail.includes('@') ? 'Add a client email first' : undefined}
            >
              Draft payment email
            </button>
          )}
          {liveMode && (plan.stripeSessionId || plan.stripeSubscriptionId) && (
            <button className="btn-secondary btn-sm" onClick={onSync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync from Stripe'}
            </button>
          )}
          {plan.status !== 'canceled' && (
            <>
              {!liveMode && (
                <button className="btn-secondary btn-sm" onClick={() => setShowAdjust((s) => !s)}>
                  {showAdjust ? 'Close adjust' : 'Adjust plan'}
                </button>
              )}
              {plan.status === 'paused' ? (
                <button className="btn-primary btn-sm" onClick={onResume}>
                  Resume representation
                </button>
              ) : (
                <button className="btn-secondary btn-sm" onClick={onPause}>
                  Pause representation
                </button>
              )}
              <button className="btn-secondary btn-sm billing-danger-btn" onClick={onCancel}>
                Cancel plan
              </button>
            </>
          )}
          {plan.status === 'canceled' && (
            <button className="btn-secondary btn-sm billing-danger-btn" onClick={onRemove}>
              Remove record
            </button>
          )}
        </div>

        {showAdjust && plan.status !== 'canceled' && (
          <AdjustForm
            plan={plan}
            onCancel={() => setShowAdjust(false)}
            onSave={(input) => {
              onAdjust(input);
              setShowAdjust(false);
            }}
          />
        )}
      </div>

      {!liveMode && plan.status !== 'canceled' && (
        <div className="billing-simulate">
          <div className="billing-simulate-header">
            <span>Demo controls</span>
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>
              Simulate Stripe webhook events
            </span>
          </div>
          <div className="billing-simulate-actions">
            <button className="btn-secondary btn-sm" onClick={onSimulateSuccess}>
              Simulate successful charge
            </button>
            <button className="btn-secondary btn-sm billing-danger-btn" onClick={onSimulateFailure}>
              Simulate failed payment
            </button>
          </div>
        </div>
      )}

      <div className="billing-invoices">
        <h3>Invoice history</h3>
        {plan.invoices.length === 0 ? (
          <p className="text-muted">No invoices yet. First charge on {formatDate(plan.startDate)}.</p>
        ) : (
          <ul className="billing-invoice-list">
            {plan.invoices.map((inv) => (
              <li key={inv.id} className={`billing-invoice billing-invoice-${inv.status}`}>
                <div className="billing-invoice-main">
                  <span className="billing-invoice-amount">{formatAmount(inv.amountCents, inv.currency)}</span>
                  <span className={`status-badge ${invoiceBadgeCls(inv.status)}`}>{inv.status}</span>
                </div>
                <div className="billing-invoice-meta">
                  <span>{inv.description || 'Subscription charge'}</span>
                  <span>{formatDate(inv.paidAt || inv.failedAt || inv.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {plan.notes && (
        <div className="billing-notes">
          <h3>Notes</h3>
          <p>{plan.notes}</p>
        </div>
      )}
    </div>
  );
}

function LiveModeBadge() {
  return (
    <div className="billing-livemode-badge">
      <span className="billing-livemode-dot" />
      Stripe Test Mode — real Stripe API, fake cards
    </div>
  );
}

function invoiceBadgeCls(status: string): string {
  if (status === 'paid') return 'badge-confirmed';
  if (status === 'failed') return 'badge-reminded';
  if (status === 'void') return 'badge-completed';
  return 'badge-new';
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="billing-stat">
      <div className="billing-stat-label">{label}</div>
      <div className="billing-stat-value">{value}</div>
    </div>
  );
}

function retainerLabel(status: string): string {
  if (status === 'paid') return 'Paid';
  if (status === 'failed') return 'Payment failed';
  if (status === 'awaiting_payment') return 'Awaiting payment';
  return 'Not required';
}

function EmptyState({ liveMode, onStart }: { liveMode: boolean; onStart: () => void }) {
  return (
    <div className="billing-empty">
      <h3>No payment plan yet</h3>
      <p className="text-muted">
        {liveMode
          ? 'Set up a custom Stripe subscription for this client. We generate a real Stripe Checkout link and the client pays with test card 4242 4242 4242 4242. Subscription state syncs back from Stripe.'
          : 'Set up a custom Stripe subscription for this client. The plan adjusts per client — weekly, monthly, or whatever fits the matter. If a payment fails, representation pauses automatically.'}
      </p>
      <button className="btn-primary" onClick={onStart}>
        Set up payment plan
      </button>
    </div>
  );
}

function SetupForm({
  defaultClientName,
  defaultClientEmail,
  liveMode,
  creating,
  onCancel,
  onCreate,
}: {
  defaultClientName: string;
  defaultClientEmail: string;
  liveMode: boolean;
  creating: boolean;
  onCancel: () => void;
  onCreate: (input: {
    clientName: string;
    clientEmail: string;
    amountCents: number;
    interval: BillingInterval;
    startDate: string;
    upfrontRetainerCents?: number;
    notes?: string;
  }) => void;
}) {
  const [clientName, setClientName] = useState(defaultClientName);
  const [clientEmail, setClientEmail] = useState(defaultClientEmail);
  const [amount, setAmount] = useState('500');
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const [startDate, setStartDate] = useState(todayIso());
  const [upfront, setUpfront] = useState('');
  const [notes, setNotes] = useState('');

  const amountCents = parseDollarsToCents(amount);
  const upfrontCents = upfront.trim() ? parseDollarsToCents(upfront) : 0;
  const valid = clientName.trim().length > 0 && amountCents > 0;

  return (
    <form
      className="billing-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onCreate({
          clientName: clientName.trim(),
          clientEmail: clientEmail.trim(),
          amountCents,
          interval,
          startDate: new Date(startDate).toISOString(),
          upfrontRetainerCents: upfrontCents > 0 ? upfrontCents : undefined,
          notes: notes.trim() || undefined,
        });
      }}
    >
      <h3>Set up payment plan</h3>

      <div className="billing-form-row">
        <label>
          Client name
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            required
          />
        </label>
        <label>
          Client email
          <input
            type="email"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            placeholder="client@example.com"
          />
        </label>
      </div>

      <div className="billing-form-row">
        <label>
          Recurring amount (USD)
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="500"
            inputMode="decimal"
            required
          />
        </label>
        <label>
          Billing frequency
          <select value={interval} onChange={(e) => setInterval(e.target.value as BillingInterval)}>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        </label>
      </div>

      <div className="billing-form-row">
        <label>
          First charge date
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </label>
        <label>
          Upfront retainer (optional)
          <input
            type="text"
            value={upfront}
            onChange={(e) => setUpfront(e.target.value)}
            placeholder="1500"
            inputMode="decimal"
          />
        </label>
      </div>

      <label>
        Notes (optional)
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Scope of representation, special terms, etc."
          rows={3}
        />
      </label>

      <div className="billing-form-actions">
        <button type="button" className="btn-secondary btn-sm" onClick={onCancel} disabled={creating}>
          Cancel
        </button>
        <button type="submit" className="btn-primary btn-sm" disabled={!valid || creating}>
          {creating ? 'Creating…' : liveMode ? 'Create plan & send payment link' : 'Create plan'}
        </button>
      </div>
    </form>
  );
}

function AdjustForm({
  plan,
  onCancel,
  onSave,
}: {
  plan: PaymentPlan;
  onCancel: () => void;
  onSave: (input: { amountCents: number; interval: BillingInterval; notes?: string }) => void;
}) {
  const [amount, setAmount] = useState((plan.amountCents / 100).toFixed(2));
  const [interval, setInterval] = useState<BillingInterval>(plan.interval);
  const [notes, setNotes] = useState(plan.notes || '');

  const amountCents = parseDollarsToCents(amount);
  const valid = amountCents > 0;

  return (
    <form
      className="billing-form billing-adjust-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSave({ amountCents, interval, notes: notes.trim() || undefined });
      }}
    >
      <div className="billing-form-row">
        <label>
          New amount (USD)
          <input type="text" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </label>
        <label>
          New frequency
          <select value={interval} onChange={(e) => setInterval(e.target.value as BillingInterval)}>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        </label>
      </div>
      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </label>
      <div className="billing-form-actions">
        <button type="button" className="btn-secondary btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary btn-sm" disabled={!valid}>
          Save changes
        </button>
      </div>
    </form>
  );
}
