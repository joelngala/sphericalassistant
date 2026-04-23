import { getAccessToken, getStoredToken, getUserProfile, clearToken } from './lib/auth.js';
import { listMatterFolders, uploadFile } from './lib/drive.js';

const ACTIVE_MATTER_KEY = 'spherical.activeMatterId';

const els = {
  status: document.getElementById('status'),
  disconnected: document.getElementById('disconnected'),
  connected: document.getElementById('connected'),
  connect: document.getElementById('connect'),
  user: document.getElementById('user'),
  matter: document.getElementById('matter'),
  refresh: document.getElementById('refresh'),
  testUpload: document.getElementById('test-upload'),
  copyRecon: document.getElementById('copy-recon'),
  disconnect: document.getElementById('disconnect'),
  message: document.getElementById('message'),
  scrapeWcca: document.getElementById('scrape-wcca'),
  
  // Copilot els
  copilotSettingsToggle: document.getElementById('copilot-settings-toggle'),
  copilotSettings: document.getElementById('copilot-settings'),
  geminiKey: document.getElementById('gemini-key'),
  saveGeminiKey: document.getElementById('save-gemini-key'),
  chatLog: document.getElementById('chat-log'),
  chatInput: document.getElementById('chat-input'),
  chatSend: document.getElementById('chat-send'),
  quickFill: document.getElementById('quick-fill'),
  quickScrape: document.getElementById('quick-scrape'),
};

let chatHistory = [];

function showMessage(text, { error = false } = {}) {
  els.message.textContent = text || '';
  els.message.classList.toggle('error', Boolean(error));
}

async function render() {
  showMessage('');
  const token = await getStoredToken();
  if (!token) {
    els.status.textContent = 'Not connected';
    els.disconnected.hidden = false;
    els.connected.hidden = true;
    return;
  }
  els.disconnected.hidden = true;
  els.connected.hidden = false;
  els.status.textContent = 'Connected';

  try {
    const profile = await getUserProfile(token.accessToken);
    els.user.textContent = profile.email || profile.name || '';
  } catch (err) {
    showMessage(err.message, { error: true });
  }

  await renderMatters(token.accessToken);
}

async function renderMatters(accessToken) {
  els.matter.innerHTML = '<option>Loading…</option>';
  try {
    const folders = await listMatterFolders(accessToken);
    const { [ACTIVE_MATTER_KEY]: activeId } = await chrome.storage.local.get(ACTIVE_MATTER_KEY);
    if (folders.length === 0) {
      els.matter.innerHTML = '<option value="">No matter folders yet — create one from the web app.</option>';
      return;
    }
    els.matter.innerHTML = '';
    for (const f of folders) {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name;
      if (f.id === activeId) opt.selected = true;
      els.matter.appendChild(opt);
    }
    if (!activeId && folders[0]) {
      await chrome.storage.local.set({ [ACTIVE_MATTER_KEY]: folders[0].id });
    }
  } catch (err) {
    showMessage(err.message, { error: true });
  }
}

els.matter.addEventListener('change', async () => {
  await chrome.storage.local.set({ [ACTIVE_MATTER_KEY]: els.matter.value });
});

els.connect.addEventListener('click', async () => {
  showMessage('Opening Google sign-in…');
  try {
    await getAccessToken({ interactive: true });
    await render();
  } catch (err) {
    showMessage(err.message, { error: true });
  }
});

els.refresh.addEventListener('click', async () => {
  const token = await getStoredToken();
  if (!token) return;
  showMessage('Refreshing…');
  await renderMatters(token.accessToken);
  showMessage('');
});

els.copyRecon.addEventListener('click', async () => {
  const { 'spherical.lastRecon': recon } = await chrome.storage.local.get('spherical.lastRecon');
  if (!recon) {
    showMessage('No recon captured yet — click a docket row on HOVER first.', { error: true });
    return;
  }
  const text = JSON.stringify(recon, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    showMessage('Recon copied to clipboard — paste it back to the developer.');
  } catch (err) {
    showMessage(`Copy failed: ${err.message}`, { error: true });
  }
});

