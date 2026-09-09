/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The input view — the same tree as a task's output, editable: `e` opens
 * the leaf editor in the value cell, `a` adds an item or entry, `x`
 * removes one, `t` switches a variant tag or sets / clears an option;
 * the commit bar sums the pending ops and `⏎ APPLY` writes them with
 * `datasetSet`, `esc DISCARD` drops them. A value that changed on the
 * server while editing raises the conflict banner: `⏎` reloads and
 * re-applies the ops, `esc` keeps editing. Paged (large collection)
 * inputs stay read-only, as on the web.
 *
 * @packageDocumentation
 */

import { variant } from '@elaraai/east';
import { encodeDatasetBlob } from '@elaraai/e3-types';
import type { RowModel } from '@elaraai/east-ui/internal';
import { describeError, treePathOf } from '../../api.js';
import { registerViewHooks, type Controller } from '../../controller.js';
import { describeOp, pushOp, replay, startEdit } from '../../data/edit-buffer.js';
import type { ParsedCommand } from '../../input/commands.js';
import type { KeyAction } from '../../input/keymap.js';
import { registerListModel } from '../../model/index.js';
import { datasetStatusCell } from '../../model/status.js';
import { formatInt, hashTiny } from '../../render/text.js';
import type { EditOp, TuiState } from '../../state/actions.js';
import { dirtyCount } from '../../state/reducer.js';
import type { Hit, Pane } from '../frame.js';
import { b, blank, d, lrLine, rule, t, type Line, type RenderCtx } from '../lines.js';
import { centredBlock, tabStripHits } from '../shell/widgets.js';
import { editKey, editorText, initialText, leafKindOf, parseLeaf } from '../widgets/leaf-editor.js';
import { clickTree, renderTreeRows, scrollTree, treeCommand, treeContext, treeFooter, treeKey, treeModel, treeToolbar, TREE_CHROME_ROWS, type TreeContext } from '../widgets/tree.js';
import { datasetLine } from './task.js';
import { registerView } from './index.js';

/** The conflict banner, when the value changed on the server while editing. */
function conflictLine(state: TuiState, ws: string, path: string, ctx: RenderCtx): Line | null {
    const edit = state.edit;
    if (edit === null || edit.ws !== ws || edit.path !== path || edit.conflict === null) return null;
    const g = ctx.g;
    return lrLine(
        [t(' '), b(`${g.half} CHANGED ON THE SERVER`, 'warn'), t(' while you were editing'), d(` ${g.sep} ${hashTiny(edit.baseHash)} ${g.right} ${hashTiny(edit.conflict)}`)],
        [d(`${g.enter} reload and re-apply ${g.sep} esc keep editing`), t(' ')],
        ctx.layout.columns,
    );
}

/** The title line's right side: `INPUT · ◐ STALE · read by features, forecast`. */
function inputTitle(state: TuiState, ws: string, path: string, ctx: RenderCtx): Line {
    const g = ctx.g;
    const status = state.data.status[ws]?.result;
    const out: Line = [d('INPUT')];
    const ds = status?.datasets.find(x => x.path === path);
    if (ds !== undefined) {
        const cell = datasetStatusCell(ds.status.type, g);
        out.push(d(` ${g.sep} `), b(`${cell.glyph} ${cell.word.toUpperCase()}`, cell.tone));
    }
    const readers = (status?.tasks ?? []).filter(task => task.inputs.includes(path)).map(task => task.name);
    if (readers.length > 0) out.push(d(` ${g.sep} read by ${readers.join(', ')}`));
    return out;
}

