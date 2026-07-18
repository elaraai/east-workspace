// MUST stay first — registers the global error handlers before the eager
// `catalog` import below can throw, so a load-time crash surfaces as the
// copyable error alert rather than a blank page.
import "./install-error-overlay";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChakraProvider, CodeBlock } from "@chakra-ui/react";
import "@elaraai/east-ui-components/fonts";
import {
    DragLayerProvider, OverlayManagerProvider, system, UIStore, UIStoreProvider,
} from "@elaraai/east-ui-components";
// Side-effect import: registers the `Data.bind` platform impl + the Diff /
// Ontology / decision renderers against the global registries EastFunction
// renders through, so the e3 Components section runs live.
import "@elaraai/e3-ui-components";
import {
    ReactiveDatasetCache,
    initializeReactiveDatasetCache,
    initializeFunctionApi,
    createInMemoryFunctionApi,
    initializeRecordApi,
    createInMemoryRecordApi,
    datasetCacheKey,
    type DatasetApi,
    type InMemoryFunctionDef,
    type InMemoryRecordDef,
} from "@elaraai/e3-ui-components";
import { encodeBeast2For, FloatType, IntegerType } from "@elaraai/east";
import type { DatasetDef, FunctionDef, RecordDef, MutationDef } from "@elaraai/e3";
import type { TreePath } from "@elaraai/e3-types";
import { App } from "./App";
import { applyTheme, resolveInitialTheme } from "./theme-mode";
import { catalog, e3ExampleModules } from "./catalog";
import { codeBlockAdapter } from "./components/PatternEntry";
import { IsolatedFileView } from "./components/IsolatedFileView";
import { AppErrorBoundary } from "./components/ErrorOverlay";

/* Stamp the colour mode onto <html> before anything renders (#362) —
 * `?theme=dark` must also govern the `?file=` isolated snapshot views. */
applyTheme(resolveInitialTheme());

const store = new UIStore();

const WORKSPACE = "showcase";

/** Hand-written offline impls for `Func.bind` examples whose `e3.function` defs
 *  aren't exported from their module (so {@link seedFunctions} can't find them). */
const FALLBACK_FUNCTIONS: InMemoryFunctionDef[] = [
    { name: "forecast", inputTypes: [IntegerType, FloatType], outputType: FloatType, fn: (periods, growth) => Number(periods as bigint) * (growth as number) * 100 },
    { name: "rebalance", inputTypes: [FloatType], outputType: FloatType, fn: (x) => 1 - (x as number) },
];

/** An export is a seedable input iff it's a `DatasetDef` with a default. */
function isSeedableInput(x: unknown): x is DatasetDef & { default: NonNullable<DatasetDef["default"]> } {
    return typeof x === "object" && x !== null
        && (x as DatasetDef).kind === "dataset"
        && (x as DatasetDef).default !== undefined;
}

/** An export is a seedable function iff it's an `e3.function` def. */
function isFunctionDef(x: unknown): x is FunctionDef {
    return typeof x === "object" && x !== null && (x as FunctionDef).kind === "function";
}

/** An export is a seedable record iff it's an `e3.record` def. A record *is a*
 *  dataset (`kind: 'dataset'`); `recordKind` is the distinguishing discriminant. */
function isRecordDef(x: unknown): x is RecordDef {
    return typeof x === "object" && x !== null && (x as RecordDef).recordKind === "record";
}

/** An export is a mutation iff it's an `e3.mutation` def. */
function isMutationDef(x: unknown): x is MutationDef {
    return typeof x === "object" && x !== null && (x as MutationDef).kind === "mutation";
}

/**
 * Offline implementations for the `Record.bind` examples — the record-side
 * mirror of {@link exampleFunctionApi}. Each example module's `e3.record`s are
 * paired with the `e3.mutation`s that write them (matched by name), and each
 * mutation's East reducer body is compiled to JS so reads / mutations resolve
 * with no e3 backend.
 */
function exampleRecordDefs(): InMemoryRecordDef[] {
    const defs: InMemoryRecordDef[] = [];
    for (const mod of e3ExampleModules) {
        const mutations = Object.values(mod).filter(isMutationDef);
        for (const rec of Object.values(mod)) {
            if (!isRecordDef(rec)) continue;
            const recMutations: InMemoryRecordDef["mutations"] = [];
            for (const m of mutations) {
                if (m.record.name !== rec.name) continue;
                const body = m.body as { compile?: (p: never[]) => (...a: unknown[]) => unknown };
                try {
                    recMutations.push({ name: m.name, argTypes: [...m.argTypes], reduce: body.compile!([]) });
                } catch (err) {
                    console.warn(`[showcase] could not compile mutation "${m.name}":`, err);
                }
            }
            defs.push({ name: rec.name, stateType: rec.type, initial: rec.default, mutations: recMutations });
        }
    }
    return defs;
}

