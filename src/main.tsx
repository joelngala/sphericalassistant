import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Intake from './pages/Intake.tsx'
import OAuthCallback from './pages/OAuthCallback.tsx'

const params = new URLSearchParams(window.location.search);
const page = params.get('page');

function Root() {
  if (page === 'intake') {
    const firmName = params.get('firm') || 'the firm';
    const embed = params.get('embed') === '1';
    return <Intake firmName={firmName} embed={embed} />;
  }
  if (page === 'oauth-callback') {
    return <OAuthCallback />;
  }
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
