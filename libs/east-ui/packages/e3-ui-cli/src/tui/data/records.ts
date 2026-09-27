/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Records — what the RECORDS table and the record view know of a
 * workspace's records. `tick` follows the dataset list: for each record
 * whose state moved since it was read, or whose package was redeployed, its
 * signature (its mutations and indexes), its rows (the status geometry) and
 * its newest commit, so a poll that finds nothing moved asks for nothing.
 * `history` reads a record's commits a page at a time, newest first, for
 * the History tab: the newest page on every poll, joined to the older pages
 * already read, and the page after those when the view asks for more.
 *
 * @packageDocumentation
 */

import type { DatasetStatusDetail, ListEntry, RecordCommitInfo, RecordHistoryResult, RecordSignature } from '@elaraai/e3-api-client';
import { describeError, treePathOf, type Api } from '../api.js';
import type { RecordData } from '../state/actions.js';
import type { Store } from '../state/store.js';

/** Commits a history page holds. */
export const HISTORY_PAGE = 100;

/** What the loader needs. */
export interface RecordsLoaderDeps {
    store: Store;
    api: () => Api | null;
    log?: ((line: string) => void) | undefined;
}

/** The records loader. */
export interface RecordsLoader {
    /** Reads what moved of a workspace's records: each one's signature, rows and newest commit. */
    tick(ws: string): Promise<void>;
    /** Reads a record's newest commits, or with `more` the page after those read. */
    history(ws: string, name: string, more?: boolean): Promise<void>;
}

/**
 * The records of a workspace's dataset list, with their state hashes.
 *
 * @param entries - The dataset list
 * @returns Each record's name and hash (null while it holds no state), in list order
 */
export function recordEntries(entries: readonly ListEntry[]): { name: string; hash: string | null }[] {
    const out: { name: string; hash: string | null }[] = [];
    for (const entry of entries) {
        if (entry.type !== 'dataset') continue;
        const path = entry.value.path.replace(/^\./, '');
        if (!path.startsWith('records.')) continue;
        out.push({ name: path.slice('records.'.length), hash: entry.value.hash.type === 'some' ? entry.value.hash.value : null });
    }
    return out;
}

/**
 * Creates the loader.
 *
 * @param deps - The store and the API accessor
 * @returns The loader
 */
export function createRecordsLoader(deps: RecordsLoaderDeps): RecordsLoader {
    const { store } = deps;
    /** Per record (`ws\nname`): the package its signature was read under, when that was known. */
    const describedUnder = new Map<string, string | undefined>();
    const current = (ws: string, name: string): RecordData | undefined => store.getState().data.records[ws]?.[name];
    const put = (ws: string, name: string, data: RecordData): void => store.dispatch({ type: 'data/record', ws, name, data });

    return {
        async tick(ws) {
            const api = deps.api();
            if (api === null) return;
            const state = store.getState();
            // A redeploy can change a record's mutations without touching its
            // state, so a signature read under one package is read again under
            // another. One read before the deployed state was known is taken as
            // read under the package it turns out to be.
            const deployed = state.data.workspaceState[ws]?.packageHash;
            for (const { name, hash } of recordEntries(state.data.datasets[ws] ?? [])) {
                const known = current(ws, name);
                const key = `${ws}\n${name}`;
                const under = describedUnder.get(key);
                const redeployed = deployed !== undefined && under !== undefined && under !== deployed;
                if (known !== undefined && known.hash === hash && known.signature !== null && !redeployed) {
                    if (under === undefined) describedUnder.set(key, deployed);
                    continue;
                }
                let read: [RecordSignature, DatasetStatusDetail, RecordHistoryResult];
                try {
                    read = await Promise.all([
                        api.recordDescribe(ws, name),
                        api.datasetGetStatus(ws, treePathOf(`.records.${name}`)),
                        api.recordHistory(ws, name, { limit: 1 }),
                    ]);
                } catch (err) {
                    // A record that cannot be read now is read again on the next
                    // poll; it never fails the dataset list it follows.
                    deps.log?.(`record ${ws}.${name} not read: ${describeError(err)}`);
                    continue;
                }
                const [signature, status, newest] = read;
                describedUnder.set(key, deployed);
                // The commits the History tab read stay: its next poll joins the
                // newest page to them, or starts again where the chain was rewritten.
                const after = current(ws, name);
                put(ws, name, {
                    hash,
                    signature,
                    rows: status.rows.type === 'some' ? Number(status.rows.value) : null,
                    head: newest.commits[0] ?? null,
                    history: after?.history ?? null,
                    complete: after?.complete ?? false,
                });
            }
        },
        async history(ws, name, more = false) {
            const api = deps.api();
            if (api === null) return;
            // The History tab may read before the dataset list has named the
            // record: its commits come first, the tick fills in the rest.
            const known = current(ws, name) ?? { hash: null, signature: null, rows: null, head: null, history: null, complete: false };
            const held = known.history ?? [];
            if (more) {
                const last = held[held.length - 1];
                if (known.complete || last === undefined || last.parent.type === 'none') return;
                const page = await api.recordHistory(ws, name, { limit: HISTORY_PAGE, from: last.parent.value });
                const after = current(ws, name);
                // A newer page landed meanwhile: this one follows commits no longer held.
                if (after === undefined || after.history !== known.history) return;
                put(ws, name, { ...after, history: [...held, ...page.commits], complete: complete(page.commits) });
                return;
            }
            const page = await api.recordHistory(ws, name, { limit: HISTORY_PAGE });
            const after = current(ws, name) ?? known;
            const joined = joinPages(page.commits, after.history ?? []);
            put(ws, name, {
                ...after,
                head: page.commits[0] ?? after.head,
                history: joined,
                // Joined to older pages, the chain ends where they end.
                complete: joined.length === page.commits.length ? complete(page.commits) : after.complete,
            });
        },
    };
}

/** Whether a page ends the chain: it came back short, or its last commit is a root. */
function complete(page: readonly RecordCommitInfo[]): boolean {
    const last = page[page.length - 1];
    return page.length < HISTORY_PAGE || last === undefined || last.parent.type === 'none';
}

/**
 * The newest page joined to the commits read before: the older ones follow
 * where the page reaches the first of them, and are dropped when it does
 * not — more commits landed than a page holds, or the chain was compacted
 * or rolled back.
 *
 * @param page - The newest page, newest first
 * @param held - The commits read before, newest first
 * @returns The commits, newest first
 */
export function joinPages(page: readonly RecordCommitInfo[], held: readonly RecordCommitInfo[]): RecordCommitInfo[] {
    if (held.length === 0) return [...page];
    const at = page.findIndex(commit => commit.hash === held[0]!.hash);
    if (at === -1) return [...page];
    return [...page.slice(0, at), ...held];
}
