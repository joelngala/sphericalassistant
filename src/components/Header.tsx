import type { GoogleUser } from '../types.ts';

interface HeaderProps {
  user: GoogleUser;
  onLogout: () => void;
  onBack?: () => void;
  showBack?: boolean;
}

export default function Header({ user, onLogout, onBack, showBack }: HeaderProps) {
  return (
    <header>
      <div className="logo">
        {showBack && onBack ? (
          <button className="btn-icon" onClick={onBack} title="Back to dashboard">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M11 4L6 9l5 5" />
            </svg>
          </button>
        ) : (
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" fill="var(--accent)" opacity="0.15" />
            <circle cx="16" cy="16" r="10" stroke="var(--accent)" strokeWidth="2" fill="none" />
            <ellipse cx="16" cy="16" rx="10" ry="4" stroke="var(--accent)" strokeWidth="1.5" fill="none" />
          </svg>
        )}
        <h1>Spherical Assistant</h1>
      </div>

      <div className="header-actions">
        <div className="user-info">
          <img
            src={user.picture}
            alt={user.name}
            className="avatar"
            referrerPolicy="no-referrer"
          />
          <span className="user-name">{user.name.split(' ')[0]}</span>
        </div>
        <button className="btn-icon" onClick={onLogout} title="Sign out">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M11 11l3-3-3-3M14 8H6" />
          </svg>
        </button>
      </div>
    </header>
  );
}
