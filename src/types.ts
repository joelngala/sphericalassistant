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
