const vscode = require('vscode');
const path = require('path');

// Runs a workspace script in a reused terminal so its output stays visible.
const run = (cwd, script, arg) => {
    const name = 'Kameleoon Archive';
    const term = vscode.window.terminals.find(t => t.name === name) || vscode.window.createTerminal({ name, cwd });
    term.show();
    const quoted = a => `'${String(a).replace(/'/g, `'\\''`)}'`;
    term.sendText(`cd ${quoted(cwd)} && ./scripts/${script}${arg ? ` ${quoted(arg)}` : ''}`);
};

// The experiments folder is the parent of .archive/<folder>.
const rootFor = uri => path.dirname(path.dirname(uri.fsPath));

const activate = context => {
    context.subscriptions.push(
        vscode.commands.registerCommand('kameleoonArchive.restore', uri => {
            if (!uri) return vscode.window.showErrorMessage('Right-click a folder inside .archive/ to restore it.');
            run(rootFor(uri), 'restore.sh', uri.fsPath);
        }),
        vscode.commands.registerCommand('kameleoonArchive.archive', () => {
            const folder = vscode.workspace.workspaceFolders?.[0];
            if (!folder) return vscode.window.showErrorMessage('No workspace folder open.');
            run(folder.uri.fsPath, 'archive.sh');
        })
    );
};

module.exports = { activate, deactivate: () => {} };
