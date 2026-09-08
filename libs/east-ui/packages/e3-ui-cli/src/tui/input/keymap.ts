/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The keymap — `resolve(input, key, ctx)` turns one Ink key event into a
 * semantic {@link KeyAction} by scope: the command box while editing, a
 * leaf editor while editing, then the view's own keys (list / tree / logs /
 * inputs), then the keys that work everywhere. Vim aliases (`j k h l`,
 * `gg G`, `^u ^d`) ride along.
 *
 * @packageDocumentation
 */

import type { Key } from 'ink';

/** Where the key lands. */
export type KeyScope = 'list' | 'tree' | 'logs' | 'none';

/** What the keymap needs to know. */
export interface KeyContext {
    /** The command box mode. */
    commandMode: 'idle' | 'edit' | 'confirm';
    /** Whether a leaf editor is open. */
    editingLeaf: boolean;
    /** The view's primary scope. */
    scope: KeyScope;
    /** Whether the view is an editable input. */
    editable: boolean;
    /** Whether the view has numbered tabs. */
    tabs: number;
    /** A pending multi-key prefix (`g`). */
    pendingKey: string | null;
}

/** A semantic key action. */
export type KeyAction =
    | { kind: 'move'; op: 'up' | 'down' | 'pageUp' | 'pageDown' | 'home' | 'end' }
    | { kind: 'open' }
    | { kind: 'back' }
    | { kind: 'quit' }
    | { kind: 'help' }
    | { kind: 'refresh' }
    | { kind: 'tab'; index: number }
    | { kind: 'nextPane'; reverse: boolean }
    | { kind: 'prefill'; text: string }
    | { kind: 'type'; text: string }
    | { kind: 'expand' }
    | { kind: 'collapse' }
    | { kind: 'toggle' }
    | { kind: 'collapseDeep' }
    | { kind: 'save' }
    | { kind: 'follow' }
    | { kind: 'stream'; stream: 'stdout' | 'stderr' }
    | { kind: 'next' }
    | { kind: 'prev' }
    | { kind: 'copy' }
    | { kind: 'edit' }
    | { kind: 'add' }
    | { kind: 'remove' }
    | { kind: 'tag' }
    | { kind: 'apply' }
    | { kind: 'discard' }
    | { kind: 'retry' }
    | { kind: 'pending'; key: string }
    | { kind: 'paste'; text: string; submit: boolean }
    | { kind: 'cmd.submit' }
    | { kind: 'cmd.cancel' }
    | { kind: 'cmd.complete' }
    | { kind: 'cmd.up' }
    | { kind: 'cmd.down' }
    | { kind: 'cmd.left' }
    | { kind: 'cmd.right' }
    | { kind: 'cmd.home' }
    | { kind: 'cmd.end' }
    | { kind: 'cmd.backspace' }
    | { kind: 'cmd.delete' }
    | { kind: 'cmd.char'; text: string }
    | { kind: 'leaf.submit' }
    | { kind: 'leaf.cancel' }
    | { kind: 'leaf.left' }
    | { kind: 'leaf.right' }
    | { kind: 'leaf.home' }
    | { kind: 'leaf.end' }
    | { kind: 'leaf.backspace' }
    | { kind: 'leaf.delete' }
    | { kind: 'leaf.char'; text: string }
    | { kind: 'leaf.toggle' };

/** Whether an input string is printable text (one or more characters, no controls). */
function isPrintable(input: string): boolean {
    if (input === '') return false;
    for (const ch of input) {
        const cp = ch.codePointAt(0) ?? 0;
        if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return false;
    }
    return true;
}

/**
 * Resolves one key event.
 *
 * @param input - Ink's `input` (the printable text, or `''` for special keys)
 * @param key - Ink's `key` flags
 * @param ctx - The context
 * @returns The action, or null when the key means nothing here
 */
