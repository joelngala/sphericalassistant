// Bridge script injected into the React App (e.g. localhost:5173)
// Listens for messages from the React app and forwards them to the extension background script.

window.addEventListener('message', (event) => {
  // Only accept messages from the same window
  if (event.source !== window) return;

  const data = event.data;
  if (data && data.type === 'spherical-intake:search-wcca') {
    // Forward to background script
    chrome.runtime.sendMessage({
      type: 'SEARCH_WCCA',
      payload: data.payload,
    }, (response) => {
      // Send the response back to the React app
      window.postMessage({
        type: 'spherical-intake:search-wcca-response',
        response,
        requestId: data.requestId
      }, '*');
    });
  }
});

// Let the React app know the extension is ready
window.postMessage({ type: 'spherical-intake:extension-ready' }, '*');
