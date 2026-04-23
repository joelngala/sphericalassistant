// Agentic content script injected on demand to interact with the current page.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'AGENT_SCRAPE_PAGE') {
    const text = document.body.innerText;
    sendResponse({ text: text.slice(0, 15000) }); // Limit to 15k chars for prompt size
  } 
  
  else if (msg.type === 'AGENT_GET_FORM') {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    const schema = inputs.map(el => {
      // Try to find an associated label
      let labelText = '';
      if (el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label) labelText = label.innerText.trim();
      }
      if (!labelText && el.name) labelText = el.name;
      if (!labelText && el.placeholder) labelText = el.placeholder;
      if (!labelText && el.ariaLabel) labelText = el.ariaLabel;
      
      // Determine type
      let type = el.tagName.toLowerCase();
      if (type === 'input') type = el.type || 'text';
      
      // Only return useful fields
      if (type === 'hidden' || type === 'submit' || type === 'button') return null;
      
      // Unique identifier for filling later
      const uid = el.id || el.name || Math.random().toString(36).substring(7);
      if (!el.dataset.agentUid) el.dataset.agentUid = uid;
      
      return {
        uid: el.dataset.agentUid,
        type,
        label: labelText,
      };
    }).filter(Boolean);
    
    sendResponse({ schema });
  }
  
  else if (msg.type === 'AGENT_FILL_FORM') {
    const values = msg.payload; // { uid: "value" }
    let filled = 0;
    
    for (const [uid, value] of Object.entries(values)) {
      const el = document.querySelector(`[data-agent-uid="${uid}"]`);
      if (el) {
        if (el.type === 'checkbox' || el.type === 'radio') {
          // Simplistic handling for demo
          el.checked = Boolean(value);
        } else {
          el.value = value;
        }
        // Dispatch events so React/Vue/Angular picks up the change
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        filled++;
      }
    }
    
    sendResponse({ success: true, count: filled });
  }
  
  return true; // Keep channel open
});
