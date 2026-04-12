import type { EmailPreferences } from '../types.ts';

const STORAGE_KEY = 'spherical-assistant-email-preferences';

export function getDefaultEmailPreferences(): EmailPreferences {
  return {
    businessName: '',
    senderName: '',
    writingTone: 'Warm and professional',
    generalInstructions: '',
    confirmationInstructions: '',
    reminderInstructions: '',
    followupInstructions: '',
    signature: '',
    businessType: '',
    serviceAreas: '',
    workingHours: '',
    leadGoals: '',
    repeatBusinessGoals: '',
    noShowPolicy: '',
    estimatePolicy: '',
    reviewLink: '',
    storefrontSummary: '',
  };
}

export function loadEmailPreferences(): EmailPreferences {
  if (typeof window === 'undefined') {
    return getDefaultEmailPreferences();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultEmailPreferences();
    return { ...getDefaultEmailPreferences(), ...(JSON.parse(raw) as Partial<EmailPreferences>) };
  } catch {
    return getDefaultEmailPreferences();
  }
}

export function saveEmailPreferences(preferences: EmailPreferences): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}
