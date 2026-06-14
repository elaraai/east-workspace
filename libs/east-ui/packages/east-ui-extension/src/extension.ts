/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import * as os from 'os';
import * as vscode from 'vscode';
import { openPreviewCommand } from './commands/openPreview.js';
import { stopE3Server } from './server/e3Server.js';

export function activate(context: vscode.ExtensionContext) {
    console.log(`[east-ui] activated from: ${context.extensionPath}`);
    console.log(`[east-ui] extension mode: ${context.extensionMode === vscode.ExtensionMode.Development ? 'development' : context.extensionMode === vscode.ExtensionMode.Test ? 'test' : 'production'}`);
    console.log(`[east-ui] hostname: ${os.hostname()}`);

    // Both the command-palette entry and the Explorer right-click ("Open as E3
    // Repository") route to the same handler. The context menu passes the
    // clicked folder URI; the palette passes nothing and the handler prompts.
    const run = async (folder?: vscode.Uri) => {
        try {
            await openPreviewCommand(context, folder);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`East UI Preview failed: ${message}`);
            console.error('East UI Preview error:', error);
        }
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('east-ui.openPreview', () => run()),
        vscode.commands.registerCommand('east-ui.openRepositoryHere', (folder?: vscode.Uri) => run(folder)),
    );
}

export async function deactivate() {
    await stopE3Server();
}
