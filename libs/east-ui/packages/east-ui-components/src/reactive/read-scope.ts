/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Work in progress belongs to one reader, never to the evictable page cache. */
const scopes: ReadScope[] = [];

/** Retains only resources used by the latest evaluation of this reader. @internal */
export class ReadScope {
    private readonly resources = new Map<string, unknown>();
    private used = new Set<string>();

    /** Evaluate in this scope and release resources the new query no longer uses. */
    run<T>(read: () => T): T {
        scopes.push(this);
        this.used = new Set();
        try { return read(); }
        finally {
            scopes.pop();
            for (const key of this.resources.keys()) if (!this.used.has(key)) this.resources.delete(key);
        }
    }

    /** Drop partial and completed results when the reader releases its subscriptions. */
    clear(): void { this.resources.clear(); this.used.clear(); }

    /** Reuse this operation's progress while it remains part of the current read. */
    get<T>(key: string, create: () => T): T {
        this.used.add(key);
        if (!this.resources.has(key)) this.resources.set(key, create());
        return this.resources.get(key) as T;
    }
}

/** Share progress across evaluations, without retaining unmounted or obsolete reads. @internal */
export function readResource<T>(key: string, create: () => T): T {
    const current = scopes.at(-1);
    return current === undefined ? create() : current.get(key, create);
}
