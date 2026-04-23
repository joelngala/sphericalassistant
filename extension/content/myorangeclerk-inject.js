// MAIN-world inject for myeclerk.myorangeclerk.com.
//
// On Case Details, clicking a docket row normally opens the PDF in a new
// tab. The portal uses either window.open(url) with a one-shot token or a
// hidden form.submit(). Both paths are monkey-patched here, but gated on
// a `capturing` flag the isolated-world script toggles only during a bulk
// save — otherwise we'd break every popup the site uses in normal browsing.
//
// When capturing, intercepted URLs/forms are postMessaged to the isolated
// world, and the navigation is swallowed so no tabs open.

(function () {
  if (window.__sphericalOcClerkHooked) return;
  window.__sphericalOcClerkHooked = true;

  let capturing = false;

  function post(type, data) {
    window.postMessage({ source: 'spherical-oc-inject', type, data }, '*');
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.source !== 'spherical-oc-control') return;
    if (e.data?.type === 'SET_CAPTURE') capturing = !!e.data.on;
  });

  const origOpen = window.open;
  window.open = function patchedOpen(url, target, features) {
    if (!capturing) return origOpen.call(window, url, target, features);
    try { post('WINDOW_OPEN', { url: String(url || ''), target: target || '' }); }
    catch (e) { console.error('[Spherical OC inject] window.open snapshot failed', e); }
    return { closed: true, close() {}, focus() {}, location: { href: '' } };
  };

  function snapshotForm(form) {
    return {
      action: form.action || '',
      method: (form.getAttribute('method') || form.method || 'POST').toUpperCase(),
      fields: Array.from(form.querySelectorAll('input, select, textarea'))
        .filter((el) => el.name)
        .map((el) => ({ name: el.name, value: el.value ?? '' })),
    };
  }

  const origSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function patchedSubmit() {
    if (!capturing) return origSubmit.apply(this, arguments);
    try { post('FORM_SUBMIT', snapshotForm(this)); }
    catch (e) { console.error('[Spherical OC inject] form.submit snapshot failed', e); }
  };

  document.addEventListener(
    'submit',
    (e) => {
      if (!capturing) return;
      const form = e.target;
      if (!form) return;
      try { post('FORM_SUBMIT', snapshotForm(form)); }
      catch (err) { console.error('[Spherical OC inject] submit event snapshot failed', err); }
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );

  console.log('[Spherical OC inject] hooks installed');
})();
