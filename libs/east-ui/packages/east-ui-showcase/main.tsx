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
    DragLayerProvider, OverlayManagerProvider, system, UIStore, UIStoreProvider,
} from "@elaraai/east-ui-components";
import { initializeStore, resetKept } from "@elaraai/east-ui-components/internal";
// Side-effect import: registers the `Data.bind`, `Data.bindPaged`,
// `Func.bind` and `Record.bind` platform impls + the Diff / Ontology /
// Experiment / decision / Studio / query renderers against the global
// registries EastFunction renders through, so the e3 Components section runs
// live.
import "@elaraai/e3-ui-components";
import { QueryPlanOptionsProvider } from "@elaraai/e3-ui-components";
import { App } from "./App";
import { applyTheme, resolveInitialTheme } from "./theme-mode";
import { catalog } from "./catalog";
import { codeBlockAdapter, forgetShownExamples } from "./components/PatternEntry";
import { IsolatedFileView } from "./components/IsolatedFileView";
import { AppErrorBoundary } from "./components/ErrorOverlay";
import { HostParts } from "./components/HostParts";
import { ShowcaseE3Runtime } from "./components/ShowcaseE3";
import { resetShowcaseE3 } from "./showcase-e3";
import { SHOWCASE_PIECE_MIN } from "./showcase-pieces";

/* Stamp the colour mode onto <html> before anything renders (#362) —
 * `?theme=dark` must also govern the `?file=` isolated views. */
applyTheme(resolveInitialTheme());

let store = new UIStore();

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

const container = document.getElementById("root")!;
const root = createRoot(container);

/** How many times the page has been drawn: each draw under a key of its own, so a redraw mounts every part afresh. */
let draws = 0;

function draw(): void {
    root.render(
        <StrictMode key={draws}>
            <ChakraProvider value={system}>
                <UIStoreProvider store={store}>
                    <OverlayManagerProvider>
                        <DragLayerProvider>
                            <CodeBlock.AdapterProvider value={codeBlockAdapter}>
                                <AppErrorBoundary>
                                    {/* The query builder's runs go to the e3 the page runs
                                      * (#1132), through each e3 example's E3Provider: a run
                                      * over a dataset of more than that e3's smallest piece
                                      * is a split call over its pieces (#941, #942). */}
                                    <QueryPlanOptionsProvider pieceBytes={SHOWCASE_PIECE_MIN}>
                                        <Root />
                                    </QueryPlanOptionsProvider>
                                    {/* The e3 the page runs (#849), once an e3 example has
                                      * started it: e3-ui-components' providers over it, which
                                      * every e3 example's bindings resolve through. */}
                                    <ShowcaseE3Runtime />
                                </AppErrorBoundary>
                            </CodeBlock.AdapterProvider>
                        </DragLayerProvider>
                    </OverlayManagerProvider>
                </UIStoreProvider>
            </ChakraProvider>
        </StrictMode>
    );
}

draw();

/**
 * The responsive suite's kept page (#1466): a page served one test after
 * another, which the suite marks before it loads (`tests/responsive/kept-page.ts`)
 * and which no page a person opens is. Its reset makes the page as a fresh
 * load at an address would: the address set, the page at its top, its theme
 * stamped, what the page
 * keeps outside the parts it draws dropped — the edits kept and staged, the
 * state the East UI binds, the examples shown, the session of the e3 the page
 * runs — and every part drawn afresh. The page's storage stays, as a reload
 * keeps it: the suite clears it as each test starts, as a new browser context
 * has none. A page whose document no longer holds the showcase (a spec set
 * content of its own) is not reset: the suite loads it.
 */
if ((window as { __showcaseKeptPage?: boolean }).__showcaseKeptPage === true) {
    (window as { __showcaseReset?: (address: string) => boolean }).__showcaseReset = (address) => {
        if (!container.isConnected) return false;
        history.replaceState(null, "", address);
        scrollTo(0, 0);
        applyTheme(resolveInitialTheme());
        resetKept();
        store = new UIStore();
        initializeStore(store);
        forgetShownExamples();
        resetShowcaseE3();
        draws++;
        draw();
        return true;
    };
}