export function resolve(input: string, key: Key, ctx: KeyContext): KeyAction | null {
    // Ctrl-C is always quit (we own Ctrl-C: exitOnCtrlC is off so a dirty
    // input can confirm first).
    if (key.ctrl && input === 'c') return { kind: 'quit' };

    // A paste (or a terminal delivering several keys in one chunk) arrives
    // as one string: it is typed into the command box, and a trailing
    // newline submits it.
    if (input.length > 1 && !key.ctrl && !key.meta && !ctx.editingLeaf && ctx.commandMode !== 'confirm') {
        const submit = /[\r\n]$/.test(input);
        const text = input.replace(/[\r\n]+$/, '');
        if (text !== '' && isPrintable(text)) return { kind: 'paste', text, submit };
    }

    if (ctx.commandMode === 'confirm') {
        if (key.return) return { kind: 'cmd.submit' };
        if (key.escape) return { kind: 'cmd.cancel' };
        if (input === 'y' || input === 'Y') return { kind: 'cmd.submit' };
        if (input === 'n' || input === 'N') return { kind: 'cmd.cancel' };
        return null;
    }

    if (ctx.commandMode === 'edit') {
        if (key.return) return { kind: 'cmd.submit' };
        if (key.escape) return { kind: 'cmd.cancel' };
        if (key.tab) return { kind: 'cmd.complete' };
        if (key.upArrow || (key.ctrl && input === 'p')) return { kind: 'cmd.up' };
        if (key.downArrow || (key.ctrl && input === 'n')) return { kind: 'cmd.down' };
        if (key.leftArrow) return { kind: 'cmd.left' };
        if (key.rightArrow) return { kind: 'cmd.right' };
        if (key.home || (key.ctrl && input === 'a')) return { kind: 'cmd.home' };
        if (key.end || (key.ctrl && input === 'e')) return { kind: 'cmd.end' };
        if (key.backspace) return { kind: 'cmd.backspace' };
        if (key.delete) return { kind: 'cmd.delete' };
        if (key.ctrl && input === 'u') return { kind: 'cmd.cancel' };
        if (!key.ctrl && !key.meta && isPrintable(input)) return { kind: 'cmd.char', text: input };
        return null;
    }

    if (ctx.editingLeaf) {
        if (key.return) return { kind: 'leaf.submit' };
        if (key.escape) return { kind: 'leaf.cancel' };
        if (key.leftArrow) return { kind: 'leaf.left' };
        if (key.rightArrow) return { kind: 'leaf.right' };
        if (key.home || (key.ctrl && input === 'a')) return { kind: 'leaf.home' };
        if (key.end || (key.ctrl && input === 'e')) return { kind: 'leaf.end' };
        if (key.backspace) return { kind: 'leaf.backspace' };
        if (key.delete) return { kind: 'leaf.delete' };
        if (input === ' ') return { kind: 'leaf.toggle' };
        if (!key.ctrl && !key.meta && isPrintable(input)) return { kind: 'leaf.char', text: input };
        return null;
    }

    // -- everywhere ---------------------------------------------------------
    if (key.escape || key.backspace) return { kind: 'back' };
    if (input === '?') return { kind: 'help' };
    if (input === 'q') return { kind: 'quit' };
    if (input === 'R') return { kind: 'refresh' };
    if (key.tab) return { kind: 'nextPane', reverse: key.shift };
    if (input === '/') return { kind: 'type', text: '/' };
    if (ctx.tabs > 0 && /^[1-9]$/.test(input) && Number(input) <= ctx.tabs) return { kind: 'tab', index: Number(input) - 1 };

    // -- pending prefixes (`gg`) --------------------------------------------
    if (ctx.pendingKey === 'g') {
        if (input === 'g') return { kind: 'move', op: 'home' };
        return null;
    }

    // -- lists / trees / logs -----------------------------------------------
    if (ctx.scope !== 'none') {
        if (key.upArrow || input === 'k') return { kind: 'move', op: 'up' };
        if (key.downArrow || input === 'j') return { kind: 'move', op: 'down' };
        if (key.pageUp || (key.ctrl && input === 'u')) return { kind: 'move', op: 'pageUp' };
        if (key.pageDown || (key.ctrl && input === 'd')) return { kind: 'move', op: 'pageDown' };
        if (key.home) return { kind: 'move', op: 'home' };
        if (key.end || input === 'G') return { kind: 'move', op: 'end' };
        if (input === 'g') return { kind: 'pending', key: 'g' };
    }
    if (ctx.scope === 'tree') {
        if (key.leftArrow && key.shift) return { kind: 'collapseDeep' };
        if (key.rightArrow || input === 'l') return { kind: 'expand' };
        if (key.leftArrow || input === 'h') return { kind: 'collapse' };
        if (key.return || input === ' ') return ctx.editable ? { kind: 'apply' } : { kind: 'toggle' };
        if (input === 's') return { kind: 'save' };
        if (input === 'n') return { kind: 'next' };
        if (input === 'N') return { kind: 'prev' };
        if (ctx.editable) {
            if (input === 'e') return { kind: 'edit' };
            if (input === 'a') return { kind: 'add' };
            if (input === 'x') return { kind: 'remove' };
            if (input === 't') return { kind: 'tag' };
        }
    }
    if (ctx.scope === 'logs') {
        if (input === 'F') return { kind: 'follow' };
        if (input === 'o') return { kind: 'stream', stream: 'stdout' };
        if (input === 'e') return { kind: 'stream', stream: 'stderr' };
        if (input === 's') return { kind: 'save' };
        if (input === 'c') return { kind: 'copy' };
        if (input === 'n') return { kind: 'next' };
        if (input === 'N') return { kind: 'prev' };
    }
    if (ctx.scope === 'list') {
        if (key.return) return { kind: 'open' };
        if (key.rightArrow || input === 'l') return { kind: 'open' };
        if (input === 'r' && !ctx.editable) return { kind: 'prefill', text: '/run ' };
        if (input === 'x' && !ctx.editable) return { kind: 'prefill', text: '/stop' };
        if (input === 'w') return { kind: 'prefill', text: '/workspaces' };
    }
    if (input === 'r' && ctx.scope === 'none') return { kind: 'retry' };

    // -- anything else printable starts a fuzzy jump ------------------------
    if (!key.ctrl && !key.meta && isPrintable(input) && input !== ' ') return { kind: 'type', text: input };
    return null;
}
