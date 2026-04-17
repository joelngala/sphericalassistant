import type {
  BillingInterval,
  BillingStatus,
  PaymentPlan,
  PaymentInvoice,
} from '../types.ts';

// Threshold at which repeated payment failures flip the plan to "paused" and
// the case UI shows "Representation Paused". Stripe's default dunning retries
// 4 times over ~3 weeks; we mirror that feel with a 3-strike rule for the demo.
export const FAILURE_PAUSE_THRESHOLD = 3;

export const INTERVAL_LABELS: Record<BillingInterval, string> = {
  weekly: 'week',
  biweekly: '2 weeks',
  monthly: 'month',
  quarterly: 'quarter',
};

export function intervalAdverb(interval: BillingInterval): string {
  const adverbs: Record<BillingInterval, string> = {
    weekly: 'Weekly',
    biweekly: 'Every 2 weeks',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
  };
  return adverbs[interval];
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

export function addInterval(iso: string, interval: BillingInterval): string {
  const d = new Date(iso);
  switch (interval) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'quarterly':
      d.setMonth(d.getMonth() + 3);
      break;
  }
  return d.toISOString();
}

export function formatAmount(cents: number, currency = 'usd'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function statusLabel(status: BillingStatus): string {
  const labels: Record<BillingStatus, string> = {
    active: 'Active',
    trialing: 'Retainer period',
    past_due: 'Past due',
    paused: 'Representation paused',
    canceled: 'Canceled',
  };
  return labels[status];
}

export function statusCls(status: BillingStatus): string {
  // Maps to existing badge classes in index.css
  switch (status) {
    case 'active':
      return 'badge-confirmed';
    case 'trialing':
      return 'badge-followedup';
    case 'past_due':
      return 'badge-reminded';
    case 'paused':
      return 'badge-new';
    case 'canceled':
      return 'badge-completed';
  }
}

export interface CreatePlanInput {
  clientName: string;
  clientEmail: string;
  amountCents: number;
  currency?: string;
  interval: BillingInterval;
  startDate: string;
  upfrontRetainerCents?: number;
  notes?: string;
}

export function createMockPlan(input: CreatePlanInput): PaymentPlan {
  const nowIso = now();
  const invoices: PaymentInvoice[] = [];
  let status: BillingStatus = 'active';

  if (input.upfrontRetainerCents && input.upfrontRetainerCents > 0) {
    invoices.push({
      id: uid('in'),
      amountCents: input.upfrontRetainerCents,
      currency: input.currency || 'usd',
      status: 'paid',
      createdAt: nowIso,
      paidAt: nowIso,
      description: 'Upfront retainer',
    });
    status = 'trialing';
  }

  return {
    id: uid('plan'),
    stripeCustomerId: uid('cus'),
    stripeSubscriptionId: uid('sub'),
    stripePriceId: uid('price'),
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    amountCents: input.amountCents,
    currency: input.currency || 'usd',
    interval: input.interval,
    upfrontRetainerCents: input.upfrontRetainerCents,
    startDate: input.startDate,
    nextChargeDate: input.startDate,
    status,
    failureCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    invoices,
    notes: input.notes,
  };
}

export function simulateSuccessfulCharge(plan: PaymentPlan): PaymentPlan {
  const nowIso = now();
  const invoice: PaymentInvoice = {
    id: uid('in'),
    amountCents: plan.amountCents,
    currency: plan.currency,
    status: 'paid',
    createdAt: nowIso,
    paidAt: nowIso,
    description: `${intervalAdverb(plan.interval)} charge`,
  };
  return {
    ...plan,
    invoices: [invoice, ...plan.invoices],
    status: 'active',
    failureCount: 0,
    nextChargeDate: addInterval(plan.nextChargeDate || nowIso, plan.interval),
    updatedAt: nowIso,
  };
}

export function simulateFailedCharge(plan: PaymentPlan): PaymentPlan {
  const nowIso = now();
  const failureCount = plan.failureCount + 1;
  const invoice: PaymentInvoice = {
    id: uid('in'),
    amountCents: plan.amountCents,
    currency: plan.currency,
    status: 'failed',
    createdAt: nowIso,
    failedAt: nowIso,
    description: `Attempt ${failureCount} — card declined`,
  };
  const shouldPause = failureCount >= FAILURE_PAUSE_THRESHOLD;
  return {
    ...plan,
    invoices: [invoice, ...plan.invoices],
    status: shouldPause ? 'paused' : 'past_due',
    pausedAt: shouldPause ? nowIso : plan.pausedAt,
    failureCount,
    updatedAt: nowIso,
  };
}

export function pausePlan(plan: PaymentPlan): PaymentPlan {
  const nowIso = now();
  return { ...plan, status: 'paused', pausedAt: nowIso, updatedAt: nowIso };
}

export function resumePlan(plan: PaymentPlan): PaymentPlan {
  const nowIso = now();
  return {
    ...plan,
    status: 'active',
    failureCount: 0,
    pausedAt: undefined,
    updatedAt: nowIso,
  };
}

export function cancelPlan(plan: PaymentPlan): PaymentPlan {
  const nowIso = now();
  return {
    ...plan,
    status: 'canceled',
    canceledAt: nowIso,
    nextChargeDate: undefined,
    updatedAt: nowIso,
  };
}
