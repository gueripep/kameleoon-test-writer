const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');

const BRIDGE_PORT = 5678;
const quoted = a => `'${String(a).replace(/'/g, `'\\''`)}'`;

// Runs a workspace script in a reused terminal so its output stays visible.
const run = (cwd, script, arg) => {
    const name = 'Kameleoon Archive';
    const term = vscode.window.terminals.find(t => t.name === name) || vscode.window.createTerminal({ name, cwd });
    term.show();
    term.sendText(`cd ${quoted(cwd)} && ./scripts/${script}${arg ? ` ${quoted(arg)}` : ''}`);
};

// The experiments folder is the parent of .archive/<folder>.
const rootFor = uri => path.dirname(path.dirname(uri.fsPath));

// Works whether the repo root or experiments/ itself is the open folder.
const experimentsDir = () => {
    for (const folder of vscode.workspace.workspaceFolders || []) {
        for (const dir of [folder.uri.fsPath, path.join(folder.uri.fsPath, 'experiments')]) {
            if (fs.existsSync(path.join(dir, 'scripts', 'archive.sh'))) return dir;
        }
    }
    return null;
};

const readText = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const listDirs = dir => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; } };
const siteOf = dir => (readText(path.join(dir, 'variation.js')).match(/^\/\/ Site:\s*(\S+)/) || [])[1];
const hasWork = dir => ['variation.js', 'variation.css'].some(f => readText(path.join(dir, f)).trim());

// Talks to the daemon's control API (daemon/server.js). Resolves { status, body }, rejects when it isn't running.
const bridge = (method, route, body, timeout = 3000) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
        host: '127.0.0.1', port: BRIDGE_PORT, path: route, method, timeout,
        headers: { 'X-CRO-Client': 'vscode', ...(data && { 'Content-Type': 'application/json' }) }
    }, res => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
            let parsed = null;
            try { parsed = JSON.parse(raw); } catch { /* old daemon or non-JSON reply */ }
            resolve({ status: res.statusCode, body: parsed });
        });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
});

const createStatusBar = context => {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    item.show();
    const show = (text, tooltip) => {
        item.text = text;
        item.tooltip = tooltip;
    };

    const refresh = async () => {
        let res;
        try {
            res = await bridge('GET', '/status');
        } catch {
            return show('$(debug-disconnect) CRO offline', 'No bridge running. Starting a Claude session in experiments/ launches it.');
        }
        if (res.status !== 200 || !res.body) {
            return show('$(warning) CRO: restart bridge', 'The running bridge predates the control API. Restart your Claude session (or /mcp) to pick it up.');
        }
        const { connectedExtensions, extensions = [], warning } = res.body;
        if (!connectedExtensions) return show('$(warning) CRO: Chrome not connected', 'The bridge is up but the Chrome extension is not connected.');
        const ext = extensions[0];
        if (!ext) return show('$(warning) CRO: no reply', 'The Chrome extension did not answer the status request.');
        let host = null;
        try { host = ext.targetTabUrl && new URL(ext.targetTabUrl).host; } catch { /* chrome:// and the like */ }
        const where = host || 'no target tab';
        const tip = [
            host ? `Target: ${ext.targetTabUrl}` : 'No tab targeted: injection falls back to the active tab. Use "Target This Tab" in the extension popup.',
            !ext.isEnabled && 'Injection is turned off in the Chrome extension popup.',
            warning
        ].filter(Boolean).join('\n');
        show(ext.isEnabled ? `$(circle-filled) CRO · ${where}` : `$(debug-pause) CRO paused · ${where}`, tip);
    };

    refresh();
    const timer = setInterval(refresh, 5000);
    context.subscriptions.push(item, { dispose: () => clearInterval(timer) });
};

class ExperimentsTree {
    constructor() {
        this.emitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.emitter.event;
    }

    refresh() { this.emitter.fire(); }

    getTreeItem(item) { return item; }

    getChildren(parent) {
        const dir = experimentsDir();
        if (!dir) return [];
        if (!parent) {
            const site = siteOf(dir);
            const current = new vscode.TreeItem(`Current: ${site || (hasWork(dir) ? 'unnamed' : 'empty')}`);
            current.iconPath = new vscode.ThemeIcon('beaker');
            current.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(path.join(dir, 'variation.js'))] };
            const group = (label, kind, count) => {
                const g = new vscode.TreeItem(`${label} (${count})`, kind === 'archives' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
                g.kind = kind;
                return g;
            };
            return [current, group('Archive', 'archives', listDirs(path.join(dir, '.archive')).length), group('Tickets', 'tickets', listDirs(path.join(dir, '.tickets')).length)];
        }
        if (parent.kind === 'archives') {
            return listDirs(path.join(dir, '.archive')).sort().reverse().map(name => {
                const folder = path.join(dir, '.archive', name);
                const [, date, time, slug] = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{4})-(.*)$/) || [];
                const item = new vscode.TreeItem(slug || name);
                item.description = date ? `${date} ${time.slice(0, 2)}:${time.slice(2)}` : '';
                item.resourceUri = vscode.Uri.file(folder);
                item.iconPath = new vscode.ThemeIcon('archive');
                item.contextValue = 'archive';
                item.tooltip = siteOf(folder) ? `${name}\nSite: ${siteOf(folder)}` : name;
                const file = ['variation.js', 'variation.css'].map(f => path.join(folder, f)).find(f => fs.existsSync(f));
                if (file) item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(file)] };
                return item;
            });
        }
        if (parent.kind === 'tickets') {
            const root = path.join(dir, '.tickets');
            const mtime = name => { try { return fs.statSync(path.join(root, name)).mtimeMs; } catch { return 0; } };
            return listDirs(root).sort((a, b) => mtime(b) - mtime(a)).map(name => {
                const [, id, slug] = name.match(/^(\d+)-(.*)$/) || [null, '', name];
                const item = new vscode.TreeItem(slug.replace(/-/g, ' '));
                item.description = id;
                item.tooltip = name;
                item.iconPath = new vscode.ThemeIcon('issues');
                item.contextValue = 'ticket';
                item.ticketFolder = path.join('.tickets', name);
                item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(path.join(root, name, 'Objective.md'))] };
                return item;
            });
        }
        return [];
    }
}

const execScript = (cwd, script, ...args) => new Promise((resolve, reject) => {
    execFile('bash', [path.join('scripts', script), ...args], { cwd, timeout: 60000 }, (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).trim()));
        else resolve(stdout.trim());
    });
});

// Archives current work if any, opens the ticket, and starts Claude on it.
const startFromFolder = async (dir, ticketFolder) => {
    if (hasWork(dir)) {
        const label = siteOf(dir) || 'the current experiment';
        const pick = await vscode.window.showWarningMessage(`Archive ${label} and start from this ticket?`, { modal: true }, 'Archive & Start');
        if (pick !== 'Archive & Start') return;
        try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Archiving current experiment…' }, () => execScript(dir, 'archive.sh'));
        } catch (e) {
            return vscode.window.showErrorMessage(`Archive failed, nothing was reset: ${e.message}`);
        }
    }

    const objective = path.join(dir, ticketFolder, 'Objective.md');
    if (fs.existsSync(objective)) await vscode.window.showTextDocument(vscode.Uri.file(objective), { preview: false });

    const prompt = `Implement the HubSpot ticket in ${ticketFolder}/Objective.md (its screenshots are in the same folder).`;
    if (vscode.window.terminals.some(t => t.name.includes('Claude'))) {
        const pick = await vscode.window.showWarningMessage(
            'A Claude session is already open. A new one takes the bridge over from it.',
            { modal: true }, 'Start New Session', 'Copy Prompt Instead');
        if (pick === 'Copy Prompt Instead') {
            await vscode.env.clipboard.writeText(prompt);
            return vscode.window.showInformationMessage('Prompt copied. Paste it into your Claude session.');
        }
        if (pick !== 'Start New Session') return;
    }
    const term = vscode.window.createTerminal({ name: 'Claude Code', cwd: dir });
    term.show();
    term.sendText(`claude ${quoted(prompt)}`);
};

const startFromTicket = async () => {
    const dir = experimentsDir();
    if (!dir) return vscode.window.showErrorMessage('No experiments folder found in this workspace.');
    const url = await vscode.window.showInputBox({
        prompt: 'HubSpot ticket URL',
        placeHolder: 'https://app.hubspot.com/contacts/<portal>/record/0-5/<ticketId>/',
        ignoreFocusOut: true,
        validateInput: v => (/^https:\/\/app[\w-]*\.hubspot\.com\//.test(v.trim()) ? null : 'Paste a HubSpot ticket URL')
    });
    if (!url) return;
    let result;
    try {
        result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Importing ticket from HubSpot (can take a minute)…' },
            async () => {
                const res = await bridge('POST', '/import-ticket', { url: url.trim() }, 120000);
                if (res.status !== 200) throw new Error(res.body?.error || 'the running bridge has no control API; restart your Claude session');
                return res.body;
            });
    } catch (e) {
        const hint = e.code === 'ECONNREFUSED' ? 'the bridge is not running. Start a Claude session first' : e.message;
        return vscode.window.showErrorMessage(`Ticket import failed: ${hint}`);
    }
    if (result.warnings?.length) vscode.window.showWarningMessage(`Imported with warnings: ${result.warnings.join('; ')}`);
    await startFromFolder(dir, result.folder);
};

const activate = context => {
    const tree = new ExperimentsTree();
    const target = arg => arg?.resourceUri || arg;

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('kameleoonExperiments', tree),
        vscode.commands.registerCommand('kameleoonArchive.restore', async arg => {
            const uri = target(arg);
            if (!uri) return vscode.window.showErrorMessage('Right-click a folder inside .archive/ to restore it.');
            const dir = rootFor(uri);
            try {
                await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Restoring ${path.basename(uri.fsPath)}…` },
                    () => execScript(dir, 'restore.sh', uri.fsPath));
            } catch (e) {
                return vscode.window.showErrorMessage(`Restore failed: ${e.message}`);
            }
            await vscode.window.showTextDocument(vscode.Uri.file(path.join(dir, 'variation.js')), { preview: false });
        }),
        vscode.commands.registerCommand('kameleoonArchive.archive', () => {
            const dir = experimentsDir();
            if (!dir) return vscode.window.showErrorMessage('No experiments folder found in this workspace.');
            run(dir, 'archive.sh');
        }),
        vscode.commands.registerCommand('kameleoonArchive.compare', arg => {
            const folder = target(arg).fsPath;
            const dir = rootFor(target(arg));
            const file = ['variation.js', 'variation.css'].find(f => fs.existsSync(path.join(folder, f)));
            if (!file) return vscode.window.showErrorMessage('This archive has no variation files.');
            vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(path.join(folder, file)), vscode.Uri.file(path.join(dir, file)),
                `${path.basename(folder)} ↔ current ${file}`);
        }),
        vscode.commands.registerCommand('kameleoonArchive.startFromTicket', startFromTicket),
        vscode.commands.registerCommand('kameleoonArchive.startFromImportedTicket', item => {
            const dir = experimentsDir();
            if (dir && item?.ticketFolder) startFromFolder(dir, item.ticketFolder);
        }),
        vscode.commands.registerCommand('kameleoonArchive.refresh', () => tree.refresh())
    );

    const dir = experimentsDir();
    if (dir) {
        let pending = null;
        const refreshSoon = () => { clearTimeout(pending); pending = setTimeout(() => tree.refresh(), 300); };
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, '{.archive/**,.tickets/**,variation.js,variation.css}'));
        watcher.onDidCreate(refreshSoon);
        watcher.onDidDelete(refreshSoon);
        watcher.onDidChange(refreshSoon);
        context.subscriptions.push(watcher);
    }

    createStatusBar(context);
};

module.exports = { activate, deactivate: () => {} };