/** The per-row decorations: the editor, `edited`, `t tag ▾`, `t set` / `t clear`. */
function decorate(state: TuiState, ws: string, path: string, g: RenderCtx['g']) {
    const v = state.view;
    const editing = v.kind === 'input' ? v.editing : null;
    const edit = state.edit !== null && state.edit.ws === ws && state.edit.path === path ? state.edit : null;
    return (row: RowModel, selected: boolean): { value?: string; hint?: string; tone?: 'brand' | 'warn' | 'neg' | 'muted' } | null => {
        if (editing !== null && editing.rowId === row.id) {
            return { value: editorText(editing, g.cursor), hint: editing.error ?? `${g.enter} apply ${g.sep} esc cancel`, tone: editing.error !== null ? 'neg' : 'brand' };
        }
        if (edit !== null && edit.changed.includes(row.id)) return { hint: 'edited', tone: 'warn' };
        if (row.variantCtl !== undefined) return { hint: `t tag ${g.expanded}`, tone: selected ? 'brand' : 'muted' };
        if (row.optionCtl !== undefined) return { hint: row.optionCtl.isSome ? 't clear' : 't set', tone: selected ? 'brand' : 'muted' };
        return null;
    };
}

registerListModel('input', (state, layout) => {
    const tctx = treeContext(state);
    if (tctx === null) return { count: 0, visible: 0 };
    const model = treeModel(tctx.data, tctx.tree, tctx.editable);
    return { count: model?.total ?? 0, visible: Math.max(1, layout.bodyRows - TREE_CHROME_ROWS) };
});

registerView('input', (state, ctx) => {
    if (state.view.kind !== 'input') return { body: [], hints: { left: '', right: '' } };
    const { ws, name } = state.view;
    const path = `.inputs.${name}`;
    const g = ctx.g;
    const width = ctx.layout.columns;
    const data = state.data.dataset[ws]?.[path];
    const banner = conflictLine(state, ws, path, ctx);
    const body: Line[] = [
        lrLine([t(' '), b(name), t('   '), b(`${g.tabL}Value${g.tabR}`, 'brand')], [...inputTitle(state, ws, path, ctx), t(' ')], width),
        ...(banner !== null ? [banner] : []),
        datasetLine(data, path, false, ctx),
        rule(width, g.dashed),
    ];
    const hits: Hit[] = tabStripHits(name, ['Value'], g).map(h => ({ row: 0, x0: h.x0, x1: h.x1, target: { kind: 'tab', index: h.index } }));
    const tctx = treeContext(state);
    const rows = tctx?.visible ?? Math.max(1, ctx.layout.bodyRows - TREE_CHROME_ROWS);
    const dirty = dirtyCount(state);
    const editing = state.view.editing;
    const screen = (glyph: string, tone: 'muted' | 'warn' | 'neg', title: string, lines: string[]): Line[] => {
        const block = centredBlock(glyph, tone, title, lines, width);
        while (block.length < rows + 1) block.push(blank(width));
        return block.slice(0, rows + 1);
    };
    const hintsLeft = editing !== null
        ? `${g.enter} apply ${g.sep} esc cancel ${g.sep} ${g.left}${g.right} move`
        : `e edit   a add   x remove   t tag/set   ${g.up}${g.down} move   ${g.right} ${g.left}   ${g.enter} apply all   esc discard`;
    const hintsRight = editing !== null ? 'editing' : dirty > 0 ? 'dirty' : '';
    if (data === undefined || data.mode.kind === 'loading') {
        body.push(...screen(g.loading, 'muted', 'LOADING', ['reading the input']));
        return { body, hits, hints: { left: hintsLeft, right: hintsRight } };
    }
    if (data.mode.kind === 'unset' || data.mode.kind === 'null') {
        body.push(...screen(g.empty, 'muted', data.mode.kind === 'null' ? 'NULL' : 'NOT SET', [`${name} has no value yet`, `e3 dataset set <repo> ${ws}.${name} -f <file>`]));
        return { body, hits, hints: { left: `esc back`, right: '' } };
    }
    if (data.mode.kind === 'too-large' || data.mode.kind === 'not-indexed' || data.mode.kind === 'error') {
        const title = data.mode.kind === 'error' ? 'COULD NOT LOAD' : data.mode.kind === 'too-large' ? 'TOO LARGE TO EDIT HERE' : 'NOT INDEXED';
        body.push(...screen(data.mode.kind === 'error' ? g.cross : g.half, data.mode.kind === 'error' ? 'neg' : 'warn', title, [data.mode.kind === 'error' ? data.mode.message : `${name} ${g.sep} edit it with e3 dataset set`, 's  save to a .beast2 file']));
        return { body, hits, hints: { left: 's save   esc back', right: '' } };
    }
    if (tctx === null) return { body, hits, hints: { left: hintsLeft, right: hintsRight } };
    const model = treeModel(tctx.data, tctx.tree, tctx.editable);
    if (model === null) return { body, hits, hints: { left: hintsLeft, right: hintsRight } };
    const loading = data.mode.kind === 'paged' ? data.mode.loading : [];
    const changed = state.edit !== null && state.edit.ws === ws && state.edit.path === path ? new Set(state.edit.changed) : undefined;
    const treeTop = Math.max(0, Math.min(tctx.tree.top, Math.max(0, model.total - rows)));
    body.push(...renderTreeRows(model, tctx.tree, loading, rows, width, g, changed, decorate(state, ws, path, g)));
    const paged = data.mode.kind === 'paged';
    body.push(treeFooter(model, tctx.tree, loading, rows, width, g, paged ? `read-only ${g.sep} e3 dataset set` : 's save .beast2'));
    const treeRow0 = 3 + (banner !== null ? 1 : 0);
    for (let i = treeTop; i < Math.min(model.total, treeTop + rows); i++) {
        const at = model.at(i);
        hits.push({ row: treeRow0 + (i - treeTop), x0: 0, x1: width - 1, target: { kind: 'tree', flat: i, twistX: at?.kind === 'model' ? 1 + 2 * at.row.depth : null } });
    }
    const pane: Pane = { top: treeRow0, rows, total: model.total, visible: rows, scrollTop: treeTop };
    return {
        body,
        hits,
        pane,
        hints: { left: paged ? `paged inputs are read-only here ${g.sep} e3 dataset set   ${g.up}${g.down} move   /find   /goto   s save` : hintsLeft, right: hintsRight },
    };
});

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/** The selected row of the input tree, when the value is inline. */
function selectedRow(state: TuiState): { ctx: TreeContext; row: RowModel } | null {
    const ctx = treeContext(state);
    if (ctx === null || ctx.data === undefined) return null;
    const model = treeModel(ctx.data, ctx.tree, ctx.editable);
    const at = model?.at(ctx.tree.sel);
    if (model === null || at === null || at === undefined || at.kind !== 'model') return null;
    return { ctx, row: at.row };
}

