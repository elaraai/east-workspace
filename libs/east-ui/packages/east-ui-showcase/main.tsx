// First: the built showcase builds its East functions without capturing
// source locations, so this precedes every module that builds East, the
// component libraries the error overlay imports included.
import "./source-locations";
// MUST precede the catalog: registers the global error handlers before the
// eager `catalog` import below can throw, so a load-time crash surfaces as
// the copyable error alert rather than a blank page.
import "./install-error-overlay";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChakraProvider, CodeBlock } from "@chakra-ui/react";
import "@elaraai/east-ui-components/fonts";
import {
    AppProvider, DragLayerProvider, OverlayManagerProvider, system, UIStore, UIStoreProvider,
} from "@elaraai/east-ui-components";
// Side-effect import: registers the `Data.bind`, `Data.bindPaged`,
// `Func.bind` and `Record.bind` platform impls + the Diff / Ontology /
// Experiment / decision / Studio renderers against the global registries
// EastFunction renders through, so the e3 Components section runs live.
import "@elaraai/e3-ui-components";
import {
    createInMemoryQueryCall,
    createInMemorySourceStatus,
    QueryCallProvider,
    QuerySourceStatusProvider,
    type InMemoryDataset,
} from "@elaraai/e3-ui-components";
import type { DatasetDef } from "@elaraai/e3";
import { App } from "./App";
import { applyTheme, resolveInitialTheme } from "./theme-mode";
import { catalog, e3ExampleModules } from "./catalog";
import { codeBlockAdapter } from "./components/PatternEntry";
import { IsolatedFileView } from "./components/IsolatedFileView";
import { AppErrorBoundary } from "./components/ErrorOverlay";
import { HostBarEnd, HostRailFooter } from "./components/HostChrome";
import { HostParts } from "./components/HostParts";
import { ShowcaseE3Runtime } from "./components/ShowcaseE3";

/* Stamp the colour mode onto <html> before anything renders (#362) —
 * `?theme=dark` must also govern the `?file=` isolated views. */
applyTheme(resolveInitialTheme());

const store = new UIStore();

/** An export is an `e3.input` whose initial value is inline — a `value` source. */
function isSeedableInput(x: unknown): x is DatasetDef & { source: Extract<NonNullable<DatasetDef["source"]>, { type: "value" }> } {
    return typeof x === "object" && x !== null
        && (x as DatasetDef).kind === "dataset"
        && (x as DatasetDef).source?.type === "value";
}

/** Every e3 example module's exported `e3.input`s, with their inline values. */
function exampleQueryDatasets(): InMemoryDataset[] {
    const datasets: InMemoryDataset[] = [];
    for (const mod of e3ExampleModules) {
        for (const value of Object.values(mod)) {
            if (!isSeedableInput(value)) continue;
            datasets.push({ path: value.path, type: value.type, value: value.source.value });
        }
    }
    return datasets;
}

const queryDatasets = exampleQueryDatasets();

/** The query builder's one-shot calls (#940), answered in the browser over the
 *  e3 examples' inline inputs. The examples' bindings resolve through the e3
 *  the page runs (#849); a query's call runs its body here. */
const queryCall = createInMemoryQueryCall(queryDatasets);

/** The same inputs' statuses (#941): what each holds and weighs, which a run
 *  of the query builder weighs before it plans. The showcase's datasets are
 *  tiny, so every run plans one call — and its plan says so. */
const queryStatus = createInMemorySourceStatus(queryDatasets);

/* Route at the root: when `?file=<pathKey>` is in the URL we render the
 * isolated stack of cards for that source file *only* — no sidebar, no
 * header, no chrome — so a capture of the page holds just that file's
 * example card(s). `?host=parts` renders Chakra's own parts as a host app
 * draws them (#1091), for the responsive suite to hold the theme's defaults. */
function Root() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("host") === "parts") return <HostParts />;
    const isolatedFile = params.get("file");
    if (isolatedFile) {
        const entries = catalog.filter(e => e.pathKey === isolatedFile);
        if (entries.length > 0) return <IsolatedFileView entries={entries} />;
    }
    return <App />;
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ChakraProvider value={system}>
            <UIStoreProvider store={store}>
                <OverlayManagerProvider>
                    <DragLayerProvider>
                        <CodeBlock.AdapterProvider value={codeBlockAdapter}>
                            {/* Dogfood AppProvider (#367): the east-ui <App> examples render
                             *  this host-injected React chrome in their bar / rail. */}
                            <AppProvider barEnd={<HostBarEnd />} railFooter={<HostRailFooter />}>
                                <AppErrorBoundary>
                                    {/* The query builder's runs, answered in the browser (#940),
                                      * each planned over its datasets' statuses (#941). */}
                                    <QueryCallProvider call={queryCall}>
                                        <QuerySourceStatusProvider status={queryStatus}>
                                            <Root />
                                        </QuerySourceStatusProvider>
                                    </QueryCallProvider>
                                    {/* The e3 the page runs (#849), once an e3 example has
                                      * started it: e3-ui-components' providers over it, which
                                      * every e3 example's bindings resolve through. */}
                                    <ShowcaseE3Runtime />
                                </AppErrorBoundary>
                            </AppProvider>
                        </CodeBlock.AdapterProvider>
                    </DragLayerProvider>
                </OverlayManagerProvider>
            </UIStoreProvider>
        </ChakraProvider>
    </StrictMode>
);
