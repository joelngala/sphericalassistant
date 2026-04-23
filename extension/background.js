// MV3 service worker. Handles messages from the HOVER content script:
//
//   LIST_MATTERS          → list matter folders under /Spherical Assistant/
//   CAPTURE_DOCUMENT      → fetch the ViewDocument URL with credentials,
//                           upload the PDF blob to the chosen matter folder.
//
// The content script can't import modules, so it proxies Drive work through
// here. The popup still talks to Drive directly since it already has module
// support.

import { getStoredToken } from './lib/auth.js';
import { listMatterFolders, uploadFile } from './lib/drive.js';

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Spherical] extension installed');
});

async function requireToken() {
  const token = await getStoredToken();
  if (!token) throw new Error('Not connected — open the Spherical popup and click Connect Google.');
  return token.accessToken;
}

async function handleListMatters() {
  const accessToken = await requireToken();
  const folders = await listMatterFolders(accessToken);
  return { folders };
}

async function handleCaptureDocument({ url, filename, matterId, category, caseNumber, eventDescription }) {
  if (!url) throw new Error('Missing url');
  if (!matterId) throw new Error('Missing matterId');
  if (!filename) throw new Error('Missing filename');

  const accessToken = await requireToken();

  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HOVER returned ${res.status} fetching the PDF`);
  const contentType = res.headers.get('content-type') || 'application/pdf';
  if (!/pdf/i.test(contentType)) {
    throw new Error(`Expected a PDF, got ${contentType}. The session may have expired — reopen the document from HOVER.`);
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error('PDF response was empty');

  const appProperties = {
    sphericalSource: 'hover-extension',
    sphericalCategory: category || 'Other',
    sphericalCapturedAt: new Date().toISOString(),
  };
  if (caseNumber) appProperties.sphericalCaseNumber = caseNumber;
  if (eventDescription) appProperties.sphericalEventDescription = eventDescription.slice(0, 120);

  const file = await uploadFile(accessToken, {
    blob,
    filename,
    contentType: 'application/pdf',
    parentFolderId: matterId,
    appProperties,
  });
  return { file };
}

async function handleReplayDocviewSubmit({ action, method, fields, matterId, filename, category, caseNumber, eventDescription, documentIndex }) {
  if (!matterId) throw new Error('Missing matterId');
  if (!filename) throw new Error('Missing filename');
  if (!Array.isArray(fields) || !fields.length) throw new Error('Missing form fields');

  const accessToken = await requireToken();
  const targetUrl = action || 'https://hover.hillsclerk.com/FileManagement/ViewDocument';

  const body = new URLSearchParams();
  for (const f of fields) body.append(f.name, f.value ?? '');

  const res = await fetch(targetUrl, {
    method: (method || 'POST').toUpperCase(),
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`HOVER replay returned ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (!/pdf/i.test(contentType)) {
    const snippet = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
    throw new Error(`Expected PDF, got ${contentType}. Body: ${snippet}`);
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error('Empty PDF response');

  const appProperties = {
    sphericalSource: 'hover-extension',
    sphericalCategory: category || 'Court Filing',
    sphericalCapturedAt: new Date().toISOString(),
  };
  if (caseNumber) appProperties.sphericalCaseNumber = caseNumber;
  if (eventDescription) appProperties.sphericalEventDescription = eventDescription.slice(0, 120);
  if (documentIndex) appProperties.sphericalDocumentIndex = String(documentIndex);

  const file = await uploadFile(accessToken, {
    blob,
    filename: filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
    contentType: 'application/pdf',
    parentFolderId: matterId,
    appProperties,
  });
  return { file };
}

async function handleSearchWcca({ payload }) {
  const { lastName, firstName, countyNo } = payload;
  
  return new Promise((resolve, reject) => {
    // Open a new tab to WCCA
    chrome.tabs.create({ url: 'https://wcca.wicourts.gov/simpleCaseSearch.do', active: true }, (tab) => {
      const tabId = tab.id;
      
      // We will listen for a message from the WCCA content script
      // It will tell us when it's done scraping.
      const listener = (msg, sender) => {
        if (sender.tab?.id === tabId && msg.type === 'WCCA_SCRAPE_COMPLETE') {
          chrome.runtime.onMessage.removeListener(listener);
          // Optional: close the tab automatically after scraping
          // chrome.tabs.remove(tabId);
          resolve({ results: msg.results });
        } else if (sender.tab?.id === tabId && msg.type === 'WCCA_READY_FOR_PARAMS') {
          // Content script is ready, send the search params
          chrome.tabs.sendMessage(tabId, {
            type: 'WCCA_SEARCH_PARAMS',
            payload: { lastName, firstName, countyNo }
          });
        }
      };
      
      chrome.runtime.onMessage.addListener(listener);
      
      // Cleanup if the tab is closed before completing
      const tabClosedListener = (closedTabId) => {
        if (closedTabId === tabId) {
          chrome.runtime.onMessage.removeListener(listener);
          chrome.tabs.onRemoved.removeListener(tabClosedListener);
          reject(new Error('WCCA tab was closed before search completed.'));
        }
      };
      chrome.tabs.onRemoved.addListener(tabClosedListener);
    });
  });
}

import { callCopilot } from './lib/gemini.js';

async function handleCopilotChat({ apiKey, prompt, matterContext, chatHistory }) {
  // First, let's try to get the form schema from the active tab just in case Gemini needs it.
  let schema = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && !tab.url.startsWith('chrome://')) {
      // Inject agent.js if not already
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/agent.js']
      }).catch(() => {});
      
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'AGENT_GET_FORM' }).catch(() => null);
      if (res && res.schema) schema = res.schema;
    }
  } catch (err) {
    console.log('Could not get schema:', err);
  }

  // Call Gemini
  let res = await callCopilot(apiKey, prompt, matterContext, schema, chatHistory);

  // Handle function calls
  if (res.functionCall) {
    const { name, args } = res.functionCall;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (name === 'fill_form') {
      const payload = {};
      if (args.fields && Array.isArray(args.fields)) {
        for (const field of args.fields) {
          if (field.uid && field.value !== undefined) {
            payload[field.uid] = field.value;
          }
        }
      }
      const fillRes = await chrome.tabs.sendMessage(tab.id, { 
        type: 'AGENT_FILL_FORM', 
        payload 
      });
      return { 
        reply: `I have filled ${fillRes.count} fields based on the context! Please review them.`,
        actionTaken: 'filled'
      };
    } 
    else if (name === 'scrape_page') {
      const scrapeRes = await chrome.tabs.sendMessage(tab.id, { type: 'AGENT_SCRAPE_PAGE' });
      // We could send this back to Gemini, but for now just summarize locally
      return {
        reply: `I have scraped the page. It contains ${scrapeRes.text.length} characters of text.`,
        actionTaken: 'scraped',
        scrapedText: scrapeRes.text
      };
    }
  }

  return { reply: res.text };
}

const HANDLERS = {
  LIST_MATTERS: handleListMatters,
  CAPTURE_DOCUMENT: handleCaptureDocument,
  REPLAY_DOCVIEW_SUBMIT: handleReplayDocviewSubmit,
  SEARCH_WCCA: handleSearchWcca,
  COPILOT_CHAT: handleCopilotChat,
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) return false;
  handler(msg)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => {
      console.error('[Spherical bg]', msg.type, err);
      sendResponse({ ok: false, error: err.message || String(err) });
    });
  return true; // keep the message channel open for async response
});
