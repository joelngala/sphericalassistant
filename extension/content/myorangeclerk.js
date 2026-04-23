// ISOLATED-world content script for myeclerk.myorangeclerk.com.
//
// Activation: the dashboard's OrangeFlRecordsCard opens this site with a
// hash like  #spherical=first=Ernesto&last=Alvarenga . When the script
// sees that hash on the case-search page, it fills the form, scrolls the
// CAPTCHA into view, and badges the page so the user knows what we did.
// CAPTCHA + final Submit stay manual — we never auto-submit through the
// CAPTCHA gate.
//
// v1 stops here; v2 will scrape the results table and post back to the
// matter. Right now the "show" is going from name -> ready-to-submit
// search in zero clicks.

(function () {
  console.log('[Spherical OC Clerk] Content script loaded', window.location.pathname);

  const HASH_PREFIX = '#spherical=';
  const SEARCH_PATH_RE = /\/Cases\/Search/i;

  function parseHashParams(hash) {
    if (!hash || !hash.startsWith(HASH_PREFIX)) return null;
    const raw = decodeURIComponent(hash.slice(HASH_PREFIX.length));
    const params = new URLSearchParams(raw);
    const out = {};
    for (const [k, v] of params.entries()) out[k] = v;
    return out;
  }

  // The clerk's form uses ASP.NET-y controls — input names vary by build.
  // Try several conventions, then fall back to label matching.
  function findInput(candidates, labelMatchers = []) {
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    for (const matcher of labelMatchers) {
      const labels = Array.from(document.querySelectorAll('label'));
      const lbl = labels.find((l) => matcher.test(l.textContent || ''));
      if (lbl) {
        const forId = lbl.getAttribute('for');
        if (forId) {
          const el = document.getElementById(forId);
          if (el) return el;
        }
        // Sibling input
        const sib = lbl.parentElement?.querySelector('input, select');
        if (sib) return sib;
      }
    }
    return null;
  }

  function setField(el, value) {
    if (!el || value == null || value === '') return false;
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    return true;
  }

  function fillSearchForm(params) {
    const filled = [];

    const firstInput = findInput(
      [
        'input[name="FirstName"]',
        'input[name="firstName"]',
        'input[id*="FirstName" i]',
      ],
      [/^first\s*name$/i]
    );
    if (setField(firstInput, params.first)) filled.push('firstName');

    const lastInput = findInput(
      [
        'input[name="LastName"]',
        'input[name="lastName"]',
        'input[id*="LastName" i]',
      ],
      [/^last\s*name$/i]
    );
    if (setField(lastInput, params.last)) filled.push('lastName');

    const middleInput = findInput(
      [
        'input[name="MiddleName"]',
        'input[name="middleName"]',
        'input[id*="MiddleName" i]',
      ],
      [/^middle\s*name$/i]
    );
    if (setField(middleInput, params.middle)) filled.push('middleName');

    const caseInput = findInput(
      [
        'input[name="CaseNumber"]',
        'input[name="caseNumber"]',
        'input[id*="CaseNumber" i]',
      ],
      [/^case\s*number$/i]
    );
    if (setField(caseInput, params.caseNumber)) filled.push('caseNumber');

    const citationInput = findInput(
      [
        'input[name="CitationNumber"]',
        'input[name="citationNumber"]',
        'input[id*="CitationNumber" i]',
      ],
      [/^citation\s*number$/i]
    );
    if (setField(citationInput, params.citation)) filled.push('citationNumber');

    return filled;
  }

  function showBadge(filledFields) {
    if (document.getElementById('spherical-oc-clerk-badge')) return;
    const badge = document.createElement('div');
    badge.id = 'spherical-oc-clerk-badge';
    badge.style.cssText = [
      'position:fixed',
      'bottom:16px',
      'right:16px',
      'z-index:2147483647',
      'background:#1f2937',
      'color:#fff',
      'padding:12px 16px',
      'border-radius:8px',
      'font:13px -apple-system,BlinkMacSystemFont,sans-serif',
      'box-shadow:0 4px 12px rgba(0,0,0,.25)',
      'max-width:280px',
      'line-height:1.4',
    ].join(';');
    const fieldList = filledFields.length
      ? filledFields.join(', ')
      : '(no fields recognized — form may have changed)';
    badge.innerHTML = `<div style="font-weight:600;margin-bottom:4px">🍊 Spherical: prefilled ${filledFields.length} field${filledFields.length === 1 ? '' : 's'}</div>
      <div style="opacity:.85">${fieldList}</div>
      <div style="opacity:.7;margin-top:6px;font-size:12px">Solve the CAPTCHA and hit Search.</div>`;
    document.body.appendChild(badge);
    setTimeout(() => {
      badge.style.transition = 'opacity .4s';
      badge.style.opacity = '0.7';
    }, 6000);
  }

  function scrollCaptchaIntoView() {
    // reCAPTCHA / hCaptcha frames or any captcha container
    const captcha = document.querySelector(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [class*="captcha" i], [id*="captcha" i]'
    );
    if (captcha) captcha.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function runIfSearchPage() {
    if (!SEARCH_PATH_RE.test(window.location.pathname)) return;
    const params = parseHashParams(window.location.hash);
    if (!params) return;

    // Wait briefly for the form to mount — many clerk portals are
    // server-rendered but include a small JS hydration step.
    const tryFill = (attempt = 0) => {
      const filled = fillSearchForm(params);
      if (filled.length === 0 && attempt < 6) {
        setTimeout(() => tryFill(attempt + 1), 300);
        return;
      }
      showBadge(filled);
      scrollCaptchaIntoView();
    };
    tryFill();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runIfSearchPage);
  } else {
    runIfSearchPage();
  }
})();
