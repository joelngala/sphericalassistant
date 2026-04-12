/* Spherical Assistant — Legal Intake Widget Loader
 *
 * Embed on any website:
 *   <script
 *     src="https://joelngala.github.io/sphericalassistant/widget.js"
 *     data-firm="David Hurvitz Law Offices"
 *     data-greeting="Need a free consultation? Chat with me."
 *     data-accent="#6366f1"
 *     async
 *   ></script>
 *
 * Supported data-* attributes on the <script> tag:
 *   data-firm      — The firm name shown inside the chatbot. Required.
 *   data-greeting  — Text for the initial greeting bubble. Optional.
 *   data-accent    — Hex color for the launcher button. Defaults to #6366f1.
 *   data-delay     — Seconds before the greeting bubble pops. Defaults to 3.
 */
(function () {
  if (window.__sphericalIntakeWidgetLoaded) return;
  window.__sphericalIntakeWidgetLoaded = true;

  var script = document.currentScript;
  if (!script) {
    // Fallback: find a script tag with the widget.js src
    var all = document.getElementsByTagName('script');
    for (var i = 0; i < all.length; i++) {
      if (all[i].src && all[i].src.indexOf('widget.js') !== -1) {
        script = all[i];
        break;
      }
    }
  }
  if (!script) return;

  var scriptUrl;
  try {
    scriptUrl = new URL(script.src);
  } catch (e) {
    return;
  }

  var origin = scriptUrl.origin;
  var basePath = scriptUrl.pathname.replace(/widget\.js.*$/, '');
  var firmName = script.getAttribute('data-firm') || 'our firm';
  var greetingText = script.getAttribute('data-greeting') || 'Need a free consultation? Chat with us.';
  var accent = script.getAttribute('data-accent') || '#6366f1';
  var delaySeconds = parseFloat(script.getAttribute('data-delay') || '3');

  var intakeUrl =
    origin +
    basePath +
    '?page=intake&embed=1&firm=' +
    encodeURIComponent(firmName);

  // ---- Inject styles ----
  var css = [
    '.sai-widget-launcher{position:fixed;bottom:24px;right:24px;width:60px;height:60px;border-radius:50%;background:' + accent + ';color:#fff;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,0.25);z-index:2147483647;display:flex;align-items:center;justify-content:center;transition:transform 0.2s ease, box-shadow 0.2s ease;padding:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif}',
    '.sai-widget-launcher:hover{transform:scale(1.05);box-shadow:0 12px 32px rgba(0,0,0,0.3)}',
    '.sai-widget-launcher svg{width:26px;height:26px}',
    '.sai-widget-greeting{position:fixed;bottom:96px;right:24px;max-width:260px;background:#fff;color:#111;padding:14px 16px 14px 18px;border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,0.18);z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.4;opacity:0;transform:translateY(8px);transition:opacity 0.3s ease, transform 0.3s ease;pointer-events:none}',
    '.sai-widget-greeting::after{content:"";position:absolute;bottom:-7px;right:24px;width:14px;height:14px;background:#fff;transform:rotate(45deg);box-shadow:3px 3px 6px rgba(0,0,0,0.05)}',
    '.sai-widget-greeting.visible{opacity:1;transform:translateY(0);pointer-events:auto}',
    '.sai-widget-greeting-close{position:absolute;top:4px;right:6px;background:none;border:none;color:#9ca3af;font-size:16px;cursor:pointer;padding:2px 6px;line-height:1;font-family:inherit}',
    '.sai-widget-greeting-close:hover{color:#111}',
    '.sai-widget-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:2147483645;opacity:0;transition:opacity 0.25s ease}',
    '.sai-widget-backdrop.visible{opacity:1}',
    '.sai-widget-window{position:fixed;bottom:24px;right:24px;width:400px;height:620px;max-height:calc(100vh - 48px);background:#12121a;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.4);z-index:2147483646;overflow:hidden;display:flex;flex-direction:column;opacity:0;transform:translateY(16px) scale(0.98);transition:opacity 0.25s ease, transform 0.25s ease;font-family:-apple-system,BlinkMacSystemFont,sans-serif}',
    '.sai-widget-window.visible{opacity:1;transform:translateY(0) scale(1)}',
    '.sai-widget-close{position:absolute;top:10px;right:10px;width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;color:#fff;font-size:22px;line-height:1;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;font-family:inherit}',
    '.sai-widget-close:hover{background:rgba(255,255,255,0.2)}',
    '.sai-widget-iframe{flex:1;width:100%;border:none;background:#0a0a0f}',
    '@media (max-width:640px){',
    '.sai-widget-window{right:0;bottom:0;width:100%;height:100%;max-height:100%;border-radius:0}',
    '.sai-widget-launcher{bottom:16px;right:16px;width:56px;height:56px}',
    '.sai-widget-greeting{right:16px;bottom:84px}',
    '}',
  ].join('');

  var styleTag = document.createElement('style');
  styleTag.setAttribute('data-sai-widget', '');
  styleTag.textContent = css;
  document.head.appendChild(styleTag);

  // ---- Launcher button ----
  var launcher = document.createElement('button');
  launcher.className = 'sai-widget-launcher';
  launcher.setAttribute('aria-label', 'Open intake chatbot');
  launcher.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
    '</svg>';

  // ---- Greeting bubble ----
  var greeting = document.createElement('div');
  greeting.className = 'sai-widget-greeting';
  greeting.innerHTML =
    '<button class="sai-widget-greeting-close" aria-label="Dismiss">&times;</button>' +
    '<span></span>';
  greeting.querySelector('span').textContent = greetingText;

  var greetingClose = greeting.querySelector('.sai-widget-greeting-close');
  greetingClose.addEventListener('click', function (e) {
    e.stopPropagation();
    hideGreeting();
  });
  greeting.addEventListener('click', function () {
    openModal();
  });

  function hideGreeting() {
    greeting.classList.remove('visible');
    setTimeout(function () {
      if (greeting.parentNode) greeting.parentNode.removeChild(greeting);
    }, 300);
  }

  // ---- Modal state ----
  var modal = null;

  function openModal() {
    if (modal) return;
    hideGreeting();

    var backdrop = document.createElement('div');
    backdrop.className = 'sai-widget-backdrop';

    var windowEl = document.createElement('div');
    windowEl.className = 'sai-widget-window';
    windowEl.innerHTML =
      '<button class="sai-widget-close" aria-label="Close">&times;</button>' +
      '<iframe class="sai-widget-iframe" src="' + intakeUrl + '" allow="clipboard-write" title="Legal intake chatbot"></iframe>';

    document.body.appendChild(backdrop);
    document.body.appendChild(windowEl);

    // Trigger transition
    requestAnimationFrame(function () {
      backdrop.classList.add('visible');
      windowEl.classList.add('visible');
    });

    modal = { backdrop: backdrop, windowEl: windowEl };

    windowEl.querySelector('.sai-widget-close').addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);
    document.addEventListener('keydown', escHandler);
    launcher.style.display = 'none';
  }

  function closeModal() {
    if (!modal) return;
    modal.backdrop.classList.remove('visible');
    modal.windowEl.classList.remove('visible');
    var toRemove = modal;
    modal = null;
    setTimeout(function () {
      if (toRemove.backdrop.parentNode) toRemove.backdrop.parentNode.removeChild(toRemove.backdrop);
      if (toRemove.windowEl.parentNode) toRemove.windowEl.parentNode.removeChild(toRemove.windowEl);
    }, 260);
    document.removeEventListener('keydown', escHandler);
    launcher.style.display = '';
  }

  function escHandler(e) {
    if (e.key === 'Escape') closeModal();
  }

  launcher.addEventListener('click', openModal);

  // ---- postMessage from iframe ----
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'spherical-intake:close') {
      closeModal();
    }
    // Future: resize messages, submitted notifications, etc.
  });

  // ---- Mount ----
  function mount() {
    document.body.appendChild(launcher);
    document.body.appendChild(greeting);
    setTimeout(function () {
      if (greeting.parentNode) greeting.classList.add('visible');
    }, delaySeconds * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
