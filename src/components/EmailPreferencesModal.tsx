import { useState } from 'react';
import type { EmailPreferences } from '../types.ts';

interface EmailPreferencesModalProps {
  initialPreferences: EmailPreferences;
  onSave: (preferences: EmailPreferences) => void;
  onClose: () => void;
}

export default function EmailPreferencesModal({
  initialPreferences,
  onSave,
  onClose,
}: EmailPreferencesModalProps) {
  const [preferences, setPreferences] = useState<EmailPreferences>(initialPreferences);

  function updateField<K extends keyof EmailPreferences>(key: K, value: EmailPreferences[K]) {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="settings-modal">
        <div className="draft-header">
          <h2>Email Preferences</h2>
          <button className="btn-icon" onClick={onClose} title="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="appointment-form-grid">
          <div className="draft-field">
            <label>Business Type</label>
            <input
              value={preferences.businessType}
              onChange={(e) => updateField('businessType', e.target.value)}
              placeholder="Home cleaning, HVAC, plumbing, law firm"
            />
          </div>

          <div className="draft-field">
            <label>Business Name</label>
            <input
              value={preferences.businessName}
              onChange={(e) => updateField('businessName', e.target.value)}
              placeholder="SphereLabs AI"
            />
          </div>

          <div className="draft-field">
            <label>Sender Name</label>
            <input
              value={preferences.senderName}
              onChange={(e) => updateField('senderName', e.target.value)}
              placeholder="Joel"
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>Service Areas</label>
            <input
              value={preferences.serviceAreas}
              onChange={(e) => updateField('serviceAreas', e.target.value)}
              placeholder="St. Pete, Tampa, Clearwater"
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>Working Hours</label>
            <input
              value={preferences.workingHours}
              onChange={(e) => updateField('workingHours', e.target.value)}
              placeholder="Mon-Fri 8am-5pm, Sat 9am-1pm"
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>Lead Goals</label>
            <textarea
              rows={2}
              value={preferences.leadGoals}
              onChange={(e) => updateField('leadGoals', e.target.value)}
              placeholder="More booked consultations, fewer no-shows, better response times"
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>Repeat Business Goals</label>
            <textarea
              rows={2}
              value={preferences.repeatBusinessGoals}
              onChange={(e) => updateField('repeatBusinessGoals', e.target.value)}
              placeholder="Seasonal reminders, repeat maintenance, review generation"
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>No-Show Policy</label>
            <textarea
              rows={2}
              value={preferences.noShowPolicy}
              onChange={(e) => updateField('noShowPolicy', e.target.value)}
              placeholder="Example: same-day cancellations lose deposit"
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>Estimate / Deposit Policy</label>
            <textarea
              rows={2}
              value={preferences.estimatePolicy}
              onChange={(e) => updateField('estimatePolicy', e.target.value)}
              placeholder="Example: estimates followed up in 48 hours, $50 deposit required"
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>Default Tone</label>
            <input
              value={preferences.writingTone}
              onChange={(e) => updateField('writingTone', e.target.value)}
              placeholder="Warm, concise, trustworthy"
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>General Instructions</label>
            <textarea
              rows={3}
              value={preferences.generalInstructions}
              onChange={(e) => updateField('generalInstructions', e.target.value)}
              placeholder="What should every email sound like or always include?"
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>Confirmation Email Instructions</label>
            <textarea
              rows={3}
              value={preferences.confirmationInstructions}
              onChange={(e) => updateField('confirmationInstructions', e.target.value)}
              placeholder="Example: always mention arrival window and parking instructions."
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>Reminder Email Instructions</label>
            <textarea
              rows={3}
              value={preferences.reminderInstructions}
              onChange={(e) => updateField('reminderInstructions', e.target.value)}
              placeholder="Example: keep reminders brief and ask them to reply if they need to reschedule."
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>Follow-up Email Instructions</label>
            <textarea
              rows={3}
              value={preferences.followupInstructions}
              onChange={(e) => updateField('followupInstructions', e.target.value)}
              placeholder="Example: ask for a review and suggest next service timing."
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>Default Signature</label>
            <textarea
              rows={3}
              value={preferences.signature}
              onChange={(e) => updateField('signature', e.target.value)}
              placeholder={"Best,\nJoel\nSphereLabs AI"}
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>Review Link</label>
            <input
              value={preferences.reviewLink}
              onChange={(e) => updateField('reviewLink', e.target.value)}
              placeholder="https://g.page/r/..."
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>Storefront Summary</label>
            <textarea
              rows={3}
              value={preferences.storefrontSummary}
              onChange={(e) => updateField('storefrontSummary', e.target.value)}
              placeholder="Short client-facing summary of services and what makes the business different"
            />
          </div>
        </div>

        <div className="draft-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => onSave(preferences)}>Save Preferences</button>
        </div>
      </div>
    </div>
  );
}
