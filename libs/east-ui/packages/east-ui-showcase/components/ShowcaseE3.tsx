/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The e3 the showcase runs in its page (#849), in React: the gate every e3
 * example renders through, and e3-ui-components' providers over the workspace
 * of the area whose example showed last (#1397).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Alert, Button, HStack, Spinner, Text } from "@chakra-ui/react";
import { deriveManifest } from "@elaraai/e3-ui";
import type { TreePath } from "@elaraai/e3-types";
import {
    E3Provider, ReactiveDatasetProvider, useReactiveDatasetCache,
    type E3Config, type ReactiveDatasetCacheInterface,
} from "@elaraai/e3-ui-components";
import type { LiveEntry } from "../catalog";
import {
    SHOWCASE_POLL_MS, SHOWCASE_REPO, e3AreaOf, exampleReadsLoaded, loadExampleReads, retryShowcaseE3,
    setShowcaseE3Cache, showcaseE3Status, showcaseE3Workspace, shownShowcaseE3, startShowcaseE3,
    subscribeShowcaseE3, type ShowcaseE3Status,
} from "../showcase-e3";
import { exampleIr } from "./example-ir";

/** An area that has not been named: no e3 example has shown yet. */
const NO_AREA: ShowcaseE3Status = { state: "idle" };

/** Where an area's workspace is, re-rendering as it moves. */
function useShowcaseE3(area: string | undefined): ShowcaseE3Status {
    const status = useCallback(() => (area === undefined ? NO_AREA : showcaseE3Status(area)), [area]);
    return useSyncExternalStore(subscribeShowcaseE3, status);
}

/** The area whose example showed last, re-rendering as another's shows. */
function useShownArea(): string | undefined {
    return useSyncExternalStore(subscribeShowcaseE3, shownShowcaseE3);
}

/** An area's workspace as e3-ui-components' `E3Provider` takes it, once it is
 *  ready: the e3's URL, its `fetch`, the repository and the area's workspace
 *  — the same object until the e3 or the area changes. */
function useShowcaseE3Config(area: string | undefined, status: ShowcaseE3Status): E3Config | null {
    const e3 = status.state === "ready" ? status.e3 : null;
    return useMemo((): E3Config | null => e3 === null || area === undefined ? null : {
        apiUrl: e3.apiUrl,
        fetch: e3.fetch,
        repo: SHOWCASE_REPO,
        workspace: showcaseE3Workspace(area),
        token: null,
    }, [e3, area]);
}

/** Hands the provider's dataset cache to the area's status for as long as it
 *  is mounted: the provider renders it once it has installed its runtimes. */
function RuntimesInstalled({ area }: { area: string }) {
    const cache = useReactiveDatasetCache();
    useLayoutEffect(() => {
        setShowcaseE3Cache(area, cache);
        return () => setShowcaseE3Cache(area, null);
    }, [area, cache]);
    return null;
}

/**
 * e3-ui-components' providers over the workspace of the area whose example
 * showed last, mounted once it has started: `E3Provider` with the e3's URL,
 * its `fetch`, the repository and the area's workspace, and inside it
 * `ReactiveDatasetProvider`, which installs the runtimes `Data.bind`,
 * `Data.bindPaged`, `Func.bind` and `Record.bind` resolve through.
 *
 * @remarks
 * Those runtimes are process-global, so this one mount serves every e3
 * example on the page, wherever the doc list renders it — a page shows one
 * area's — and follows the area as another's example shows: `main.tsx` mounts
 * it beside the app rather than around it, which would mount the app again
 * when e3 has started. Until the shown area has started, it renders nothing.
 */
export function ShowcaseE3Runtime() {
    const area = useShownArea();
    const config = useShowcaseE3Config(area, useShowcaseE3(area));
    if (config === null || area === undefined) return null;
    return (
        <E3Provider config={config}>
            <ReactiveDatasetProvider>
                <RuntimesInstalled area={area} />
            </ReactiveDatasetProvider>
        </E3Provider>
    );
}

const readsByExample = new WeakMap<LiveEntry, readonly TreePath[]>();

/** What an e3 example reads whole — its manifest's `paths`, derived from its
 *  IR as a UI task's is — the same array on every call. */
function readsOf(entry: LiveEntry): readonly TreePath[] {
    let reads = readsByExample.get(entry);
    if (reads === undefined) {
        reads = deriveManifest({ toIR: () => exampleIr(entry) }).paths;
        readsByExample.set(entry, reads);
    }
    return reads;
}

/** Whether what an example reads has loaded. */
type Reads = { readonly state: "loading" } | { readonly state: "loaded" } | { readonly state: "failed"; readonly error: Error };

const LOADING: Reads = { state: "loading" };
const LOADED: Reads = { state: "loaded" };

/**
 * Loads what an example reads through the installed cache, then polls it for
 * as long as the example shows, as a UI task's preview does with its
 * manifest's reads: a dataset the example writes, a record it mutates, or a
 * task output a run it starts recomputes reaches every example reading it.
 *
 * @remarks
 * What has loaded into the cache before — another example's reads, or this
 * one's before the doc list remounted its row — renders in the first paint:
 * a remounted row keeps the size it had, which the doc list's virtualizer
 * needs as `example-ir.ts` says. What loads between the render and its effect
 * — another example's load landing first — is taken as loaded by the effect,
 * which renders again to show it.
 */
function useExampleReads(cache: ReactiveDatasetCacheInterface | null, workspace: string, paths: readonly TreePath[]): Reads {
    const known = cache !== null && exampleReadsLoaded(cache, paths);
    const [settled, setSettled] = useState<{ readonly cache: ReactiveDatasetCacheInterface; readonly reads: Reads } | null>(null);
    useEffect(() => {
        if (cache === null) return;
        let live = true;
        let polled = false;
        const poll = (): void => {
            for (const path of paths) cache.setRefetchInterval(workspace, path, SHOWCASE_POLL_MS);
            polled = true;
        };
        if (exampleReadsLoaded(cache, paths)) {
            poll();
            setSettled({ cache, reads: LOADED });
        } else {
            loadExampleReads(cache, workspace, paths).then(
                () => {
                    if (!live) return;
                    poll();
                    setSettled({ cache, reads: LOADED });
                },
                (err: unknown) => {
                    if (live) setSettled({ cache, reads: { state: "failed", error: err instanceof Error ? err : new Error(String(err)) } });
                },
            );
        }
        return () => {
            live = false;
            if (polled) for (const path of paths) cache.clearRefetchInterval(workspace, path);
        };
    }, [cache, workspace, paths]);
    if (known) return LOADED;
    // What settled through another cache says nothing of this one.
    return settled !== null && cache !== null && Object.is(settled.cache, cache) ? settled.reads : LOADING;
}

/** What stands in an e3 example's place when it cannot render
 *  (`data-e3-start="failed"`) — with a Retry when it is given one. */
function Failed({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
    return (
        <Alert.Root status="error" variant="subtle" alignItems="flex-start" data-e3-start="failed">
            <Alert.Indicator />
            <Alert.Content minW={0} gap="2">
                <Alert.Title>{title}</Alert.Title>
                <Alert.Description wordBreak="break-word">{message}</Alert.Description>
                {onRetry !== undefined && (
                    <Button size="xs" variant="outline" alignSelf="flex-start" onClick={onRetry}>Retry</Button>
                )}
            </Alert.Content>
        </Alert.Root>
    );
}

/**
 * Where an e3 example renders. Each one to mount says its area shows, which
 * starts the area's workspace the first time (#1397); each says so while the
 * area starts and while what it reads loads (`data-e3-start="starting"`), and
 * renders its example once the area's package is deployed, its dataflow run
 * once, the runtimes installed over its workspace, and what the example reads
 * loaded. A start, or a read, that failed shows its error in the example's
 * place (`data-e3-start="failed"`), naming the step and the cause — a start
 * with a Retry, which starts the area again for every one of its examples;
 * nothing outside the area's examples is touched.
 *
 * @remarks
 * The example renders under an `E3Provider` over its area's workspace
 * (#1132): what it reaches of e3 itself, besides its bindings — the query
 * builder's one-shot and split calls, and its data sources' statuses — goes to
 * the e3 the page runs, as a deployed surface's goes to its server. Its query
 * cache is its own.
 *
 * @param props - The example's entry, and the example
 * @returns The example, or what stands in its place
 */
export function E3Gate({ entry, children }: { entry: LiveEntry; children: ReactNode }) {
    const area = e3AreaOf(entry.pathKey);
    const status = useShowcaseE3(area);
    const config = useShowcaseE3Config(area, status);
    useEffect(() => startShowcaseE3(area), [area]);
    const retry = useCallback(() => retryShowcaseE3(area), [area]);
    const reads = useExampleReads(status.state === "ready" ? status.cache : null, showcaseE3Workspace(area), readsOf(entry));
    if (status.state === "failed") {
        return <Failed title="e3 did not start in this page" message={status.error.message} onRetry={retry} />;
    }
    if (reads.state === "failed") return <Failed title="What this example reads did not load" message={reads.error.message} />;
    if (reads.state === "loading") {
        return (
            <HStack gap="2" color="fg.muted" data-e3-start="starting" aria-busy="true">
                <Spinner size="xs" />
                <Text textStyle="body.sm">Starting e3 in this page…</Text>
            </HStack>
        );
    }
    // What an example reads loads only once its area is ready, so its config is here.
    return config === null ? <>{children}</> : <E3Provider config={config}>{children}</E3Provider>;
}