/** Whether the value can be edited here (inline, with a hash). */
function editableHere(state: TuiState, controller: Controller): boolean {
    const ctx = treeContext(state);
    if (ctx === null || ctx.data === undefined) return false;
    const source = state.data.dataset[ctx.ws]?.[ctx.path];
    if (source === undefined || source.hash === null) { controller.toast('nothing to edit yet', 'warn'); return false; }
    if (source.mode.kind === 'paged') { controller.toast('a paged input is read-only here — e3 dataset set writes it', 'warn'); return false; }
    if (source.mode.kind !== 'inline') { controller.toast('the value is not loaded', 'warn'); return false; }
    if (state.edit !== null && (state.edit.ws !== ctx.ws || state.edit.path !== ctx.path)) {
        controller.toast(`apply or discard the ${dirtyCount(state)} pending edit${dirtyCount(state) === 1 ? '' : 's'} on ${state.edit.path} first`, 'warn');
        return false;
    }
    return true;
}

/** Records an op in the buffer (starting it on first use). */
function record(state: TuiState, controller: Controller, op: EditOp): boolean {
    const ctx = treeContext(state);
    const source = ctx === null ? undefined : state.data.dataset[ctx.ws]?.[ctx.path];
    if (ctx === null || source === undefined || source.mode.kind !== 'inline' || source.hash === null || source.type === null) return false;
    const edit = state.edit !== null && state.edit.ws === ctx.ws && state.edit.path === ctx.path ? state.edit : startEdit(ctx.ws, ctx.path, source.type, source.mode.value, source.hash);
    try {
        controller.dispatch({ type: 'edit/set', edit: pushOp(edit, op) });
        return true;
    } catch (err) {
        controller.toast(`${describeOp(op)} failed: ${describeError(err)}`, 'neg');
        return false;
    }
}

