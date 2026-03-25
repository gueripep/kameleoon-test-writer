document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('toggle-enabled');
  const daemonBadge = document.getElementById('daemon-badge');
  const workspaceName = document.getElementById('workspace-name');
  const workspacePath = document.getElementById('workspace-path');
  const fileList = document.getElementById('file-list');
  const tabList = document.getElementById('tab-list');
  const workspaceCard = document.getElementById('workspace-card');
  const filesCard = document.getElementById('files-card');
  const injectionsCard = document.getElementById('injections-card');


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

  async function refreshUI() {
    chrome.runtime.sendMessage({ type: 'GET_DETAILED_STATE' }, (response) => {
      if (!response) return;

      const { isEnabled, connectionStatus, currentState, injectedTabs } = response;
      
      toggle.checked = isEnabled;
      const isConnected = connectionStatus === 'connected';
      updateHeaderUI(connectionStatus);

      // Hide/Show sections based on state
      const shouldShowActiveInfo = isEnabled && isConnected;
      const displayStyle = shouldShowActiveInfo ? 'block' : 'none';
      workspaceCard.style.display = displayStyle;
      filesCard.style.display = displayStyle;
      injectionsCard.style.display = displayStyle;

      if (!shouldShowActiveInfo) return;
      if (currentState.workspaceName) {
        workspaceName.textContent = currentState.workspaceName;
        workspacePath.textContent = currentState.workspacePath;
      }



      // Update Files
      if (currentState.files && currentState.files.length > 0) {
        fileList.innerHTML = currentState.files.map(file => `
          <li class="file-item">
            <span class="file-icon">📄</span>
            <span>${file}</span>
          </li>
        `).join('');
      } else {
        fileList.innerHTML = '<li class="empty-state">No files tracked</li>';
      }

      // Update Tabs
      if (injectedTabs && injectedTabs.length > 0) {
        // Sort by last injected time desc
        const sortedTabs = [...injectedTabs].sort((a, b) => b.lastInjected - a.lastInjected);
        tabList.innerHTML = sortedTabs.map(tab => `
          <li class="tab-item">
            <span class="tab-icon">🌐</span>
            <div class="tab-info">
              <span class="tab-title" title="${tab.title}">${tab.title}</span>
              <span class="tab-url" title="${tab.url}">${new URL(tab.url).hostname}</span>
            </div>
          </li>
        `).join('');
      } else {
        tabList.innerHTML = '<li class="empty-state">No active injections</li>';
      }
    });
  }

  function updateHeaderUI(connectionStatus) {

    if (connectionStatus === 'connected') {
      daemonBadge.textContent = 'Daemon: On';
      daemonBadge.className = 'status-badge status-active';
    } else if (connectionStatus === 'connecting') {
      daemonBadge.textContent = 'Daemon: ...';
      daemonBadge.className = 'status-badge status-connecting';
    } else {
      daemonBadge.textContent = 'Daemon: Off';
      daemonBadge.className = 'status-badge status-disconnected';
    }
  }
});
