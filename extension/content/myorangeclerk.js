// ISOLATED-world content script for myeclerk.myorangeclerk.com.
//
// Two modes, keyed on pathname:
//
//   /Cases/Search
//     The dashboard opens this site with a hash like
//     #spherical=first=Ernesto&last=Alvarenga ; the script fills the form,
//     scrolls the CAPTCHA into view, and badges the page. CAPTCHA + final
//     Submit stay manual — we never auto-submit through the CAPTCHA gate.
//
//   /CaseDetails
//     Mounts a "Save all docs to Spherical" button that iterates every
//     public docket row (tr.docketRec > a.dDescription[href]) and fetches
//     each /DocView/Doc?eCode=… URL via the background worker, which uploads
//     the PDF to the matter folder currently selected in the popup. Non-
//     public / VOR rows (tr.unclickable) have no link and are skipped.

(function () {
  console.log('[Spherical OC Clerk] Content script loaded', window.location.pathname);

  const HASH_PREFIX = '#spherical=';
  const SEARCH_PATH_RE = /\/Cases\/Search/i;
  const CASE_DETAILS_PATH_RE = /\/CaseDetails/i;
  const ACTIVE_MATTER_KEY = 'spherical.activeMatterId';

  // ---------- Search-page mode ----------

  function parseHashParams(hash) {
    if (!hash || !hash.startsWith(HASH_PREFIX)) return null;
    const raw = decodeURIComponent(hash.slice(HASH_PREFIX.length));
    const params = new URLSearchParams(raw);
    const out = {};
    for (const [k, v] of params.entries()) out[k] = v;
    return out;
  }

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
      ['input[name="FirstName"]', 'input[name="firstName"]', 'input[id*="FirstName" i]'],
      [/^first\s*name$/i]
    );
    if (setField(firstInput, params.first)) filled.push('firstName');

    const lastInput = findInput(
      ['input[name="LastName"]', 'input[name="lastName"]', 'input[id*="LastName" i]'],
      [/^last\s*name$/i]
    );
    if (setField(lastInput, params.last)) filled.push('lastName');

    const middleInput = findInput(
      ['input[name="MiddleName"]', 'input[name="middleName"]', 'input[id*="MiddleName" i]'],
      [/^middle\s*name$/i]
    );
    if (setField(middleInput, params.middle)) filled.push('middleName');

    const caseInput = findInput(
      ['input[name="CaseNumber"]', 'input[name="caseNumber"]', 'input[id*="CaseNumber" i]'],
      [/^case\s*number$/i]
    );
    if (setField(caseInput, params.caseNumber)) filled.push('caseNumber');

    const citationInput = findInput(
      ['input[name="CitationNumber"]', 'input[name="citationNumber"]', 'input[id*="CitationNumber" i]'],
      [/^citation\s*number$/i]
    );
    if (setField(citationInput, params.citation)) filled.push('citationNumber');

    return filled;
  }

  function showSearchBadge(filledFields) {
    if (document.getElementById('spherical-oc-clerk-badge')) return;
    const badge = document.createElement('div');
    badge.id = 'spherical-oc-clerk-badge';
    badge.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483647',
      'background:#1f2937', 'color:#fff', 'padding:12px 16px', 'border-radius:8px',
      'font:13px -apple-system,BlinkMacSystemFont,sans-serif',
      'box-shadow:0 4px 12px rgba(0,0,0,.25)', 'max-width:280px', 'line-height:1.4',
    ].join(';');
    const fieldList = filledFields.length
      ? filledFields.join(', ')
      : '(no fields recognized — form may have changed)';
    badge.innerHTML = `<div style="font-weight:600;margin-bottom:4px">Spherical: prefilled ${filledFields.length} field${filledFields.length === 1 ? '' : 's'}</div>
      <div style="opacity:.85">${fieldList}</div>
      <div style="opacity:.7;margin-top:6px;font-size:12px">Solve the CAPTCHA and hit Search.</div>`;
    document.body.appendChild(badge);
    setTimeout(() => {
      badge.style.transition = 'opacity .4s';
      badge.style.opacity = '0.7';
    }, 6000);
  }

  function scrollCaptchaIntoView() {
    const captcha = document.querySelector(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [class*="captcha" i], [id*="captcha" i]'
    );
    if (captcha) captcha.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function runIfSearchPage() {
    if (!SEARCH_PATH_RE.test(window.location.pathname)) return;
    const params = parseHashParams(window.location.hash);
    if (!params) return;

    const tryFill = (attempt = 0) => {
      const filled = fillSearchForm(params);
      if (filled.length === 0 && attempt < 6) {
        setTimeout(() => tryFill(attempt + 1), 300);
        return;
      }
      showSearchBadge(filled);
      scrollCaptchaIntoView();
    };
    tryFill();
  }

  // ---------- Case-details mode ----------

  function send(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...payload }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res) return reject(new Error('No response from background'));
        if (res.error) return reject(new Error(res.error));
        resolve(res);
      });
    });
  }

  function slugify(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  function findCaseNumber() {
    const input = document.querySelector('#detailsCaseNumber');
    if (input?.value) return input.value.trim();
    const heading = document.querySelector('#caseDetails .panel-heading');
    const m = heading?.textContent?.match(/\d{4}-[A-Z]{2,4}-\d{3,7}(?:-[A-Z0-9]{1,3})?(?:-[A-Z])?/);
    return m?.[0] || null;
  }

  function collectDocketTargets() {
    const rows = Array.from(document.querySelectorAll('#docketTable tbody tr.docketRec'));
    return rows
      .map((row) => {
        const link = row.querySelector('a.dDescription[href]');
        if (!link) return null;
        const href = link.getAttribute('href') || '';
        const absolute = href ? new URL(href, location.href).toString() : '';
        if (!absolute) return null;
        const date = row.querySelector('td.dDate')?.textContent?.trim() || '';
        const description = link.textContent?.trim() || '';
        const docId = row.querySelector('td.hDocId')?.textContent?.trim() || '';
        const pageCount = row.querySelector('td.dPageCount')?.textContent?.trim() || '';
        return { href: absolute, date, description, docId, pageCount };
      })
      .filter(Boolean);
  }

  function filenameFor({ caseNumber, description, date, docId, index }) {
    const parts = [];
    if (date) {
      const m = date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) parts.push(`${m[3]}-${m[1]}-${m[2]}`);
    }
    if (caseNumber) parts.push(slugify(caseNumber));
    if (docId) parts.push(`doc${docId}`);
    else if (index != null) parts.push(`row${index + 1}`);
    if (description) parts.push(slugify(description));
    if (!parts.length) parts.push('oc-clerk-doc');
    return `${parts.join('-')}.pdf`;
  }

  function ensureToast() {
    let toast = document.getElementById('spherical-oc-toast');
    if (toast) return toast;
    toast = document.createElement('div');
    toast.id = 'spherical-oc-toast';
    Object.assign(toast.style, {
      position: 'fixed', right: '16px', bottom: '72px', zIndex: '2147483647',
      padding: '12px 14px', background: '#1f2328', color: '#fff',
      border: '1px solid #1a73e8', borderRadius: '8px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px', maxWidth: '360px', whiteSpace: 'pre-wrap',
    });
    document.body.appendChild(toast);
    return toast;
  }

  function setToast(text, { error = false } = {}) {
    const toast = ensureToast();
    toast.textContent = text;
    toast.style.borderColor = error ? '#b42318' : '#1a73e8';
  }

  async function runBulkSave(matterId, caseNumber) {
    const targets = collectDocketTargets();
    if (!targets.length) {
      setToast('No downloadable documents found in the Docket Events table.', { error: true });
      return;
    }
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const label = t.description || `row ${i + 1}`;
      setToast(`Saving ${i + 1}/${targets.length}: ${label}`);
      try {
        await send('CAPTURE_DOCUMENT', {
          url: t.href,
          filename: filenameFor({ caseNumber, description: t.description, date: t.date, docId: t.docId, index: i }),
          matterId,
          category: 'Court Filing',
          caseNumber,
          eventDescription: t.description,
          source: 'oc-clerk-extension',
        });
        ok += 1;
      } catch (err) {
        failed += 1;
        console.error('[Spherical OC Clerk] save failed for', t, err);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    setToast(`Done. Saved ${ok}, failed ${failed}.`, { error: failed > 0 });
  }

  function mountBulkButton() {
    if (document.getElementById('spherical-oc-bulk-btn')) return;
    if (!document.querySelector('#docketTable tbody tr.docketRec a.dDescription[href]')) return;
    const btn = document.createElement('button');
    btn.id = 'spherical-oc-bulk-btn';
    btn.type = 'button';
    btn.textContent = 'Save all docs to Spherical';
    Object.assign(btn.style, {
      position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483646',
      padding: '10px 14px', background: '#1a73e8', color: '#fff',
      border: 'none', borderRadius: '6px', fontSize: '14px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const { [ACTIVE_MATTER_KEY]: matterId } = await chrome.storage.local.get(ACTIVE_MATTER_KEY);
        if (!matterId) {
          setToast('Open the Spherical popup and pick a matter folder first.', { error: true });
          return;
        }
        await runBulkSave(matterId, findCaseNumber());
      } finally {
        btn.disabled = false;
      }
    });
    document.body.appendChild(btn);
  }

  function runIfCaseDetailsPage() {
    if (!CASE_DETAILS_PATH_RE.test(window.location.pathname)) return;
    mountBulkButton();
  }

  // ---------- Boot ----------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      runIfSearchPage();
      runIfCaseDetailsPage();
    });
  } else {
    runIfSearchPage();
    runIfCaseDetailsPage();
  }
})();
