document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('toggle-enabled');
  const daemonBadge = document.getElementById('daemon-badge');
  const targetTabBtn = document.getElementById('target-tab-btn');
  const targetInfo = document.getElementById('target-info');
  const targetInfoText = document.getElementById('target-info-text');
  const targetClearBtn = document.getElementById('target-clear-btn');
  const ticketCard = document.getElementById('ticket-card');
  const ticketSubject = document.getElementById('ticket-subject');
  const ticketImportBtn = document.getElementById('ticket-import-btn');
  const ticketResult = document.getElementById('ticket-result');

  const HUBSPOT_TICKET_RE = /^https:\/\/app\.hubspot\.com\/contacts\/(\d+)\/record\/0-5\/(\d+)\b/;
  let ticketTabId = null;
  let importing = false;


  // Initial State Load
  refreshUI();

  // Polling for updates while popup is open
  const pollInterval = setInterval(refreshUI, 2000);
  window.addEventListener('unload', () => clearInterval(pollInterval));

  toggle.addEventListener('change', async () => {
    const enabled = toggle.checked;
    await chrome.storage.local.set({ enabled });
    chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', enabled });
  });

  targetTabBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    chrome.runtime.sendMessage({ type: 'SET_TARGET_TAB', tabId: tab.id }, () => {
      refreshUI();
    });
  });

  targetClearBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_TARGET_TAB' }, () => {
      refreshUI();
    });
  });

  ticketImportBtn.addEventListener('click', () => {
    if (importing || ticketTabId === null) return;
    importing = true;
    ticketImportBtn.disabled = true;
    ticketImportBtn.textContent = 'Importing\u2026';
    ticketResult.style.display = 'none';

    chrome.runtime.sendMessage({ type: 'IMPORT_TICKET', tabId: ticketTabId }, (response) => {
      importing = false;
      ticketImportBtn.disabled = false;
      ticketImportBtn.textContent = '\u2b07\ufe0e Import ticket';
      ticketResult.style.display = 'block';

      if (!response) {
        ticketResult.className = 'ticket-result err';
        ticketResult.textContent = 'No response from the extension background worker.';
        return;
      }
      if (!response.ok) {
        ticketResult.className = 'ticket-result err';
        ticketResult.textContent = response.error;
        return;
      }
      const r = response.result;
      const bits = [`Imported to ${r.folder} (overwrites any earlier import)`];
      if (r.imageTotal) bits.push(`${r.imageCount}/${r.imageTotal} images`);
      if (r.commentCount) bits.push(`${r.commentCount} comments`);
      if (r.warnings && r.warnings.length) bits.push(`\u26a0 ${r.warnings.join('; ')}`);
      ticketResult.className = r.warnings && r.warnings.length ? 'ticket-result err' : 'ticket-result ok';
      ticketResult.textContent = bits.join(' \u00b7 ');
    });
  });

  // The daemon does the writing, so an offline daemon means the button cannot work.
  async function refreshTicketCard(connectionStatus) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const match = tab && HUBSPOT_TICKET_RE.exec(tab.url || '');
    if (!match) {
      ticketCard.style.display = 'none';
      ticketTabId = null;
      return;
    }
    ticketTabId = tab.id;
    ticketCard.style.display = 'block';
    ticketSubject.textContent = tab.title || `Ticket ${match[2]}`;
    ticketSubject.title = tab.title || '';

    if (importing) return;
    const online = connectionStatus === 'connected';
    ticketImportBtn.disabled = !online;
    ticketImportBtn.textContent = online ? '\u2b07\ufe0e Import ticket' : 'Daemon offline';
  }

  async function refreshUI() {
    chrome.runtime.sendMessage({ type: 'GET_DETAILED_STATE' }, (response) => {
      if (!response) return;

      const { isEnabled, connectionStatus, targetTab } = response;

      toggle.checked = isEnabled;
      updateHeaderUI(connectionStatus);
      refreshTicketCard(connectionStatus);

      if (targetTab) {
        targetInfo.style.display = 'block';
        targetInfoText.textContent = targetTab.title || targetTab.url;
        targetInfoText.title = targetTab.url;
      } else {
        targetInfo.style.display = 'none';
      }
    });
  }

  function updateHeaderUI(connectionStatus) {
    if (connectionStatus === 'connected') {
      daemonBadge.textContent = 'Online';
      daemonBadge.className = 'status-badge status-active';
    } else if (connectionStatus === 'connecting') {
      daemonBadge.textContent = 'Connecting';
      daemonBadge.className = 'status-badge status-connecting';
    } else {
      daemonBadge.textContent = 'Offline';
      daemonBadge.className = 'status-badge status-disconnected';
    }
  }
});
