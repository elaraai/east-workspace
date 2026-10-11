/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Exact post-Save feedback, shared by every indexed record editor. */
import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { Button } from "@chakra-ui/react";
import { decodeBeast2For, encodeBeast2For, equalFor, none, some, type option, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceWhereType, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import type { EditSessionBinding } from "../../editing/session.js";
import { getStore } from "../../platform/state-runtime.js";
import type { UIStoreInterface } from "../../platform/state-store.js";
import { useTrackedEvaluation } from "../../reactive/index.js";
import { createTrackedRead } from "../../reactive/tracked.js";

type Slice = ValueTypeOf<RecordSliceBindType>;
type Where = ValueTypeOf<RecordSliceWhereType>;
type Prepare = NonNullable<EditSessionBinding<unknown>["prepare"]>;
const same = equalFor(RecordSliceWhereType);
const encode = encodeBeast2For(RecordSliceWhereType);
const decode = decodeBeast2For(RecordSliceWhereType);

/** Wait on exactly the dependencies a bounded read discovered, never poll. */
function settled<T>(read: () => option<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        let done = false;
        let queued = false;
        const enqueue = () => {
            if (done || queued) return;
            queued = true;
            queueMicrotask(run);
        };
        const tracked = createTrackedRead(enqueue);
        const run = () => {
            queued = false;
            if (done) return;
            const result = tracked.run(read);
            if (!result.ok || result.value.type === "some") {
                done = true;
                tracked.release();
                if (!result.ok) reject(result.error);
                else if (result.value.type === "some") resolve(result.value.value);
            }
        };
        enqueue();
    });
}

/** Ephemeral feedback follows the UI store's lifetime, like the session. */
class SaveNotice {
    private version = 0;
    private listeners = new Set<() => void>();
    private generation = 0;
    where: Where | undefined;
    count = 0;
    pending = false;
    error: string | undefined;
    retry: (() => void) | undefined;
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    snapshot = () => this.version;
    private changed() { this.version++; for (const listener of this.listeners) listener(); }

    scope(where: Where): void {
        if (this.where !== undefined && same(where, this.where)) return;
        this.generation++;
        this.where = decode(encode(where));
        this.count = 0; this.pending = false; this.error = undefined; this.retry = undefined;
        this.changed();
    }

    confirm(slice: Slice, where: Where, ids: readonly string[]): void {
        if (!same(slice.read().where, where)) return;
        this.scope(where);
        const generation = ++this.generation;
        const run = () => {
            if (generation !== this.generation || !same(slice.read().where, where)) return;
            this.pending = true; this.error = undefined; this.changed();
            void settled(() => {
                if (generation !== this.generation || !same(slice.read().where, where)) return some(undefined);
                let count = 0;
                let pending = false;
                for (const id of ids) {
                    const included = slice.contains(where, id);
                    if (included.type === "none") pending = true;
                    else if (!included.value) count++;
                }
                return pending ? none : some(count);
            }).then(count => {
                if (generation !== this.generation || count === undefined || !same(slice.read().where, where)) return;
                this.count = count; this.pending = false; this.retry = undefined; this.changed();
            }, error => {
                if (generation !== this.generation || !same(slice.read().where, where)) return;
                this.pending = false; this.error = error instanceof Error ? error.message : "Could not update the view";
                this.retry = () => { slice.retry(); run(); };
                this.changed();
            });
        };
        run();
    }
}

const notices = new WeakMap<UIStoreInterface, Map<string, SaveNotice>>();
function notice(slice: Slice): SaveNotice {
    const store = getStore();
    let held = notices.get(store);
    if (held === undefined) { held = new Map(); notices.set(store, held); }
    const key = `${slice.key}:${slice.sourceId}`;
    let model = held.get(key);
    if (model === undefined) {
        model = new SaveNotice(); held.set(key, model);
        if (held.size > 64) held.delete(held.keys().next().value!);
    }
    return model;
}

/**
 * Capture exact membership before the mutation, then compare only those
 * primary identities after confirmation. Hidden edits already outside this
 * query do not count as leaving; a newly inserted row outside it does.
 * Changing the query cancels the notice, while Save still includes all drafts.
 */
export function prepareRecordSliceSave(slice: Slice | undefined): Prepare | undefined {
    if (slice === undefined) return undefined;
    const model = notice(slice);
    return async targets => {
        const where = decode(encode(slice.read().where));
        if (where.size === 0) return () => {};
        const candidates = await settled(() => {
            if (!same(slice.read().where, where)) return some<string[]>([]);
            const ids: string[] = [];
            let pending = false;
            for (const [id, target] of targets) {
                // Deletions already have their own action; this line explains
                // saved values disappearing because they no longer match.
                if (target.after.type === "none") continue;
                if (target.before.type === "none") { ids.push(id); continue; }
                const included = slice.contains(where, id);
                if (included.type === "none") pending = true;
                else if (included.value) ids.push(id);
            }
            return pending ? none : some(ids);
        });
        return () => model.confirm(slice, where, candidates);
    };
}

/** Footer feedback inherits the host's existing footer slot typography. */
export function RecordSliceSaveNotice({ slice, singular = "row", plural = "rows" }: {
    slice: Slice; singular?: string; plural?: string;
}) {
    const model = useMemo(() => notice(slice), [slice]);
    useSyncExternalStore(model.subscribe, model.snapshot, model.snapshot);
    const read = useCallback(() => slice.read().where, [slice]);
    const { result } = useTrackedEvaluation(read);
    useLayoutEffect(() => { if (result.ok) model.scope(result.value); }, [model, result]);
    if (!result.ok || model.where === undefined || !same(result.value, model.where)) return null;
    if (model.error !== undefined) return <span role="status" data-record-save-notice="error">
        Saved; view update failed. <Button size="xs" variant="plain" onClick={model.retry}>Retry</Button>
    </span>;
    if (model.pending) return <span role="status" data-record-save-notice="pending">Updating view…</span>;
    return model.count === 0 ? null : <span role="status" data-record-save-notice="">
        {model.count} {model.count === 1 ? singular : plural} left this view
    </span>;
}
