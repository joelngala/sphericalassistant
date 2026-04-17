import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

export interface IntakeAnswers {
  fullName: string;
  phone: string;
  email: string;
  bestContact: string;
  matterType: string;
  matterDetail: string;
  description: string;
  opposingParty: string;
  jurisdictionState: string;
  jurisdictionCounty: string;
  urgent: 'yes' | 'no' | '';
  urgencyReason: string;
  preferredTimes: string;
  howHeard: string;
  consent: boolean;
}

const EMPTY_ANSWERS: IntakeAnswers = {
  fullName: '',
  phone: '',
  email: '',
  bestContact: '',
  matterType: '',
  matterDetail: '',
  description: '',
  opposingParty: '',
  jurisdictionState: '',
  jurisdictionCounty: '',
  urgent: '',
  urgencyReason: '',
  preferredTimes: '',
  howHeard: '',
  consent: false,
};

const MATTER_TYPES: { value: string; label: string }[] = [
  { value: 'family', label: 'Family / Divorce' },
  { value: 'criminal', label: 'Criminal Defense' },
  { value: 'personal-injury', label: 'Personal Injury' },
  { value: 'immigration', label: 'Immigration' },
  { value: 'estate', label: 'Estate / Probate' },
  { value: 'business', label: 'Business / Contracts' },
  { value: 'employment', label: 'Employment' },
  { value: 'other', label: 'Other' },
];

const CONTACT_METHODS = ['Phone', 'Text', 'Email'];

interface IntakeFormProps {
  firmName?: string;
  embed?: boolean;
}