/** `e`: opens the editor on the selected leaf. */
function beginEdit(state: TuiState, controller: Controller): boolean {
    if (!editableHere(state, controller)) return true;
    const sel = selectedRow(state);
    if (sel === null || sel.row.leaf === undefined) { controller.toast('select a value to edit it — → expands a branch', 'warn'); return true; }
    const kind = leafKindOf(sel.row.leaf);
    if (kind === null) { controller.toast('a null value cannot be edited', 'warn'); return true; }
    const text = initialText(sel.row.leaf);
    controller.dispatch({ type: 'input/editing', editing: { rowId: sel.row.id, path: sel.row.path, leaf: kind, text, cursor: text.length, error: null } });
    return true;
}

/** `a`: adds an item (arrays) or asks for a key (dicts). */
function addItem(state: TuiState, controller: Controller, key: string | undefined): boolean {
    if (!editableHere(state, controller)) return true;
    const sel = selectedRow(state);
    if (sel === null) return true;
    const row = sel.row;
    const container = row.kind === 'appendArray' || row.kind === 'appendDict' ? row.path : row.kind === 'array' || row.kind === 'dict' ? row.path : null;
    const kind = row.kind === 'appendArray' || row.kind === 'array' ? 'array' : row.kind === 'appendDict' || row.kind === 'dict' ? 'dict' : null;
    if (container === null || kind === null) { controller.toast('select a list, a dictionary or an Add row', 'warn'); return true; }
    if (kind === 'array') {
        record(state, controller, { kind: 'insert', path: [...container, variant('append', null) as never] });
        return true;
    }
    if (key === undefined) {
        controller.dispatch({ type: 'command/edit', text: '/add ' });
        controller.updateCompletion();
        return true;
    }
    record(state, controller, { kind: 'insert', path: [...container, variant('key', key) as never] });
    return true;
}

/** `x`: removes the selected element or entry (branches ask first). */
function removeItem(state: TuiState, controller: Controller, force: boolean): boolean {
    if (!editableHere(state, controller)) return true;
    const sel = selectedRow(state);
    if (sel === null) return true;
    if (!sel.row.removable) { controller.toast('only list items and dictionary entries can be removed', 'warn'); return true; }
    if (sel.row.expandable && !force) {
        controller.dispatch({ type: 'command/confirm', confirm: { question: `remove ${sel.row.label} and everything under it?`, command: '/remove --force' } });
        return true;
    }
    record(state, controller, { kind: 'remove', path: sel.row.ownPath });
    return true;
}

/** `/tag <name>`: switches a variant tag or sets / clears an option. */
function tagRow(state: TuiState, controller: Controller, tag: string): boolean {
    if (!editableHere(state, controller)) return true;
    const sel = selectedRow(state);
    if (sel === null) return true;
    const { row } = sel;
    if (row.optionCtl !== undefined && (tag === 'some' || tag === 'none' || tag === 'set' || tag === 'clear')) {
        record(state, controller, { kind: 'tag', path: row.optionCtl.path, tag: tag === 'set' ? 'some' : tag === 'clear' ? 'none' : tag });
        return true;
    }
    if (row.variantCtl !== undefined) {
        if (!row.variantCtl.tags.includes(tag)) { controller.toast(`${row.label} takes ${row.variantCtl.tags.join(', ')}`, 'warn'); return true; }
        record(state, controller, { kind: 'tag', path: row.variantCtl.path, tag });
        return true;
    }
    controller.toast('select a variant or an optional value', 'warn');
    return true;
}

