# Live Experiment Workspace

This folder is where you write your A/B testing code. Any `.js` or `.css` file you save here is instantly pushed to your browser. No refreshes, no waiting.

## The Workflow

1.  **Open Chrome**: Head to the site you're testing.
2.  **Code**: Create a `.js` or `.css` file in this folder.
3.  **Save & See**: Hit `Cmd+S` (or `Ctrl+S`). The changes hit the page instantly.

## Pro Tips

*   **CSS Hot-Reload**: Styles update in real-time without a page refresh.
*   **JS Injection**: Your JavaScript is safely wrapped and executed immediately when you save.
*   **Tab Targeting**: Click the extension icon on the browser tab you want to work on, then press **Target This Tab**. The tab is moved into a labeled "CRO Target" tab group and becomes the sole target for injection — no config file needed.
*   **Full Page Reload**: Sometimes injection isn't enough. Add `// @reload` or `/* @reload */` anywhere in your JS/CSS file and save (Cmd+S). The browser page will fully reload instead of just injecting the code.
*   **CLI Trigger**: Run `node local-cro-workflow/cli/bin/reload.js` to trigger a reload manually via terminal.
