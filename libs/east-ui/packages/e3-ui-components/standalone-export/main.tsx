/**
 * One page, no server: the Sheet's work orders on the in-memory record the snapshot harness stands in with — its
 * initial orders, its patch door compiled from the record's own mutation — so every action, Undo and Save works in
 * the page. A reload starts it over.
 */
import '@elaraai/east-ui-components/fonts';
import '@elaraai/e3-ui-components';
import { StrictMode } from 'react';
import type { EastType } from '@elaraai/east';
import { applyFor } from '@elaraai/east/internal';
import { createRoot } from 'react-dom/client';
import { Box, ChakraProvider } from '@chakra-ui/react';
import {
    system, UIStore, UIStoreProvider, OverlayManagerProvider, DragLayerProvider, EastFunction, type EastFunctionProps,
} from '@elaraai/east-ui-components';
import {
    ReactiveDatasetCache, initializeReactiveDatasetCache, initializeRecordApi, createInMemoryRecordApi, type DatasetApi, type InMemoryRecordDef,
} from '@elaraai/e3-ui-components';
import * as examples from '../../e3-ui/test/sheet/sheet-actions.examples.tsx';
import { workOrders } from './work-orders.tsx';

const WORKSPACE = 'standalone';

type MutationDef = { kind: 'mutation'; name: string; form?: string; argTypes: InMemoryRecordDef['mutations'][number]['argTypes']; body?: { compile: (p: never[]) => (...a: unknown[]) => unknown } };
type RecordDef = { recordKind: 'record'; name: string; type: EastType; default?: unknown; mutations: Readonly<Record<string, MutationDef>> };

/** The work orders' record, its own mutations each a reducer: the patch door applies its change, as e3 does. */
function records(): InMemoryRecordDef[] {
    const rec = examples.sheetWorkOrders as unknown as RecordDef;
    return [{
        name: rec.name, stateType: rec.type, ...(rec.default !== undefined && { initial: rec.default }),
        mutations: Object.values(rec.mutations).map((m) => {
            if (m.form === 'patch') {
                const apply = applyFor(rec.type);
                return { name: m.name, argTypes: [...m.argTypes], reduce: (state: unknown, patch: unknown) => apply(state, patch) };
            }
            return { name: m.name, argTypes: [...m.argTypes], reduce: m.body!.compile([]) };
        }),
    }];
}

const api: DatasetApi = {
    async get(ws, path) { throw new Error(`no dataset ${ws}:${JSON.stringify(path)}`); },
    async set() { /* nothing but the record */ },
    async launchDataflow() { /* offline */ },
    async listRoot() { return []; },
    async listAt() { return []; },
    async workspaceStatus() { return { datasets: [] }; },
};
const cache = new ReactiveDatasetCache({ workspace: WORKSPACE }, api);
cache.setScheduler((notify) => queueMicrotask(notify));
initializeReactiveDatasetCache(cache);
initializeRecordApi(createInMemoryRecordApi(cache, WORKSPACE, records()), cache, WORKSPACE);

const store = new UIStore();
const ir = workOrders.toIR() as EastFunctionProps['ir'];
createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ChakraProvider value={system}>
            <UIStoreProvider store={store}>
                <OverlayManagerProvider>
                    <DragLayerProvider>
                        <Box p="6" bg="bg.canvas" height="100vh" boxSizing="border-box">
                            <Box height="100%">
                                <EastFunction ir={ir} storageKey="standalone-work-orders" />
                            </Box>
                        </Box>
                    </DragLayerProvider>
                </OverlayManagerProvider>
            </UIStoreProvider>
        </ChakraProvider>
    </StrictMode>,
);