/** `⏎ APPLY`: encodes the draft and writes it. */
async function applyEdits(state: TuiState, controller: Controller): Promise<void> {
    const edit = state.edit;
    if (edit === null || edit.ops.length === 0) { controller.toast('nothing to apply', 'warn'); return; }
    if (edit.applying) return;
    const api = controller.deps.api();
    if (api === null) return;
    controller.dispatch({ type: 'edit/set', edit: { ...edit, applying: true } });
    try {
        await api.datasetSet(edit.ws, treePathOf(edit.path), encodeDatasetBlob(edit.type, edit.draft));
    } catch (err) {
        const current = controller.state().edit;
        if (current !== null) controller.dispatch({ type: 'edit/set', edit: { ...current, applying: false } });
        controller.toast(`apply failed: ${describeError(err)}`, 'neg');
        return;
    }
    controller.dispatch({ type: 'edit/set', edit: null });
    controller.toast(`applied ${formatInt(edit.ops.length)} change${edit.ops.length === 1 ? '' : 's'} to ${edit.path}`, 'pos');
    controller.deps.feeds.fire(`dataset:${edit.ws}:${edit.path}`);
    controller.deps.feeds.fire(`status:${edit.ws}`);
}

/** `esc DISCARD` / `/discard`: drops the buffer. */
function discardEdits(state: TuiState, controller: Controller): void {
    const n = dirtyCount(state);
    controller.dispatch({ type: 'edit/set', edit: null });
    controller.dispatch({ type: 'input/editing', editing: null });
    if (n > 0) controller.toast(`discarded ${formatInt(n)} change${n === 1 ? '' : 's'}`, 'warn');
}

/** `/reload` (the conflict banner's ⏎): reloads the value and re-applies the ops. */
async function reloadAndReplay(state: TuiState, controller: Controller): Promise<void> {
    const edit = state.edit;
    if (edit === null) return;
    await controller.deps.feeds.datasets.reload(edit.ws, edit.path);
    const fresh = controller.state();
    const source = fresh.data.dataset[edit.ws]?.[edit.path];
    if (source === undefined || source.mode.kind !== 'inline' || source.hash === null) {
        controller.toast('could not reload the value', 'neg');
        return;
    }
    const { edit: rebased, dropped } = replay(edit, source.mode.value, source.hash);
    controller.dispatch({ type: 'edit/set', edit: rebased.ops.length > 0 ? rebased : null });
    if (dropped.length > 0) controller.toast(`re-applied ${rebased.ops.length}, dropped ${dropped.length}: ${dropped.map(describeOp).join(', ')}`, 'warn');
    else controller.toast(`reloaded ${hashTiny(source.hash)} and re-applied ${rebased.ops.length} change${rebased.ops.length === 1 ? '' : 's'}`, 'pos');
}

/** Keys while the leaf editor is open. */
function editorKey(action: KeyAction, state: TuiState, controller: Controller): boolean {
    if (state.view.kind !== 'input' || state.view.editing === null) return false;
    const editing = state.view.editing;
    switch (action.kind) {
        case 'leaf.char': controller.dispatch({ type: 'input/editing', editing: editKey(editing, { kind: 'char', text: action.text }) }); return true;
        case 'leaf.backspace': controller.dispatch({ type: 'input/editing', editing: editKey(editing, { kind: 'backspace' }) }); return true;
        case 'leaf.delete': controller.dispatch({ type: 'input/editing', editing: editKey(editing, { kind: 'delete' }) }); return true;
        case 'leaf.left': controller.dispatch({ type: 'input/editing', editing: editKey(editing, { kind: 'left' }) }); return true;
        case 'leaf.right': controller.dispatch({ type: 'input/editing', editing: editKey(editing, { kind: 'right' }) }); return true;
        case 'leaf.home': controller.dispatch({ type: 'input/editing', editing: editKey(editing, { kind: 'home' }) }); return true;
        case 'leaf.end': controller.dispatch({ type: 'input/editing', editing: editKey(editing, { kind: 'end' }) }); return true;
        case 'leaf.toggle': controller.dispatch({ type: 'input/editing', editing: editKey(editing, { kind: 'toggle' }) }); return true;
        case 'leaf.cancel': controller.dispatch({ type: 'input/editing', editing: null }); return true;
        case 'leaf.submit': {
            const parsed = parseLeaf(editing.leaf, editing.text);
            if (!parsed.ok) { controller.dispatch({ type: 'input/editing', editing: { ...editing, error: parsed.error } }); return true; }
            controller.dispatch({ type: 'input/editing', editing: null });
            record(controller.state(), controller, { kind: 'edit', path: editing.path, leaf: parsed.leaf as never });
            return true;
        }
        default:
            return true;
    }
}

