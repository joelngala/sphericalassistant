interface LoginProps {
  onSignIn: () => void;
  loading: boolean;
  error: string;
}

export default function Login({ onSignIn, loading, error }: LoginProps) {
  return (
    <div className="login-view">
      <div className="login-logo">
        <svg width="64" height="64" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" fill="var(--accent)" opacity="0.15" />
          <circle cx="16" cy="16" r="10" stroke="var(--accent)" strokeWidth="2" fill="none" />
          <path d="M16 6 A10 10 0 0 1 16 26" stroke="var(--accent-hover)" strokeWidth="1.5" fill="none" />
          <ellipse cx="16" cy="16" rx="10" ry="4" stroke="var(--accent)" strokeWidth="1.5" fill="none" />
        </svg>
      </div>

      <h1>Spherical Assistant</h1>
      <p className="subtitle">Your AI-Powered Service Business Assistant</p>

      <div className="features">
        <div className="feature">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5 0a1 1 0 0 1 1 1v1h4V1a1 1 0 1 1 2 0v1h1.5A2.5 2.5 0 0 1 16 4.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 0 13.5v-9A2.5 2.5 0 0 1 2.5 2H4V1a1 1 0 0 1 1-1zM2 6v7.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V6H2z"/>
          </svg>
          Smart Scheduling
        </div>
        <div className="feature">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm1.5 4.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0zM8 7a3 3 0 0 0-3 3v2h6v-2a3 3 0 0 0-3-3z"/>
          </svg>
          Client Intelligence
        </div>
        <div className="feature">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm2 1v1h8V3H4zm0 3v1h8V6H4zm0 3v1h5V9H4z"/>
          </svg>
          One-Click Actions
        </div>
      </div>

      <button
        className="google-btn"
        onClick={onSignIn}
        disabled={loading}
      >
        {loading ? (
          <>
            <div className="spinner-sm" />
            Signing in...
          </>
        ) : (
          <>
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.26c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </>
        )}
      </button>

      <p className="security-note">
        Your calendar data stays in your browser. Only AI analysis is sent to our secure backend.
      </p>

      {error && <div className="error-bar">{error}</div>}
    </div>
  );
}