export default function IntakeForm({ firmName = 'the firm', embed = false }: IntakeFormProps) {
  const [answers, setAnswers] = useState<IntakeAnswers>(EMPTY_ANSWERS);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function update<K extends keyof IntakeAnswers>(key: K, value: IntakeAnswers[K]) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setError('');
    setFieldErrors((prev) => {
      if (!prev[key as string]) return prev;
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const errs = validate(answers);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError('Please fix the highlighted fields before submitting.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const workerUrl = import.meta.env.VITE_API_BASE_URL;
      const firmId = new URLSearchParams(window.location.search).get('firm') || '';
      const response = await fetch(`${workerUrl}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers,
          transcript: [],
          summary: '',
          firmId,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Submission failed (${response.status})`);
      }
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Submission failed. Please try again or call the firm directly.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  const urgent = answers.urgent === 'yes';
  const rootClass = embed
    ? 'intake-root intake-embed intake-form-root'
    : 'intake-root intake-form-root';

  return (
    <div className={rootClass}>
      <div className="intake-card intake-form-card">
        <header className="intake-header">
          <div className="intake-header-top">
            <div className="intake-logo">
              <div className="intake-logo-icon">
                <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
                  <ellipse cx="16" cy="16" rx="10" ry="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
                </svg>
              </div>
              <div>
                <div className="intake-title">New Client Intake</div>
                <div className="intake-subtitle">{firmName}</div>
              </div>
            </div>
          </div>
        </header>

        {submitted ? (
          <div className="intake-done">
            <div className="intake-done-icon">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="14" fill="var(--success-glow)" stroke="var(--success)" strokeWidth="1.5" />
                <path
                  d="M10 16l4 4 8-8"
                  stroke="var(--success)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            </div>
            <p className="intake-done-title">Intake submitted</p>
            <p className="intake-done-detail">
              {urgent
                ? 'The attorney will review your information and reach out within a few hours given the urgency.'
                : 'The attorney will review your information and reach out within one business day.'}
            </p>
          </div>
        ) : (
          <form className="intake-form" onSubmit={handleSubmit} noValidate>
            <section className="intake-form-section">
              <div className="intake-form-section-heading">Your information</div>

              <FormField label="Full name" required error={fieldErrors.fullName}>
                <input
                  className="intake-form-input"
                  type="text"
                  autoComplete="name"
                  value={answers.fullName}
                  onChange={(e) => update('fullName', e.target.value)}
                />
              </FormField>

              <div className="intake-form-row">
                <FormField label="Phone" required error={fieldErrors.phone}>
                  <input
                    className="intake-form-input"
                    type="tel"
                    autoComplete="tel"
                    placeholder="(555) 123-4567"
                    value={answers.phone}
                    onChange={(e) => update('phone', e.target.value)}
                  />
                </FormField>
                <FormField label="Email" required error={fieldErrors.email}>
                  <input
                    className="intake-form-input"
                    type="email"
                    autoComplete="email"
                    value={answers.email}
                    onChange={(e) => update('email', e.target.value)}
                  />
                </FormField>
              </div>

              <FormField label="Best way to reach you">
                <div className="intake-form-radio-group">
                  {CONTACT_METHODS.map((method) => (
                    <label
                      key={method}
                      className={`intake-form-chip ${answers.bestContact === method ? 'selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="bestContact"
                        value={method}
                        checked={answers.bestContact === method}
                        onChange={() => update('bestContact', method)}
                      />
                      {method}
                    </label>
                  ))}
                </div>
              </FormField>
            </section>

            <section className="intake-form-section">
              <div className="intake-form-section-heading">About your matter</div>

              <FormField label="Type of matter" required error={fieldErrors.matterType}>
                <select
                  className="intake-form-input"
                  value={answers.matterType}
                  onChange={(e) => update('matterType', e.target.value)}
                >
                  <option value="">Select one…</option>
                  {MATTER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </FormField>

              {answers.matterType && (
                <FormField label="Specifics (optional)" hint='e.g. "divorce," "car accident," "DUI"'>
                  <input
                    className="intake-form-input"
                    type="text"
                    value={answers.matterDetail}
                    onChange={(e) => update('matterDetail', e.target.value)}
                  />
                </FormField>
              )}

              <FormField
                label="Briefly describe your situation"
                required
                error={fieldErrors.description}
                hint="Include key facts, dates, and what you're hoping to accomplish."
              >
                <textarea
                  className="intake-form-textarea"
                  rows={5}
                  value={answers.description}
                  onChange={(e) => update('description', e.target.value)}
                />
              </FormField>
            </section>

            <section className="intake-form-section">
              <div className="intake-form-section-heading">Jurisdiction &amp; parties</div>

              <div className="intake-form-row">
                <FormField label="State" required error={fieldErrors.jurisdictionState}>
                  <input
                    className="intake-form-input"
                    type="text"
                    placeholder="e.g. California"
                    value={answers.jurisdictionState}
                    onChange={(e) => update('jurisdictionState', e.target.value)}
                  />
                </FormField>
                <FormField label="County (optional)">
                  <input
                    className="intake-form-input"
                    type="text"
                    value={answers.jurisdictionCounty}
                    onChange={(e) => update('jurisdictionCounty', e.target.value)}
                  />
                </FormField>
              </div>

              <FormField
                label="Opposing party (if any)"
                hint="Name of the other side, if applicable. Used to check for conflicts."
              >
                <input
                  className="intake-form-input"
                  type="text"
                  value={answers.opposingParty}
                  onChange={(e) => update('opposingParty', e.target.value)}
                />
              </FormField>
            </section>

            <section className="intake-form-section">
              <div className="intake-form-section-heading">Timing</div>

              <FormField label="Is this urgent?" required error={fieldErrors.urgent}>
                <div className="intake-form-radio-group">
                  <label
                    className={`intake-form-chip ${answers.urgent === 'yes' ? 'selected urgent' : ''}`}
                  >
                    <input
                      type="radio"
                      name="urgent"
                      checked={answers.urgent === 'yes'}
                      onChange={() => update('urgent', 'yes')}
                    />
                    Yes — there's a deadline
                  </label>
                  <label
                    className={`intake-form-chip ${answers.urgent === 'no' ? 'selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="urgent"
                      checked={answers.urgent === 'no'}
                      onChange={() => update('urgent', 'no')}
                    />
                    No — general inquiry
                  </label>
                </div>
              </FormField>

              {urgent && (
                <FormField
                  label="What is the deadline?"
                  required
                  error={fieldErrors.urgencyReason}
                >
                  <input
                    className="intake-form-input"
                    type="text"
                    placeholder="e.g. Hearing on Friday, arraignment Tuesday"
                    value={answers.urgencyReason}
                    onChange={(e) => update('urgencyReason', e.target.value)}
                  />
                </FormField>
              )}

              <FormField
                label="When are you generally available?"
                required
                error={fieldErrors.preferredTimes}
              >
                <input
                  className="intake-form-input"
                  type="text"
                  placeholder="e.g. weekday afternoons, any time Thursday"
                  value={answers.preferredTimes}
                  onChange={(e) => update('preferredTimes', e.target.value)}
                />
              </FormField>

              <FormField label="How did you hear about us? (optional)">
                <input
                  className="intake-form-input"
                  type="text"
                  value={answers.howHeard}
                  onChange={(e) => update('howHeard', e.target.value)}
                />
              </FormField>
            </section>

            <section className="intake-form-section">
              <label
                className={`intake-form-consent ${fieldErrors.consent ? 'error' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={answers.consent}
                  onChange={(e) => update('consent', e.target.checked)}
                />
                <span>
                  I understand that submitting this intake does <strong>not</strong> create an
                  attorney-client relationship, and that I am not a client until the firm
                  agrees to represent me in writing.
                </span>
              </label>
              {fieldErrors.consent && (
                <div className="intake-form-error-text">{fieldErrors.consent}</div>
              )}
            </section>

            {error && <div className="intake-error">{error}</div>}

            <button
              type="submit"
              className="intake-btn-primary intake-btn-large"
              disabled={submitting}
            >
              {submitting ? 'Submitting…' : 'Submit intake'}
            </button>
          </form>
        )}
      </div>

      {!embed && (
        <footer className="intake-footer">
          <span className="intake-footer-lock">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a4 4 0 0 0-4 4v2H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm2 6H6V5a2 2 0 1 1 4 0v2z" />
            </svg>
          </span>
          Powered by Spherical Assistant · Your information is confidential
        </footer>
      )}
    </div>
  );
}

interface FormFieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}

function FormField({ label, required, hint, error, children }: FormFieldProps) {
  return (
    <div className={`intake-form-field ${error ? 'has-error' : ''}`}>
      <label className="intake-form-label">
        {label}
        {required && <span className="intake-form-required">*</span>}
      </label>
      {children}
      {hint && !error && <div className="intake-form-hint">{hint}</div>}
      {error && <div className="intake-form-error-text">{error}</div>}
    </div>
  );
}

function validate(a: IntakeAnswers): Record<string, string> {
  const errs: Record<string, string> = {};
  const name = a.fullName.trim();
  const phone = a.phone.trim();
  const email = a.email.trim();

  if (!name) errs.fullName = 'Full name is required.';
  if (!phone) errs.phone = 'Phone number is required.';
  else if (phone.replace(/\D/g, '').length < 10)
    errs.phone = 'Please include a valid phone number with area code.';
  if (!email) errs.email = 'Email address is required.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errs.email = 'That email address looks invalid.';
  if (!a.matterType) errs.matterType = 'Please select the type of matter.';
  if (!a.description.trim())
    errs.description = 'Briefly describe your situation so the attorney can evaluate it.';
  if (!a.jurisdictionState.trim())
    errs.jurisdictionState = 'Which state is this matter in?';
  if (!a.urgent) errs.urgent = 'Please indicate whether this is urgent.';
  if (a.urgent === 'yes' && !a.urgencyReason.trim())
    errs.urgencyReason = 'What is the deadline or reason for urgency?';
  if (!a.preferredTimes.trim())
    errs.preferredTimes = 'When are you generally available?';
  if (!a.consent) errs.consent = 'You must acknowledge this to continue.';

  return errs;
}
