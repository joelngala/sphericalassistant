// HOVER content script — v2 capture + bulk flow.
//
// Two modes, keyed on pathname:
//
//   /FileManagement/ViewDocument
//     The PDF tab (fallback path only — bulk flow intercepts submit so this
//     page rarely loads anymore). Keeps the manual Save panel for the case
//     where HOVER's click-handler changes and our hook misses a submit.
//
//   everything else under hover.hillsclerk.com
//     Tracks which docket row was clicked (for filename context), listens
//     for DOCVIEW_SUBMIT messages from the page-world hook (hover-inject.js),
//     and mounts a "Save all documents" button that clicks every .docimg in
//     sequence — the hook captures each submit, we replay it via background
//     fetch, PDF lands in Drive. No new tabs open.

(function () {
  if (window.__sphericalHoverContent) return;
  window.__sphericalHoverContent = true;

  const log = (...args) => console.log('[Spherical HOVER]', ...args);
  const CASE_NUMBER_RE = /\b\d{2}-[A-Z]{2,4}-\d{4,7}(?:-[A-Z0-9]{1,3})?\b/;
  const LAST_CLICK_KEY = 'spherical.hoverLastClick';
  const ACTIVE_MATTER_KEY = 'spherical.activeMatterId';
  const CACHED_MATTERS_KEY = 'spherical.cachedMatters';

  const isViewDocument = /\/FileManagement\/ViewDocument/i.test(location.pathname);

  function findCaseNumber() {
    const fromTitle = document.title.match(CASE_NUMBER_RE)?.[0];
    if (fromTitle) return fromTitle;
    const fromBody = document.body?.innerText?.match(CASE_NUMBER_RE)?.[0];
    return fromBody || null;
  }

  function normHeader(s) {
    return String(s || '').replace(/\s+/g, '').toLowerCase();
  }

  function findDocketTable() {
    const tables = Array.from(document.querySelectorAll('table'));
    return tables.find((t) => {
      const headers = Array.from(t.rows[0]?.cells || []).map((c) => normHeader(c.textContent));
      return headers.includes('documentindex') && headers.includes('eventdescription');
    });
  }

  function slugify(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  function defaultFilename(ctx) {
    const stamp = new Date().toISOString().slice(0, 10);
    const parts = [];
    if (ctx?.caseNumber) parts.push(slugify(ctx.caseNumber));
    if (ctx?.documentIndex) parts.push(`doc${ctx.documentIndex}`);
    if (ctx?.eventDescription) parts.push(slugify(ctx.eventDescription));
    if (!parts.length) parts.push('hover-doc');
    parts.push(stamp);
    return `${parts.join('-')}.pdf`;
  }

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

  // ---------- Toast (shared) ----------

  function ensureToast() {
    let toast = document.getElementById('spherical-toast');
    if (toast) return toast;
    toast = document.createElement('div');
    toast.id = 'spherical-toast';
    Object.assign(toast.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      padding: '12px 14px',
      background: '#1f2328',
      color: '#fff',
      border: '1px solid #1a73e8',
      borderRadius: '8px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
      maxWidth: '360px',
      whiteSpace: 'pre-wrap',
    });
    document.body.appendChild(toast);
    return toast;
  }

  function setToast(text, { error = false } = {}) {
    const toast = ensureToast();
    toast.textContent = text;
    toast.style.borderColor = error ? '#b42318' : '#1a73e8';
  }

  // ---------- Case-detail mode ----------

  function attachRowClickTracker() {
    const table = findDocketTable();
    const headerCells = table ? Array.from(table.rows[0]?.cells || []).map((c) => normHeader(c.textContent)) : [];
    const COL_EVENT = headerCells.indexOf('eventdescription');
    const COL_INDEX = headerCells.indexOf('documentindex');
    const COL_DATE = headerCells.findIndex((h) => /date/.test(h));
    log('tracker mount', { tableFound: !!table, headerCells });

    document.addEventListener(
      'click',
      (e) => {
        const row = e.target.closest('tr');
        if (!row) return;
        const rowTable = row.closest('table');
        if (table && rowTable !== table) return;
        if (!table && !row.querySelector('img, button, a[onclick], input[type=image]')) return;
        if (row.rowIndex === 0) return;

        const cells = Array.from(row.cells);
        const ctx = {
          caseNumber: findCaseNumber(),
          eventDescription: COL_EVENT >= 0 ? (cells[COL_EVENT]?.textContent || '').trim() : '',
          documentIndex: COL_INDEX >= 0 ? (cells[COL_INDEX]?.textContent || '').trim() : '',
          filingDate: COL_DATE >= 0 ? (cells[COL_DATE]?.textContent || '').trim() : '',
          clickedAt: Date.now(),
          caseUrl: location.href,
        };
        chrome.storage.local.set({ [LAST_CLICK_KEY]: ctx });
      },
      true,
    );
  }

  // ---------- Submit-intercept coordination ----------
  //
  // hover-inject.js (page-world) monkey-patches #docview.submit() and
  // postMessages us the populated form. If we're mid-bulk, resolve the
  // pending promise; otherwise treat it as a manual one-off save.

  let pendingSubmit = null;

  function waitForSubmit(timeoutMs) {
    return new Promise((resolve, reject) => {
      pendingSubmit = { resolve, reject };
      setTimeout(() => {
        if (pendingSubmit) {
          pendingSubmit.reject(new Error('timed out waiting for HOVER submit'));
          pendingSubmit = null;
        }
      }, timeoutMs);
    });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.source !== 'spherical-inject') return;
    if (e.data?.type !== 'DOCVIEW_SUBMIT') return;
    const data = e.data.data;
    if (pendingSubmit) {
      const p = pendingSubmit;
      pendingSubmit = null;
      p.resolve(data);
    } else {
      handleManualSave(data);
    }
  });

  async function handleManualSave(submitData) {
    const stored = await chrome.storage.local.get([LAST_CLICK_KEY, ACTIVE_MATTER_KEY]);
    const ctx = stored[LAST_CLICK_KEY];
    const matterId = stored[ACTIVE_MATTER_KEY];
    if (!matterId) {
      setToast('No active matter — open the Spherical popup and pick one.', { error: true });
      return;
    }
    setToast(`Saving "${ctx?.eventDescription || 'document'}"…`);
    try {
      const res = await send('REPLAY_DOCVIEW_SUBMIT', {
        action: submitData.action,
        method: submitData.method,
        fields: submitData.fields,
        matterId,
        filename: defaultFilename(ctx),
        caseNumber: ctx?.caseNumber || null,
        eventDescription: ctx?.eventDescription || null,
        documentIndex: ctx?.documentIndex || null,
      });
      setToast(`Saved: ${res.file.name}`);
    } catch (err) {
      setToast(`Failed: ${err.message}`, { error: true });
    }
  }

  // ---------- Bulk save ----------

  function collectBulkTargets() {
    const table = findDocketTable();
    if (!table) return [];
    const headerCells = Array.from(table.rows[0].cells).map((c) => normHeader(c.textContent));
    const COL_EVENT = headerCells.indexOf('eventdescription');
    const COL_INDEX = headerCells.indexOf('documentindex');
    const COL_DATE = headerCells.findIndex((h) => /date/.test(h));
    const rows = Array.from(table.rows).slice(1);
    return rows
      .map((row) => {
        const btn = row.querySelector('button.docimg');
        if (!btn) return null;
        const cells = Array.from(row.cells);
        return {
          button: btn,
          eventDescription: COL_EVENT >= 0 ? (cells[COL_EVENT]?.textContent || '').trim() : '',
          documentIndex: COL_INDEX >= 0 ? (cells[COL_INDEX]?.textContent || '').trim() : '',
          filingDate: COL_DATE >= 0 ? (cells[COL_DATE]?.textContent || '').trim() : '',
        };
      })
      .filter(Boolean);
  }

  async function runBulkSave(matterId, caseNumber) {
    const targets = collectBulkTargets();
    if (!targets.length) {
      setToast('No documents to save on this page.', { error: true });
      return;
    }
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      setToast(`Saving ${i + 1}/${targets.length}: ${t.eventDescription || `doc ${t.documentIndex}`}`);
      const wait = waitForSubmit(15000);
      try {
        t.button.click();
        const submitData = await wait;
        const ctx = {
          caseNumber,
          eventDescription: t.eventDescription,
          documentIndex: t.documentIndex,
          filingDate: t.filingDate,
        };
        await send('REPLAY_DOCVIEW_SUBMIT', {
          action: submitData.action,
          method: submitData.method,
          fields: submitData.fields,
          matterId,
          filename: defaultFilename(ctx),
          caseNumber,
          eventDescription: t.eventDescription,
          documentIndex: t.documentIndex,
        });
        ok += 1;
      } catch (err) {
        failed += 1;
        console.error('[Spherical HOVER] bulk save failed for', t, err);
      }
      // Small gap so HOVER has time to reset form state between clicks.
      await new Promise((r) => setTimeout(r, 400));
    }
    setToast(`Done. Saved ${ok}, failed ${failed}.`, { error: failed > 0 });
  }

  function mountBulkButton() {
    if (document.getElementById('spherical-bulk-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'spherical-bulk-btn';
    btn.type = 'button';
    btn.textContent = 'Save all docs to Spherical';
    Object.assign(btn.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483646',
      padding: '10px 14px',
      background: '#1a73e8',
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
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

  // ---------- ViewDocument fallback panel ----------

  const CATEGORIES = ['Court Filing', 'Discovery', 'Order', 'Motion', 'Correspondence', 'Evidence', 'Other'];

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'spherical-capture-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      width: '320px',
      padding: '14px',
      background: '#fff',
      color: '#1f2328',
      border: '1px solid #d0d7de',
      borderRadius: '8px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
    });
    panel.innerHTML = `
      <div style="font-weight:600;font-size:14px;margin-bottom:8px">Save to Spherical</div>
      <label style="display:block;font-size:12px;font-weight:600;margin-top:6px">Matter folder</label>
      <select id="sph-matter" style="width:100%;padding:6px 8px;border:1px solid #d0d7de;border-radius:6px;font-size:13px;background:#fff"><option>Loading…</option></select>
      <label style="display:block;font-size:12px;font-weight:600;margin-top:8px">Filename</label>
      <input id="sph-filename" type="text" style="width:100%;padding:6px 8px;border:1px solid #d0d7de;border-radius:6px;font-size:13px" />
      <label style="display:block;font-size:12px;font-weight:600;margin-top:8px">Category</label>
      <select id="sph-category" style="width:100%;padding:6px 8px;border:1px solid #d0d7de;border-radius:6px;font-size:13px;background:#fff">
        ${CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}
      </select>
      <button id="sph-save" type="button" style="display:block;width:100%;padding:8px 12px;margin-top:12px;border-radius:6px;border:none;background:#1a73e8;color:#fff;font-size:13px;font-weight:500;cursor:pointer">Save to Drive</button>
      <div id="sph-msg" style="margin-top:8px;font-size:12px;color:#57606a;min-height:14px;word-break:break-word"></div>
    `;
    return panel;
  }

  function setMsg(panel, text, { error = false } = {}) {
    const el = panel.querySelector('#sph-msg');
    el.textContent = text || '';
    el.style.color = error ? '#b42318' : '#57606a';
  }

  async function mountCapturePanel() {
    if (document.getElementById('spherical-capture-panel')) return;
    const panel = buildPanel();
    document.body.appendChild(panel);

    const matterSel = panel.querySelector('#sph-matter');
    const filenameEl = panel.querySelector('#sph-filename');
    const categorySel = panel.querySelector('#sph-category');
    const saveBtn = panel.querySelector('#sph-save');

    const stored = await chrome.storage.local.get([LAST_CLICK_KEY, ACTIVE_MATTER_KEY, CACHED_MATTERS_KEY]);
    const ctx = stored[LAST_CLICK_KEY];
    const fresh = ctx && Date.now() - ctx.clickedAt < 5 * 60 * 1000 ? ctx : null;
    filenameEl.value = defaultFilename(fresh);

    function renderMatters(folders, activeId) {
      if (!folders.length) {
        matterSel.innerHTML = '<option value="">No matter folders yet</option>';
        return;
      }
      matterSel.innerHTML = '';
      for (const f of folders) {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.name;
        if (f.id === activeId) opt.selected = true;
        matterSel.appendChild(opt);
      }
      if (fresh?.caseNumber) {
        const token = slugify(fresh.caseNumber);
        const match = Array.from(matterSel.options).find((o) => o.textContent.toLowerCase().includes(token));
        if (match) match.selected = true;
      }
    }

    try {
      const res = await send('LIST_MATTERS');
      const folders = res.folders || [];
      chrome.storage.local.set({ [CACHED_MATTERS_KEY]: folders });
      renderMatters(folders, stored[ACTIVE_MATTER_KEY]);
    } catch (err) {
      if (stored[CACHED_MATTERS_KEY]?.length) {
        renderMatters(stored[CACHED_MATTERS_KEY], stored[ACTIVE_MATTER_KEY]);
        setMsg(panel, `Using cached matters. ${err.message}`, { error: true });
      } else {
        matterSel.innerHTML = '<option value="">—</option>';
        setMsg(panel, err.message, { error: true });
      }
    }

    matterSel.addEventListener('change', () => {
      chrome.storage.local.set({ [ACTIVE_MATTER_KEY]: matterSel.value });
    });

    saveBtn.addEventListener('click', async () => {
      const matterId = matterSel.value;
      const filename = filenameEl.value.trim();
      const category = categorySel.value;
      if (!matterId) return setMsg(panel, 'Pick a matter folder first', { error: true });
      if (!filename) return setMsg(panel, 'Filename required', { error: true });
      saveBtn.disabled = true;
      setMsg(panel, 'Fetching PDF…');
      try {
        const res = await send('CAPTURE_DOCUMENT', {
          url: location.href,
          filename: filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
          matterId,
          category,
          caseNumber: fresh?.caseNumber || null,
          eventDescription: fresh?.eventDescription || null,
        });
        setMsg(panel, `Saved: ${res.file.name}`);
      } catch (err) {
        setMsg(panel, err.message, { error: true });
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  // ---------- Boot ----------

  if (isViewDocument) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountCapturePanel);
    } else {
      mountCapturePanel();
    }
  } else {
    attachRowClickTracker();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountBulkButton);
    } else {
      mountBulkButton();
    }
  }

  log('content script v2 loaded', { mode: isViewDocument ? 'capture' : 'case', url: location.href });
})();
