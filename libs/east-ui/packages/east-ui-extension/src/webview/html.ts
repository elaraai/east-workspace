/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import * as vscode from 'vscode';

export function generateWebviewHtml(
    webview: vscode.Webview,
    webviewUri: vscode.Uri,
    serverUrl: string,
    repoPath: string
): string {
    const nonce = getNonce();
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; img-src ${cspSource} data:; font-src ${cspSource} data:; connect-src ${serverUrl} ${cspSource};">
    <title>East UI Preview</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}">
        window.__E3_API_URL__ = ${JSON.stringify(serverUrl)};
        window.__E3_REPO_PATH__ = ${JSON.stringify(repoPath)};
        window.__EAST_WASM_URL__ = "${webviewUri}/east-c.wasm";
        // Forward console.log/warn/error to VS Code output channel
        (function() {
            var vscode = acquireVsCodeApi();
            var origLog = console.log, origWarn = console.warn, origError = console.error;
            function forward(level, origFn, args) {
                origFn.apply(console, args);
                var parts = [];
                for (var i = 0; i < args.length; i++) {
                    try { parts.push(typeof args[i] === 'string' ? args[i] : JSON.stringify(args[i], function(k,v){ return typeof v === 'bigint' ? v.toString() + 'n' : v; })); } catch(e) { parts.push(String(args[i])); }
                }
                vscode.postMessage({ type: 'log', level: level, message: parts.join(' ') });
            }
            console.log = function() { forward('info', origLog, arguments); };
            console.warn = function() { forward('warn', origWarn, arguments); };
            console.error = function() { forward('error', origError, arguments); };
            // Catch uncaught errors with full stack trace
            window.addEventListener('error', function(ev) {
                forward('error', origError, [
                    '[uncaught]', ev.message,
                    '\\n  at ' + ev.filename + ':' + ev.lineno + ':' + ev.colno,
                    ev.error && ev.error.stack ? '\\n' + ev.error.stack : ''
                ]);
            });
            window.addEventListener('unhandledrejection', function(ev) {
                var r = ev.reason;
                forward('error', origError, [
                    '[unhandled promise]',
                    r instanceof Error ? r.message + '\\n' + r.stack : String(r)
                ]);
            });
        })();
    </script>
    <script nonce="${nonce}" src="${webviewUri}/index.js"></script>
</body>
</html>`;
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
