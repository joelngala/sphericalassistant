import type {
  BillingInterval,
  BillingStatus,
  PaymentPlan,
  PaymentInvoice,
  RetainerStatus,
} from '../types.ts';
import { intervalAdverb } from './billing.ts';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const defaultProdApiBaseUrl = 'https://spherical-assistant-proxy.spherelabsai.workers.dev';

function getApiBaseUrl(): string {
  if (configuredApiBaseUrl) {
    return configuredApiBaseUrl.replace(/\/+$/, '');
  }
  if (import.meta.env.DEV) {
    return 'http://127.0.0.1:8787';
  }
  return defaultProdApiBaseUrl;
}

export function isStripeLiveMode(): boolean {
  return getApiBaseUrl().length > 0;
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) throw new Error('Billing service is not configured for this deployment.');

  const init: RequestInit = {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };

  const response = await fetch(`${base}${path}`, init);
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error || `Billing request failed (${response.status})`);
  }
  return payload as T;
}

export interface CheckoutResponse {
  checkoutUrl: string;
  sessionId: string;
  customerId: string;
  productId: string;
  priceId: string;
  retainerPriceId: string | null;
}

export async function createCheckoutSession(input: {
  clientName: string;
  clientEmail: string;
  amountCents: number;
  interval: BillingInterval;
  upfrontRetainerCents?: number;
  eventId: string;
  notes?: string;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<CheckoutResponse> {
  return request<CheckoutResponse>('POST', '/billing/checkout', input);
}

export interface RemoteInvoice {
  id: string;
  amountPaid: number;
  amountDue: number;
  currency: string;
  status: 'paid' | 'open' | 'uncollectible' | 'void' | 'draft';
  includesRetainer?: boolean;
  retainerAmount?: number;
  created: number;
  hostedInvoiceUrl: string | null;
  attempted: boolean;
  attemptCount: number;
  description: string | null;
}

export interface SubscriptionSync {
  subscriptionId: string | null;
  customerId?: string;
  status: string;
  currentPeriodEnd?: number;
  cancelAt?: number | null;
  pauseCollection?: string | null;
  latestInvoiceId?: string;
  invoices: RemoteInvoice[];
  checkoutStatus?: string;
  paymentStatus?: string;
  retainer?: {
    requiredCents: number;
    paidCents: number;
    status: RetainerStatus;
  };
}

export async function syncSubscription(query: {
  sessionId?: string;
  subscriptionId?: string;
}): Promise<SubscriptionSync> {
  const params = new URLSearchParams();
  if (query.sessionId) params.set('session_id', query.sessionId);
  if (query.subscriptionId) params.set('subscription_id', query.subscriptionId);
  return request<SubscriptionSync>('GET', `/billing/subscription?${params.toString()}`);
}

export async function performAction(input: {
  subscriptionId: string;
  action: 'pause' | 'resume' | 'cancel';
}): Promise<unknown> {
  return request<unknown>('POST', '/billing/action', input);
}

function normalizeRetainerStatus(status: string | undefined): RetainerStatus {
  if (status === 'paid') return 'paid';
  if (status === 'failed') return 'failed';
  if (status === 'awaiting_payment') return 'awaiting_payment';
  return 'not_required';
}

// Map Stripe subscription status → our internal BillingStatus enum.
export function mapStripeStatus(stripeStatus: string, paused: boolean): BillingStatus {
  if (paused) return 'paused';
  switch (stripeStatus) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
      return 'past_due';
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    case 'paused':
      return 'paused';
    case 'incomplete':
      return 'trialing';
    default:
      return 'active';
  }
}

export function mergeStripeSyncIntoPlan(plan: PaymentPlan, sync: SubscriptionSync): PaymentPlan {
  const failedCount = sync.invoices.filter(
    (i) => i.status === 'open' || i.status === 'uncollectible',
  ).length;

  const mergedInvoices: PaymentInvoice[] = sync.invoices.map((inv) => {
    const paid = inv.status === 'paid';
    const failed = inv.status === 'open' || inv.status === 'uncollectible';
    const includesRetainer = Boolean(inv.includesRetainer);
    const retainerAmount = Number.isFinite(inv.retainerAmount) ? Number(inv.retainerAmount) : 0;
    return {
      id: inv.id,
      amountCents: paid ? inv.amountPaid : inv.amountDue,
      currency: inv.currency,
      status: paid ? 'paid' : failed ? 'failed' : inv.status === 'void' ? 'void' : 'open',
      includesRetainer,
      retainerAmountCents: includesRetainer ? retainerAmount : 0,
      createdAt: new Date(inv.created * 1000).toISOString(),
      paidAt: paid ? new Date(inv.created * 1000).toISOString() : undefined,
      failedAt: failed ? new Date(inv.created * 1000).toISOString() : undefined,
      description:
        inv.description ||
        (includesRetainer
          ? `Retainer + ${intervalAdverb(plan.interval).toLowerCase()} charge`
          : paid
            ? `${intervalAdverb(plan.interval)} charge`
            : 'Payment attempt'),
    };
  });

  const paused = Boolean(sync.pauseCollection);
  const status = mapStripeStatus(sync.status, paused);

  return {
    ...plan,
    stripeSubscriptionId: sync.subscriptionId || plan.stripeSubscriptionId,
    stripeCustomerId: sync.customerId || plan.stripeCustomerId,
    status,
    failureCount: failedCount,
    retainerRequiredCents:
      sync.retainer?.requiredCents ??
      plan.retainerRequiredCents ??
      plan.upfrontRetainerCents ??
      0,
    retainerPaidCents: sync.retainer?.paidCents ?? plan.retainerPaidCents ?? 0,
    retainerStatus: sync.retainer
      ? normalizeRetainerStatus(sync.retainer.status)
      : plan.upfrontRetainerCents
        ? plan.retainerStatus || 'awaiting_payment'
        : 'not_required',
    nextChargeDate: sync.currentPeriodEnd
      ? new Date(sync.currentPeriodEnd * 1000).toISOString()
      : plan.nextChargeDate,
    invoices: mergedInvoices.length ? mergedInvoices : plan.invoices,
    updatedAt: new Date().toISOString(),
  };
}