registerViewHooks('input', {
    tags: (state) => {
        const sel = selectedRow(state);
        if (sel === null) return undefined;
        if (sel.row.variantCtl !== undefined) return sel.row.variantCtl.tags;
        if (sel.row.optionCtl !== undefined) return ['some', 'none'];
        return undefined;
    },
    tree: (action, state, controller) => treeKey(action, state, controller),
    key: (action, state, controller) => {
        if (state.view.kind !== 'input') return false;
        if (state.view.editing !== null) return editorKey(action, state, controller);
        switch (action.kind) {
            case 'edit': return beginEdit(state, controller);
            case 'add': return addItem(state, controller, undefined);
            case 'remove': return removeItem(state, controller, false);
            case 'tag': {
                const sel = selectedRow(state);
                if (sel === null || (sel.row.variantCtl === undefined && sel.row.optionCtl === undefined)) { controller.toast('select a variant or an optional value', 'warn'); return true; }
                controller.dispatch({ type: 'command/edit', text: '/tag ' });
                controller.updateCompletion();
                return true;
            }
            case 'apply': {
                if (state.edit !== null && state.edit.conflict !== null) { void reloadAndReplay(state, controller); return true; }
                if (dirtyCount(state) > 0) { void applyEdits(state, controller); return true; }
                const sel = selectedRow(state);
                if (sel === null) return true;
                if (sel.row.expandable) return treeKey({ kind: 'toggle' }, state, controller);
                if (sel.row.leaf !== undefined) return beginEdit(state, controller);
                return true;
            }
            case 'back': {
                const edit = state.edit;
                if (edit !== null && edit.ws === state.view.ws && edit.path === `.inputs.${state.view.name}`) {
                    if (edit.conflict !== null) { controller.dispatch({ type: 'edit/set', edit: { ...edit, conflict: null } }); return true; }
                    if (edit.ops.length > 0) {
                        controller.dispatch({ type: 'command/confirm', confirm: { question: `discard ${edit.ops.length} unsaved edit${edit.ops.length === 1 ? '' : 's'}?`, command: '/discard' } });
                        return true;
                    }
                }
                return treeKey(action, state, controller);
            }
            case 'save': case 'next': case 'prev':
                return treeKey(action, state, controller);
            default:
                return false;
        }
    },
    command: async (command: ParsedCommand, state, controller) => {
        if (state.view.kind !== 'input') return false;
        switch (command.name) {
            case 'tag': return tagRow(state, controller, command.tag);
            case 'add': return addItem(state, controller, command.key);
            case 'remove': return removeItem(state, controller, command.force);
            case 'apply': await applyEdits(state, controller); return true;
            case 'discard': discardEdits(state, controller); return command.then === undefined ? true : false;
            case 'reload': await reloadAndReplay(state, controller); return true;
            default: return treeCommand(command, state, controller);
        }
    },
    click: (target, event, state, controller) => {
        if (target.kind === 'tree') { clickTree(state, controller, target.flat, target.twistX !== null && event.x === target.twistX); return true; }
        if (target.kind === 'toolbar') {
            if (target.action === 'save') void controller.execute('/save');
            else treeToolbar(state, controller, target.action);
            return true;
        }
        return false;
    },
    scroll: (to, state, controller) => { scrollTree(state, controller, to); return true; },
});