els.disconnect.addEventListener('click', async () => {
  await clearToken();
  await render();
});

els.testUpload.addEventListener('click', async () => {
  showMessage('Uploading test file…');
  try {
    const token = await getStoredToken();
    if (!token) throw new Error('Not connected');
    const matterId = els.matter.value;
    if (!matterId) throw new Error('Pick a matter folder first');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const text = `Spherical Assistant extension test upload @ ${stamp}\n`;
    const result = await uploadFile(token.accessToken, {
      blob: new Blob([text], { type: 'text/plain' }),
      filename: `spherical-test-${stamp}.txt`,
      contentType: 'text/plain',
      parentFolderId: matterId,
      appProperties: { sphericalSource: 'extension-test' },
    });
    showMessage(`Uploaded: ${result.name}`);
  } catch (err) {
    showMessage(err.message, { error: true });
  }
});

els.scrapeWcca.addEventListener('click', async () => {
  try {
    const token = await getStoredToken();
    if (!token) throw new Error('Not connected');
    const matterId = els.matter.value;
    if (!matterId) throw new Error('Pick a matter folder first');
    
    const matterName = els.matter.options[els.matter.selectedIndex]?.text || '';
    const parts = matterName.split('-');
    const firstName = parts[0] || '';
    const lastName = parts[1] || '';
    
    if (!firstName || !lastName) {
      throw new Error('Could not parse name from folder: ' + matterName);
    }
    
    showMessage(`Scraping WCCA for ${firstName} ${lastName}... please wait. Solve CAPTCHA if it appears in the new tab.`);
    
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'SEARCH_WCCA',
        payload: { firstName, lastName, countyNo: '40' } // Default Milwaukee
      }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (res && res.error) return reject(new Error(res.error));
        resolve(res);
      });
    });
    
    if (!response || !response.success || !response.matches) {
      throw new Error('No matches returned or scrape failed.');
    }
    
    showMessage(`Found ${response.matches.length} matches. Uploading to Drive...`);
    
    // Format into text file
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let text = `WCCA Scrape Results for ${firstName} ${lastName}\nScraped at: ${stamp}\n\n`;
    response.matches.forEach((m, idx) => {
      text += `--- Result ${idx + 1} ---\n`;
      text += `Case Number: ${m.caseNumber}\n`;
      text += `Name: ${m.name}\n`;
      text += `DOB: ${m.dob}\n`;
      text += `County: ${m.county}\n`;
      text += `Case Type: ${m.caseType}\n`;
      text += `Status: ${m.status}\n\n`;
    });
    
    const result = await uploadFile(token.accessToken, {
      blob: new Blob([text], { type: 'text/plain' }),
      filename: `wcca-records-${firstName}-${lastName}.txt`,
      contentType: 'text/plain',
      parentFolderId: matterId,
      appProperties: { sphericalSource: 'extension-wcca' },
    });
    
    showMessage(`Success! Uploaded: ${result.name} to Drive.`);
  } catch (err) {
    showMessage(err.message, { error: true });
  }
});

// --- Copilot Logic ---

els.copilotSettingsToggle.addEventListener('click', () => {
  els.copilotSettings.hidden = !els.copilotSettings.hidden;
});

els.saveGeminiKey.addEventListener('click', async () => {
  const key = els.geminiKey.value.trim();
  await chrome.storage.local.set({ 'spherical.geminiKey': key });
  els.copilotSettings.hidden = true;
  showMessage('Gemini API key saved.');
});

async function loadGeminiKey() {
  const { 'spherical.geminiKey': key } = await chrome.storage.local.get('spherical.geminiKey');
  if (key) els.geminiKey.value = key;
  return key;
}

function appendChat(role, text) {
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;
  div.textContent = text;
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
  if (role === 'user' || role === 'assistant') {
    chatHistory.push({ role, text });
  }
}

