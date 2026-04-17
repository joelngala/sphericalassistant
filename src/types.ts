export interface GoogleUser {
  email: string;
  name: string;
  picture: string;
  accessToken: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: CalendarAttendee[];
  location?: string;
  extendedProperties?: {
    private?: Record<string, string>;
  };
}

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
}

export interface ClientContact {
  resourceName: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  organization?: string;
  notes?: string;
  photoUrl?: string;
}

export interface AppointmentAnalysis {
  clientSummary: string;
  appointmentNotes: string;
  prepChecklist: string[];
  suggestedActions: SuggestedAction[];
}

export interface SlidesDeckSlide {
  title: string;
  bullets: string[];
  speakerNotes?: string;
}

export interface SlidesDeckOutline {
  title: string;
  subtitle?: string;
  slides: SlidesDeckSlide[];
}

export interface GoogleDocSection {
  heading: string;
  bullets: string[];
}

export interface GoogleDocOutline {
  title: string;
  subtitle?: string;
  executiveSummary?: string;
  sections: GoogleDocSection[];
}

export interface SuggestedAction {
  id: string;
  type: 'confirm' | 'reminder' | 'followup' | 'estimate' | 'contact' | 'custom';
  label: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export type WorkflowStatus = 'new' | 'confirmed' | 'reminded' | 'completed' | 'followed-up';

export interface WorkflowState {
  status: WorkflowStatus;
  confirmedAt?: string;
  remindedAt?: string;
  completedAt?: string;
  followedUpAt?: string;
  estimateSent?: boolean;
  contactUpdated?: boolean;
}

export interface EmailDraft {
  subject: string;
  body: string;
}

export interface EstimateResult {
  estimateText: string;
  lineItems: { item: string; price: string }[];
  total: string;
  notes: string;
}

export interface DraftPreviewData {
  to: string;
  subject: string;
  body: string;
  actionId: string;
}

export type ActionResultStatus = 'drafted' | 'sent' | 'scheduled' | 'error';

export interface ContactFormData {
  name: string;
  email: string;
  phone: string;
  address: string;
}

export interface AppointmentFormData {
  title: string;
  clientName: string;
  clientEmail: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
}

export interface EmailPreferences {
  businessName: string;
  senderName: string;
  writingTone: string;
  generalInstructions: string;
  confirmationInstructions: string;
  reminderInstructions: string;
  followupInstructions: string;
  signature: string;
  businessType: string;
  serviceAreas: string;
  workingHours: string;
  leadGoals: string;
  repeatBusinessGoals: string;
  noShowPolicy: string;
  estimatePolicy: string;
  reviewLink: string;
  storefrontSummary: string;
}

export interface AssistantPattern {
  title: string;
  insight: string;
  impact: 'growth' | 'risk' | 'ops';
}

export interface BusinessInsights {
  overview: string;
  patterns: AssistantPattern[];
  recommendedAutomations: string[];
  opportunities: string[];
}

export interface MorningBrief {
  headline: string;
  summary: string;
  priorities: string[];
  risks: string[];
  suggestedFocus: string;
}

export interface AssistantActionItem {
  id: string;
  eventId: string;
  eventTitle: string;
  eventStart: string;
  type: 'confirmation' | 'missing-info' | 'followup' | 'estimate' | 'review' | 'marketing';
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
}

export interface AssistantReminderData {
  type: 'morning-brief' | 'approval' | 'followup' | 'missing-info' | 'review-request';
  eventId?: string;
  title: string;
  detail: string;
}

// --- Case Management ---

export type IndustryType = 'legal' | 'realestate' | 'general';

export interface CaseTask {
  id: string;
  label: string;
  done: boolean;
  createdAt: string;
  completedAt?: string;
  auto: boolean;
}

export type DocCategory =
  | 'intake'
  | 'court'
  | 'medical'
  | 'correspondence'
  | 'financial'
  | 'evidence'
  | 'discovery'
  | 'contracts'
  | 'property'
  | 'inspections'
  | 'title'
  | 'other';

export interface CaseDocument {
  id: string;
  name: string;
  category: DocCategory;
  uploadedAt: string;
  size: number;
  textContent: string;
}

export interface CaseChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export type ActivityAction =
  | 'email_drafted'
  | 'email_sent'
  | 'email_scheduled'
  | 'doc_created'
  | 'doc_updated'
  | 'slides_created'
  | 'slides_updated'
  | 'ai_analysis'
  | 'task_completed'
  | 'task_added'
  | 'document_uploaded'
  | 'document_removed'
  | 'ai_chat'
  | 'pdf_generated'
  | 'contact_created'
  | 'contact_updated'
  | 'status_changed'
  | 'intake_extracted'
  | 'billing_plan_created'
  | 'billing_plan_updated'
  | 'billing_payment_succeeded'
  | 'billing_payment_failed'
  | 'billing_plan_paused'
  | 'billing_plan_resumed'
  | 'billing_plan_canceled';

export interface ActivityLogEntry {
  id: string;
  action: ActivityAction;
  label: string;
  detail?: string;
  timestamp: string;
}

export interface CaseData {
  eventId: string;
  industry: IndustryType;
  tasks: CaseTask[];
  taskSuggestions: string[];
  dismissedSuggestions: string[];
  documents: CaseDocument[];
  chatHistory: CaseChatMessage[];
  activityLog: ActivityLogEntry[];
  paymentPlan?: PaymentPlan;
  updatedAt: string;
}

// --- Billing / Payment Plans ---

export type BillingInterval = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

export type BillingStatus =
  | 'active'      // subscription current
  | 'trialing'    // upfront retainer period before first recurring charge
  | 'past_due'    // invoice failed, in retry window
  | 'paused'      // lawyer halted representation after missed payments
  | 'canceled';   // plan ended

export type InvoiceStatus = 'paid' | 'open' | 'failed' | 'void';

export interface PaymentInvoice {
  id: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  createdAt: string;
  paidAt?: string;
  failedAt?: string;
  description?: string;
}

export interface PaymentPlan {
  id: string;
  liveMode?: boolean;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  stripeSessionId?: string;
  stripeCheckoutUrl?: string;
  clientName: string;
  clientEmail: string;
  amountCents: number;
  currency: string;
  interval: BillingInterval;
  upfrontRetainerCents?: number;
  startDate: string;
  nextChargeDate?: string;
  status: BillingStatus;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
  pausedAt?: string;
  canceledAt?: string;
  invoices: PaymentInvoice[];
  notes?: string;
}
