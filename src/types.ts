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
