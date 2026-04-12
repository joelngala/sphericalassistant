import { useEffect, useMemo, useState } from 'react';
import type { AppointmentFormData, ClientContact } from '../types.ts';

interface NewAppointmentModalProps {
  suggestions: ClientContact[];
  contactsLoading: boolean;
  saving: boolean;
  onSearchContacts: (query: string) => Promise<void>;
  onCreate: (form: AppointmentFormData) => Promise<void>;
  onClose: () => void;
}

function getDefaultForm(): AppointmentFormData {
  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return {
    title: '',
    clientName: '',
    clientEmail: '',
    date: start.toISOString().split('T')[0],
    startTime: start.toTimeString().slice(0, 5),
    endTime: end.toTimeString().slice(0, 5),
    location: '',
    notes: '',
  };
}

export default function NewAppointmentModal({
  suggestions,
  contactsLoading,
  saving,
  onSearchContacts,
  onCreate,
  onClose,
}: NewAppointmentModalProps) {
  const [form, setForm] = useState<AppointmentFormData>(() => getDefaultForm());
  const [contactQuery, setContactQuery] = useState('');

  const canSave = useMemo(() => {
    return (
      form.title.trim().length > 0 &&
      form.date.trim().length > 0 &&
      form.startTime.trim().length > 0 &&
      form.endTime.trim().length > 0 &&
      form.endTime > form.startTime &&
      (!form.clientEmail.trim() || form.clientEmail.includes('@'))
    );
  }, [form]);

  useEffect(() => {
    void onSearchContacts('');
  }, [onSearchContacts]);

  async function handleSearchChange(value: string) {
    setContactQuery(value);
    await onSearchContacts(value);
  }

  function updateField<K extends keyof AppointmentFormData>(key: K, value: AppointmentFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function useSuggestedContact(contact: ClientContact) {
    setForm((prev) => ({
      ...prev,
      clientName: contact.name,
      clientEmail: contact.email,
      location: prev.location || contact.address || '',
      notes: prev.notes || contact.notes || '',
    }));
  }

  return (
    <div className="modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="appointment-modal">
        <div className="draft-header">
          <h2>New Appointment</h2>
          <button className="btn-icon" onClick={onClose} title="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="appointment-form-grid">
          <div className="draft-field">
            <label>Service / Title</label>
            <input
              value={form.title}
              onChange={(e) => updateField('title', e.target.value)}
              placeholder="Deep clean, estimate visit, plumbing repair"
            />
          </div>

          <div className="draft-field">
            <label>Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => updateField('date', e.target.value)}
            />
          </div>

          <div className="draft-field">
            <label>Start</label>
            <input
              type="time"
              value={form.startTime}
              onChange={(e) => updateField('startTime', e.target.value)}
            />
          </div>

          <div className="draft-field">
            <label>End</label>
            <input
              type="time"
              value={form.endTime}
              onChange={(e) => updateField('endTime', e.target.value)}
            />
          </div>

          <div className="draft-field">
            <label>Client Name</label>
            <input
              value={form.clientName}
              onChange={(e) => updateField('clientName', e.target.value)}
              placeholder="Client name"
            />
          </div>

          <div className="draft-field">
            <label>Client Email</label>
            <input
              type="email"
              value={form.clientEmail}
              onChange={(e) => updateField('clientEmail', e.target.value)}
              placeholder="client@email.com"
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>Location</label>
            <input
              value={form.location}
              onChange={(e) => updateField('location', e.target.value)}
              placeholder="Service address or meeting location"
            />
          </div>

          <div className="draft-field appointment-form-wide">
            <label>Notes</label>
            <textarea
              rows={5}
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              placeholder="Gate code, scope of work, access details, pricing notes"
            />
          </div>
        </div>

        <div className="contact-picker appointment-contact-picker">
          <div className="contact-picker-header">
            <label>Pick Existing Contact</label>
            <input
              type="text"
              placeholder="Search Google Contacts"
              value={contactQuery}
              onChange={(e) => { void handleSearchChange(e.target.value); }}
            />
          </div>
          {contactsLoading ? (
            <div className="contact-picker-loading">
              <div className="spinner-sm" />
              <span>Loading contacts...</span>
            </div>
          ) : suggestions.length > 0 ? (
            <div className="contact-suggestion-list">
              {suggestions.map((contact) => (
                <button
                  key={contact.resourceName || `${contact.email}-${contact.name}`}
                  className="contact-suggestion"
                  onClick={() => useSuggestedContact(contact)}
                  disabled={saving}
                >
                  <div className="contact-suggestion-main">
                    <span className="contact-suggestion-name">{contact.name}</span>
                    <span className="contact-suggestion-email">{contact.email}</span>
                  </div>
                  {(contact.phone || contact.address) && (
                    <span className="contact-suggestion-meta">{contact.phone || contact.address}</span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <p className="hint-text">No matching Google Contacts.</p>
          )}
        </div>

        {form.endTime <= form.startTime && (
          <p className="field-warning">End time must be after start time.</p>
        )}

        <div className="draft-actions">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn-primary"
            onClick={() => onCreate(form)}
            disabled={!canSave || saving}
          >
            {saving ? <div className="spinner-sm" /> : 'Create Appointment'}
          </button>
        </div>
      </div>
    </div>
  );
}
