import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChakraProvider, CodeBlock } from "@chakra-ui/react";
import "@elaraai/east-ui-components/fonts";
import {
    OverlayManagerProvider, system, UIStore, UIStoreProvider,
} from "@elaraai/east-ui-components";
import { App } from "./App";
import { catalog } from "./catalog";
import { codeBlockAdapter } from "./components/ExampleCard";
import { IsolatedFileView } from "./components/IsolatedFileView";

const store = new UIStore();

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

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ChakraProvider value={system}>
            <UIStoreProvider store={store}>
                <OverlayManagerProvider>
                    <CodeBlock.AdapterProvider value={codeBlockAdapter}>
                        <Root />
                    </CodeBlock.AdapterProvider>
                </OverlayManagerProvider>
            </UIStoreProvider>
        </ChakraProvider>
    </StrictMode>
);
