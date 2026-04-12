import { useEffect, useState } from 'react';
import type { ClientContact, ContactFormData } from '../types.ts';

interface ClientPanelProps {
  contact: ClientContact | null;
  loading: boolean;
  attendeeEmail: string;
  suggestedName?: string;
  contactSuggestions: ClientContact[];
  contactsLoading: boolean;
  onSearchContacts: (query: string) => Promise<void>;
  onSelectContact: (contact: ClientContact) => Promise<void>;
  onUpdateEmail: (email: string) => Promise<void>;
  updatingEmail: boolean;
  onCreateContact: (data: ContactFormData) => void;
  creatingContact: boolean;
}

export default function ClientPanel({
  contact,
  loading,
  attendeeEmail,
  suggestedName,
  contactSuggestions,
  contactsLoading,
  onSearchContacts,
  onSelectContact,
  onUpdateEmail,
  updatingEmail,
  onCreateContact,
  creatingContact,
}: ClientPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState(suggestedName || '');
  const [formEmail, setFormEmail] = useState(attendeeEmail);
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [contactQuery, setContactQuery] = useState('');

  useEffect(() => {
    setFormEmail(attendeeEmail);
  }, [attendeeEmail]);

  useEffect(() => {
    if (!formName.trim() && suggestedName) {
      setFormName(suggestedName);
    }
  }, [suggestedName, formName]);

  async function handleSaveClient() {
    const email = formEmail.trim();
    if (!formName.trim() || !email || !email.includes('@')) return;
    await onCreateContact({
      name: formName.trim(),
      email,
      phone: formPhone.trim(),
      address: formAddress.trim(),
    });
  }

  useEffect(() => {
    void onSearchContacts('');
  }, [onSearchContacts]);

  async function handleSearchChange(value: string) {
    setContactQuery(value);
    await onSearchContacts(value);
  }

  function renderContactPicker() {
    return (
      <div className="contact-picker">
        <div className="contact-picker-header">
          <label>Google Contacts</label>
          <input
            type="text"
            placeholder="Search contacts"
            value={contactQuery}
            onChange={(e) => {
              void handleSearchChange(e.target.value);
            }}
          />
        </div>
        {contactsLoading ? (
          <div className="contact-picker-loading">
            <div className="spinner-sm" />
            <span>Loading contacts...</span>
          </div>
        ) : contactSuggestions.length > 0 ? (
          <div className="contact-suggestion-list">
            {contactSuggestions.map((suggestedContact) => (
              <button
                key={suggestedContact.resourceName || `${suggestedContact.email}-${suggestedContact.name}`}
                className="contact-suggestion"
                onClick={() => void onSelectContact(suggestedContact)}
                disabled={updatingEmail || creatingContact}
              >
                <div className="contact-suggestion-main">
                  <span className="contact-suggestion-name">{suggestedContact.name}</span>
                  <span className="contact-suggestion-email">{suggestedContact.email}</span>
                </div>
                {suggestedContact.phone && (
                  <span className="contact-suggestion-meta">{suggestedContact.phone}</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className="hint-text">No matching Google Contacts.</p>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="client-panel">
        <h3>Client</h3>
        <div className="skeleton-block" />
        <div className="skeleton-block short" />
        <div className="skeleton-block short" />
      </div>
    );
  }

  if (!contact && !showForm) {
    return (
      <div className="client-panel">
        <h3>Client</h3>
        <div className="client-not-found">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
            <circle cx="16" cy="12" r="5" />
            <path d="M6 28a10 10 0 0 1 20 0" />
            <path d="M22 6l4 4M26 6l-4 4" />
          </svg>
          <p>Not found in contacts</p>
          <p className="hint-text">{attendeeEmail || 'No client email on this appointment yet'}</p>
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            Add Client
          </button>
        </div>
        {renderContactPicker()}
      </div>
    );
  }

  if (showForm && !contact) {
    return (
      <div className="client-panel">
        <h3>New Contact</h3>
        <div className="contact-form">
          <input
            placeholder="Full name"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
          />
          <input
            type="email"
            placeholder="Email address"
            value={formEmail}
            onChange={(e) => setFormEmail(e.target.value)}
          />
          <input
            placeholder="Phone number"
            value={formPhone}
            onChange={(e) => setFormPhone(e.target.value)}
          />
          <input
            placeholder="Address"
            value={formAddress}
            onChange={(e) => setFormAddress(e.target.value)}
          />
          <div className="form-actions">
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button
              className="btn-primary"
              onClick={handleSaveClient}
              disabled={!formName.trim() || !formEmail.trim() || !formEmail.includes('@') || creatingContact}
            >
              {creatingContact ? <div className="spinner-sm" /> : 'Save'}
            </button>
          </div>
          <p className="hint-text">Saving a client here also syncs the appointment email inside the assistant.</p>
        </div>
        {renderContactPicker()}
      </div>
    );
  }

  if (!contact) return null;

  return (
    <div className="client-panel">
      <h3>Client</h3>
      <div className="client-info">
        <div className="client-header">
          {contact.photoUrl ? (
            <img src={contact.photoUrl} alt={contact.name} className="client-avatar" referrerPolicy="no-referrer" />
          ) : (
            <div className="client-avatar placeholder">
              {contact.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="client-name">{contact.name}</div>
            {contact.organization && <div className="client-org">{contact.organization}</div>}
          </div>
        </div>

        <div className="client-fields">
          <div className="client-field">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm1.5 0L8 7l4.5-4H3.5zM2 4.5v8L6 8 2 4.5zM14 4.5L10 8l4 4.5v-8z"/>
            </svg>
            {contact.email}
          </div>
          {contact.phone && (
            <div className="client-field">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3.654 1.328a.678.678 0 0 0-1.015-.063L1.605 2.3c-.483.484-.661 1.169-.45 1.77a17.568 17.568 0 0 0 4.168 6.608 17.569 17.569 0 0 0 6.608 4.168c.601.211 1.286.033 1.77-.45l1.034-1.034a.678.678 0 0 0-.063-1.015l-2.307-1.794a.678.678 0 0 0-.58-.122l-2.19.547a1.745 1.745 0 0 1-1.657-.459L5.482 8.062a1.745 1.745 0 0 1-.46-1.657l.548-2.19a.678.678 0 0 0-.122-.58L3.654 1.328z"/>
              </svg>
              {contact.phone}
            </div>
          )}
          {contact.address && (
            <div className="client-field">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0a5 5 0 0 1 5 5c0 3.5-5 9-5 9S3 8.5 3 5a5 5 0 0 1 5-5zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>
              </svg>
              {contact.address}
            </div>
          )}
        </div>

        {!attendeeEmail && (
          <div className="client-inline-action">
            <button
              className="btn-secondary"
              onClick={() => onUpdateEmail(contact.email)}
              disabled={updatingEmail}
            >
              {updatingEmail ? <div className="spinner-sm" /> : 'Use This Email For Appointment'}
            </button>
          </div>
        )}

        {renderContactPicker()}

        {contact.notes && (
          <div className="client-notes">
            <label>Notes</label>
            <p>{contact.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