/**
 * Offline implementations for the `Func.bind` functions the examples call.
 *
 * The showcase can't run an e3 backend, so `Func.bind` has no server to call.
 * We stand in by compiling each example's exported `e3.function` East body to JS
 * (East functions are runnable on their own) — the function-side mirror of the
 * `e3.input` dataset seeding — plus a couple of hand-written fallbacks.
 */
function exampleFunctionApi() {
    const fns = new Map<string, InMemoryFunctionDef>();
    for (const mod of e3ExampleModules) {
        for (const value of Object.values(mod)) {
            if (!isFunctionDef(value)) continue;
            const body = value.body as {
                compile?: (p: never[]) => (...a: unknown[]) => unknown;
                compileAsync?: (p: never[]) => (...a: unknown[]) => Promise<unknown>;
            };
            try {
                const fn = typeof body.compile === "function" ? body.compile([]) : body.compileAsync!([]);
                fns.set(value.name, { name: value.name, inputTypes: [...value.inputTypes], outputType: value.outputType, fn });
            } catch (err) {
                console.warn(`[showcase] could not compile function "${value.name}":`, err);
            }
        }
    }
    for (const f of FALLBACK_FUNCTIONS) if (!fns.has(f.name)) fns.set(f.name, f);
    return createInMemoryFunctionApi([...fns.values()]);
}

/** Seed an in-memory reactive-dataset cache from every e3 example module's
 *  exported `e3.input` defaults, so `Data.bind` reads resolve offline —
 *  the browser-side mirror of the e3-ui-components snapshot harness, seeded
 *  once for the union of all examples instead of per-module. */
async function seedE3DatasetCache(): Promise<void> {
    const seed = new Map<string, Uint8Array>();
    const inputPaths: TreePath[] = [];
    for (const mod of e3ExampleModules) {
        for (const value of Object.values(mod)) {
            if (!isSeedableInput(value)) continue;
            seed.set(datasetCacheKey(WORKSPACE, value.path), encodeBeast2For(value.type)(value.default));
            inputPaths.push(value.path);
        }
    }

    const api: DatasetApi = {
        async get(ws, path) {
            const bytes = seed.get(datasetCacheKey(ws, path));
            if (!bytes) throw new Error(`no seed for ${datasetCacheKey(ws, path)}`);
            return { data: bytes, hash: null };
        },
        async set(ws, path, value) { seed.set(datasetCacheKey(ws, path), value); },
        async launchDataflow() { /* offline — nothing to launch */ },
        async listRoot() { return []; },
        async listAt() { return []; },
        async workspaceStatus() { return { datasets: [] }; },
    };

    const cache = new ReactiveDatasetCache({ workspace: WORKSPACE }, api);
    cache.setScheduler((notify) => queueMicrotask(notify));
    initializeReactiveDatasetCache(cache);
    initializeFunctionApi(exampleFunctionApi(), WORKSPACE);

    // Offline `Record.bind` impls — seeds each record's initial state into the
    // cache (so `read()` resolves) and stands in for the mutation backend.
    const recordDefs = exampleRecordDefs();
    if (recordDefs.length > 0) {
        initializeRecordApi(createInMemoryRecordApi(cache, WORKSPACE, recordDefs), cache, WORKSPACE);
    }

    await Promise.all(inputPaths.map(path => cache.preload(WORKSPACE, path)));
}

/* Route at the root: when `?file=<pathKey>` is in the URL we render the
 * isolated stack of cards for that source file *only* — no sidebar, no
 * header, no chrome. `scripts/snapshot-examples.ts` relies on this so
 * each generated HTML contains just the relevant example card(s). */
function Root() {
    const params = new URLSearchParams(window.location.search);
    const isolatedFile = params.get("file");
    if (isolatedFile) {
        const entries = catalog.filter(e => e.pathKey === isolatedFile);
        if (entries.length > 0) return <IsolatedFileView entries={entries} />;
    }
    return <App />;
}

/* Seed the e3 dataset cache before first render so `Data.bind` reads in
 * the e3 Components section never race the cache. A seeding failure only
 * degrades that section — the app still renders. */
seedE3DatasetCache()
    .catch(err => console.error("[showcase] e3 dataset cache seeding failed:", err))
    .finally(() => {
        createRoot(document.getElementById("root")!).render(
            <StrictMode>
                <ChakraProvider value={system}>
                    <UIStoreProvider store={store}>
                        <OverlayManagerProvider>
                            <DragLayerProvider>
                                <CodeBlock.AdapterProvider value={codeBlockAdapter}>
                                    <AppErrorBoundary>
                                        <Root />
                                    </AppErrorBoundary>
                                </CodeBlock.AdapterProvider>
                            </DragLayerProvider>
                        </OverlayManagerProvider>
                    </UIStoreProvider>
                </ChakraProvider>
            </StrictMode>
        );
    });
