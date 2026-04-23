// Page-world script — runs in the same JS context as HOVER's own code at
// document_start so our form.submit() monkey-patch is in place before any
// click handler fires.
//
// HOVER's click handler for a docket row's Image button fetches per-document
// tokens via XHR, populates #docview's hidden inputs, then calls
// #docview.submit() to open the PDF in a new tab. We intercept that submit,
// snapshot the populated form, and postMessage it to our content script for
// replay via background fetch — so no new tab opens and no popup blocker
// kicks in when we iterate for bulk save.

(function () {
  if (window.__sphericalDocviewHooked) return;
  window.__sphericalDocviewHooked = true;

  const FORM_ID = 'docview';

  function snapshot(form) {
    return {
      action: form.action || '',
      method: (form.getAttribute('method') || form.method || 'POST').toUpperCase(),
      fields: Array.from(form.querySelectorAll('input, select, textarea'))
        .filter((el) => el.name)
        .map((el) => ({ name: el.name, value: el.value ?? '' })),
    };
  }

  function notify(data) {
    window.postMessage({ source: 'spherical-inject', type: 'DOCVIEW_SUBMIT', data }, '*');
  }

  const origSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function patchedSubmit() {
    if (this.id === FORM_ID) {
      try {
        notify(snapshot(this));
      } catch (e) {
        console.error('[Spherical inject] snapshot failed', e);
      }
      return; // swallow the original — we replay via fetch
    }
    return origSubmit.apply(this, arguments);
  };

  // Some frameworks dispatch a submit event via a <button type=submit>; catch
  // those too and cancel the navigation.
  document.addEventListener(
    'submit',
    (e) => {
      const form = e.target;
      if (!form || form.id !== FORM_ID) return;
      try {
        notify(snapshot(form));
      } catch (err) {
        console.error('[Spherical inject] snapshot failed', err);
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );

  console.log('[Spherical inject] docview submit hook installed');
})();
