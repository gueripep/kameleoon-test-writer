document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('toggle-enabled');
  const daemonBadge = document.getElementById('daemon-badge');
  const targetingCard = document.getElementById('targeting-card');
  const targetingBadge = document.getElementById('targeting-badge');
  const targetingLabel = document.getElementById('targeting-label');
  const targetTabBtn = document.getElementById('target-tab-btn');
  const targetInfo = document.getElementById('target-info');
  const targetInfoText = document.getElementById('target-info-text');
  const targetClearBtn = document.getElementById('target-clear-btn');


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

  async function refreshUI() {
    chrome.runtime.sendMessage({ type: 'GET_DETAILED_STATE' }, (response) => {
      if (!response) return;

      const { isEnabled, connectionStatus, targetingResult, targetTab } = response;

      toggle.checked = isEnabled;
      updateHeaderUI(connectionStatus);

      if (targetTab) {
        targetInfo.style.display = 'block';
        targetInfoText.textContent = targetTab.title || targetTab.url;
        targetInfoText.title = targetTab.url;
      } else {
        targetInfo.style.display = 'none';
      }

      const isConnected = connectionStatus === 'connected';
      targetingCard.style.display = isEnabled && isConnected ? 'block' : 'none';

      if (targetingResult === null) {
        targetingBadge.textContent = 'N/A';
        targetingBadge.className = 'status-badge status-disconnected';
        targetingLabel.textContent = 'No targeting condition set';
      } else if (targetingResult === true) {
        targetingBadge.textContent = 'TRUE';
        targetingBadge.className = 'status-badge status-active';
        targetingLabel.textContent = 'Visitor is included';
      } else if (targetingResult === false) {
        targetingBadge.textContent = 'FALSE';
        targetingBadge.className = 'status-badge status-disabled';
        targetingLabel.textContent = 'Visitor is excluded';
      } else {
        targetingBadge.textContent = '—';
        targetingBadge.className = 'status-badge status-connecting';
        targetingLabel.textContent = 'Evaluating…';
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
