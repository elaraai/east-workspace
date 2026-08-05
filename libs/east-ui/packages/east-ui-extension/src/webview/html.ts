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
        // Forward console.log/info/warn/error to VS Code output channel
        (function() {
            var vscode = acquireVsCodeApi();
            var origLog = console.log, origInfo = console.info, origWarn = console.warn, origError = console.error;
            function forward(level, origFn, args) {
                origFn.apply(console, args);
                var parts = [];
                for (var i = 0; i < args.length; i++) {
                    try { parts.push(typeof args[i] === 'string' ? args[i] : JSON.stringify(args[i], function(k,v){ return typeof v === 'bigint' ? v.toString() + 'n' : v; })); } catch(e) { parts.push(String(args[i])); }
                }
                vscode.postMessage({ type: 'log', level: level, message: parts.join(' ') });
            }
            console.log = function() { forward('info', origLog, arguments); };
            console.info = function() { forward('info', origInfo, arguments); };
            console.warn = function() { forward('warn', origWarn, arguments); };
            console.error = function() { forward('error', origError, arguments); };
            // Boot self-test: the API URL crosses the local/remote boundary in
            // SSH/WSL/Codespaces windows (the webview runs LOCALLY; the server
            // runs where the extension host is). A dropped port forward or a
            // dead server otherwise looks like an eternal blank panel — probe
            // it and say so, visibly.
            var apiUrl = window.__E3_API_URL__;
            var probe = new AbortController();
            var probeTimer = setTimeout(function() { probe.abort(); }, 5000);
            fetch(apiUrl + '/health', { signal: probe.signal }).then(function(res) {
                clearTimeout(probeTimer);
                console.log('[boot] e3 api reachable at ' + apiUrl + ' (status ' + res.status + ')');
            }).catch(function(err) {
                clearTimeout(probeTimer);
                console.error('[boot] e3 api UNREACHABLE at ' + apiUrl + ': ' + err
                    + ' — over a remote window this usually means the port forward dropped;'
                    + ' run "East UI: Open E3 Repository Preview" again to restart it.');
                var root = document.getElementById('root');
                if (root && !root.hasChildNodes()) {
                    root.innerHTML = '<div style="padding:2rem;font-family:sans-serif;max-width:40rem">'
                        + '<h3>Cannot reach the e3 server</h3>'
                        + '<p><code>' + apiUrl + '</code> did not answer within 5s.</p>'
                        + '<p>In a remote (SSH/WSL) window this usually means the port forward dropped or the server stopped. '
                        + 'Run <b>East UI: Open E3 Repository Preview</b> again to restart both.</p>'
                        + '</div>';
                }
            });
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