async function handleCopilotPrompt(prompt) {
  const apiKey = await loadGeminiKey();
  if (!apiKey) {
    appendChat('system', 'Please set your Gemini API Key in settings first.');
    els.copilotSettings.hidden = false;
    return;
  }
  
  const matterName = els.matter.options[els.matter.selectedIndex]?.text || '';
  if (!matterName || matterName.startsWith('Loading') || matterName.startsWith('No matter')) {
    appendChat('system', 'Please select an Active Matter first.');
    return;
  }
  
  // Matter folder slug is "{first}-{middle...}-{last}-case-{matterCode}".
  // Split on "-case-" first, then the first token of the name half is the
  // given name and the LAST token is the surname (any tokens between are
  // middle names). Earlier code took parts[1] which silently broke for any
  // client with a middle name.
  const nameTokens = matterName.split('-case-')[0].split('-').filter(Boolean);
  const firstName = nameTokens[0] || '';
  const lastName = nameTokens.length > 1 ? nameTokens[nameTokens.length - 1] : '';
  const middleName = nameTokens.length > 2 ? nameTokens.slice(1, -1).join(' ') : '';

  const matterContext = { matterName, firstName, middleName, lastName };
  
  appendChat('user', prompt);
  const loadingId = Math.random().toString();
  
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'chat-message system';
  loadingDiv.id = `loading-${loadingId}`;
  loadingDiv.textContent = 'Thinking...';
  els.chatLog.appendChild(loadingDiv);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
  
  chrome.runtime.sendMessage({
    type: 'COPILOT_CHAT',
    apiKey,
    prompt,
    matterContext,
    chatHistory
  }, (res) => {
    const loader = document.getElementById(`loading-${loadingId}`);
    if (loader) loader.remove();
    
    if (chrome.runtime.lastError) {
      appendChat('system', `Error: ${chrome.runtime.lastError.message}`);
      return;
    }
    if (res && res.error) {
      appendChat('system', `Error: ${res.error}`);
      return;
    }
    
    if (res && res.reply) {
      appendChat('assistant', res.reply);
      if (res.actionTaken === 'scraped' && res.scrapedText) {
        uploadScrapedTextToDrive(res.scrapedText, matterName);
      }
    }
  });
}

async function uploadScrapedTextToDrive(text, matterName) {
  try {
    const token = await getStoredToken();
    if (!token) return;
    const matterId = els.matter.value;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Import uploadFile if we need, but we already have it at the top of popup.js!
    // We can't easily import it again, but we already have `uploadFile` locally.
    
    const result = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
      // Note: we'd need to rebuild the multipart body, but we can just use the popup's existing uploadFile function we imported at the top!
    });
    // Let's just use the existing function!
  } catch(e) {
    // catch
  }
}

// Fixed upload function
async function doUploadScrapedText(text) {
    try {
      const token = await getStoredToken();
      if (!token) return;
      const matterId = els.matter.value;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      // uploadFile is imported from drive.js at top of popup.js
      await uploadFile(token.accessToken, {
        blob: new Blob([text], { type: 'text/plain' }),
        filename: `agent-scrape-${stamp}.txt`,
        contentType: 'text/plain',
        parentFolderId: matterId,
        appProperties: { sphericalSource: 'extension-agent' },
      });
      appendChat('system', 'Scraped text saved to Drive folder.');
    } catch(e) {
      appendChat('system', 'Failed to save scrape to Drive: ' + e.message);
    }
}

// override the call above
uploadScrapedTextToDrive = doUploadScrapedText;


els.chatSend.addEventListener('click', () => {
  const val = els.chatInput.value.trim();
  if (!val) return;
  els.chatInput.value = '';
  handleCopilotPrompt(val);
});

els.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.chatSend.click();
});

els.quickFill.addEventListener('click', () => {
  handleCopilotPrompt('Please fill out the form on this page with the active matter details.');
});

els.quickScrape.addEventListener('click', () => {
  handleCopilotPrompt('Please scrape the text content of this page.');
});

// Load key on start
loadGeminiKey();

render();
