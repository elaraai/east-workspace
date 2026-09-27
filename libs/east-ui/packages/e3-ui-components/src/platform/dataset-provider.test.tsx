/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<ReactiveDatasetProvider>` installs the process-global runtimes the
 * East-side bindings resolve through. A provider that replaces another — the
 * extension re-keys it on every workspace switch — and StrictMode's
 * mount → unmount → mount must both leave the runtimes bound to the provider
 * that is mounted, and a provider's children must find its cache on their
 * first render.
 */

import { StrictMode } from "react";
import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { E3Provider } from "./e3-config.js";
import { ReactiveDatasetProvider, useReactiveDatasetCache } from "./dataset-hooks.js";
import { defaultBindRuntime, getReactiveDatasetCache } from "./bind-runtime.js";
import { defaultPagedRuntime } from "./paged-runtime.js";
import { defaultFuncRuntime } from "./func-runtime.js";
import { defaultRecordRuntime } from "./record-runtime.js";
import type { ReactiveDatasetCacheInterface } from "./dataset-store.js";

afterEach(cleanup);

/** The workspace each process-global runtime is bound to. */
function boundWorkspaces(): (string | null | undefined)[] {
    const peek = (runtime: unknown) => (runtime as { workspace: string | null }).workspace;
    return [
        defaultBindRuntime.getCache()?.getConfig().workspace,
        peek(defaultPagedRuntime),
        peek(defaultFuncRuntime),
        peek(defaultRecordRuntime),
    ];
}

/** Records the cache each render of a child sees, from context and from the
 *  runtime a `Data.bind` reads through. */
function Probe({ seen }: { seen: { context: ReactiveDatasetCacheInterface; runtime: ReactiveDatasetCacheInterface }[] }) {
    seen.push({ context: useReactiveDatasetCache(), runtime: getReactiveDatasetCache() });
    return null;
}

const tree = (workspace: string, seen: Parameters<typeof Probe>[0]["seen"] = []) => (
    <E3Provider key={workspace} config={{ apiUrl: "http://127.0.0.1:9", workspace }}>
        <ReactiveDatasetProvider><Probe seen={seen} /></ReactiveDatasetProvider>
    </E3Provider>
);

describe("ReactiveDatasetProvider", () => {
    test("children render once the cache is installed, and see the one the runtimes use", () => {
        const seen: Parameters<typeof Probe>[0]["seen"] = [];
        render(tree("a", seen));
        expect(seen.length).toBeGreaterThan(0);
        for (const { context, runtime } of seen) expect(context).toBe(runtime);
        expect(boundWorkspaces()).toEqual(["a", "a", "a", "a"]);
    });

    test("a provider re-keyed to another workspace leaves the runtimes bound to the new one", () => {
        const { rerender } = render(tree("a"));
        rerender(tree("b"));
        expect(boundWorkspaces()).toEqual(["b", "b", "b", "b"]);
    });

    test("StrictMode's mount, unmount and mount again leaves a live cache installed", () => {
        const seen: Parameters<typeof Probe>[0]["seen"] = [];
        render(<StrictMode>{tree("a", seen)}</StrictMode>);
        expect(boundWorkspaces()).toEqual(["a", "a", "a", "a"]);
        const last = seen[seen.length - 1]!;
        expect(last.runtime).toBe(defaultBindRuntime.getCache());
    });

    test("unmounting clears what the provider installed", () => {
        const { unmount } = render(tree("a"));
        unmount();
        expect(boundWorkspaces()).toEqual([undefined, null, null, null]);
    });
});
