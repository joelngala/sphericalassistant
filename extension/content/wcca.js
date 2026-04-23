// Content script running in the ISOLATED world on wcca.wicourts.gov

console.log('[Spherical WCCA] Content script loaded');

// Determine what page we are on
const isSearchPage = window.location.pathname.includes('/simpleCaseSearch.do');
const isResultsPage = window.location.pathname.includes('/partySearchResults.html');

if (isSearchPage) {
  // Let the background script know we are ready to receive params
  chrome.runtime.sendMessage({ type: 'WCCA_READY_FOR_PARAMS' });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'WCCA_SEARCH_PARAMS') {
      const { lastName, firstName, countyNo } = msg.payload;
      
      // Auto-fill the form
      const lastInput = document.querySelector('input[name="lastName"]');
      const firstInput = document.querySelector('input[name="firstName"]');
      const countySelect = document.querySelector('select[name="countyNo"]');
      
      if (lastInput) lastInput.value = lastName || '';
      if (firstInput) firstInput.value = firstName || '';
      if (countySelect && countyNo) countySelect.value = countyNo;
      
      // Click search
      const searchBtn = document.querySelector('button[name="search"]');
      if (searchBtn) {
        // If there's a CAPTCHA, clicking search might trigger it or the user might have to click it.
        // Let's scroll the button into view
        searchBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // We add a slight delay before clicking to ensure any JS listeners are attached
        setTimeout(() => {
          searchBtn.click();
        }, 500);
      }
    }
  });
} else if (isResultsPage) {
  // Scrape the results table
  const results = [];
  
  // WCCA results are usually in a table with class 'searchResults' or similar
  const table = document.querySelector('table.table-striped') || document.querySelector('table');
  if (table) {
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 5) {
        // This is highly dependent on WCCA's exact DOM structure, 
        // which might need tweaking based on the actual HTML.
        const caseNumber = cells[0]?.textContent?.trim();
        const partyName = cells[1]?.textContent?.trim();
        const dob = cells[2]?.textContent?.trim();
        const county = cells[3]?.textContent?.trim();
        const caseType = cells[4]?.textContent?.trim();
        const status = cells[5]?.textContent?.trim();
        
        if (caseNumber) {
          results.push({
            caseNumber,
            partyName,
            dob,
            county,
            caseType,
            status,
          });
        }
      }
    });
  }

  // Send the results back
  chrome.runtime.sendMessage({
    type: 'WCCA_SCRAPE_COMPLETE',
    results,
  });
}
