/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Shared browser render harness for east-ui-family snapshot pages.
 *
 * Both component packages (`east-ui-components`, `e3-ui-components`) mount
 * their snapshot entry through this. The per-package `main.tsx` supplies:
 *   - `modules` — the `import.meta.glob` result for that package's example
 *     tree (the glob must live in `main.tsx` so Vite can resolve it
 *     statically), keyed by the `?file=` value.
 *   - `prepare?` — an optional async step run before render. e3-ui seeds a
 *     dataset cache here; east-ui omits it.
 *
 * Routing:
 *   - `?file=<key>`                → render every example in that file,
 *     stacked (per-file image).
 *   - `?file=<key>&example=<name>` → render just that example, full-bleed
 *     (per-example image).
 *
 * @packageDocumentation
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, ChakraProvider, Container, Stack, Text } from '@chakra-ui/react';
import type { ExampleDef } from '@elaraai/east';
import {
    system,
    UIStore,
    UIStoreProvider,
    OverlayManagerProvider,
    DragLayerProvider,
    EastFunction,
    type EastFunctionProps,
} from '@elaraai/east-ui-components';

export interface MountSnapshotOptions {
    /** `import.meta.glob` result, keyed by the `?file=` value. */
    modules: Record<string, () => Promise<Record<string, unknown>>>;
    /**
     * Map a glob filepath to its `?file=` key. Default: basename minus
     * `.examples.ts` (e.g. `ontology`). east-ui passes a variant that keeps
     * the category path (e.g. `buttons/button`).
     */
    keyOf?: (filePath: string) => string;
    /** Optional async preparation (e.g. seed a dataset cache) before render. */
    prepare?: (mod: Record<string, unknown>) => Promise<void>;
}

/** An example module export is an {@link ExampleDef} iff it carries an
 *  East `fn` — the same discriminant `east-ui-showcase/catalog.ts` uses. */
export function isExampleDef(x: unknown): x is ExampleDef {
    return typeof x === 'object' && x !== null && (x as Partial<ExampleDef>).fn != null;
}

function ExampleFrame({ name, example, fileKey }: { name: string; example: ExampleDef; fileKey: string }) {
    return (
        <Box display="flex" flexDirection="column" gap="2">
            <Text textStyle="mono.label">{name}</Text>
            <Text fontSize="13px" color="fg.muted" lineHeight="1.45" maxW="70ch">
                {example.description}
            </Text>
            <Box layerStyle="frame" p="6" bg="bg.surface">
                {/* ExampleDef.fn erases its output type at the package boundary;
                 *  every snapshot example is a UI component by construction. */}
                <EastFunction ir={example.fn.toIR() as EastFunctionProps['ir']} storageKey={`snapshot-${fileKey}-${name}`} />
            </Box>
        </Box>
    );
}

type BootState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; fileKey: string; only: string | null; examples: [string, ExampleDef][] };

function Root({ modules, keyOf, prepare }: Required<Pick<MountSnapshotOptions, 'modules'>> & MountSnapshotOptions) {
    const [state, setState] = useState<BootState>({ kind: 'loading' });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const params = new URLSearchParams(window.location.search);
            const fileKey = params.get('file');
            const only = params.get('example');
            const byKey = Object.fromEntries(
                Object.entries(modules).map(([fp, load]) => [
                    (keyOf ?? defaultKeyOf)(fp), load,
                ]),
            );
            if (!fileKey) {
                setState({ kind: 'error', message: `missing ?file= (have: ${Object.keys(byKey).join(', ')})` });
                return;
            }
            const load = byKey[fileKey];
            if (!load) {
                setState({ kind: 'error', message: `unknown file "${fileKey}" (have: ${Object.keys(byKey).join(', ')})` });
                return;
            }
            const mod = await load();
            if (prepare) await prepare(mod);
            if (cancelled) return;
            const examples = Object.entries(mod).filter((e): e is [string, ExampleDef] => isExampleDef(e[1]));
            setState({ kind: 'ready', fileKey, only, examples });
        })().catch((err: unknown) => {
            if (!cancelled) setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        });
        return () => { cancelled = true; };
    }, [modules, keyOf, prepare]);

    if (state.kind === 'loading') return <Box data-snapshot-boot p="6" fontFamily="mono">Loading…</Box>;
    if (state.kind === 'error') return <Box p="6" fontFamily="mono" color="fg.danger">Snapshot error: {state.message}</Box>;

    // Per-example: render just the one, full-bleed.
    if (state.only) {
        const hit = state.examples.find(([n]) => n === state.only);
        if (!hit) return <Box p="6" fontFamily="mono" color="fg.danger">no example "{state.only}" in {state.fileKey}</Box>;
        return (
            <Box p="6" bg="bg.canvas" minH="100vh">
                <ExampleFrame name={hit[0]} example={hit[1]} fileKey={state.fileKey} />
            </Box>
        );
    }

    // Per-file: stack every example.
    return (
        <Box p="6" bg="bg.canvas" minH="100vh">
            <Container maxW="1100px" px="0">
                <Text textStyle="eyebrow.mono" mb="2">§ {state.fileKey}</Text>
                <Stack gap="6">
                    {state.examples.map(([name, ex]) => (
                        <ExampleFrame key={name} name={name} example={ex} fileKey={state.fileKey} />
                    ))}
                </Stack>
            </Container>
        </Box>
    );
}

function defaultKeyOf(filePath: string): string {
    return filePath.replace(/^.*\//, '').replace(/\.examples\.tsx?$/, '');
}

/** Mount the snapshot harness into `#root`. */
export function mountSnapshot(opts: MountSnapshotOptions): void {
    const store = new UIStore();
    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <ChakraProvider value={system}>
                <UIStoreProvider store={store}>
                    <OverlayManagerProvider>
                        <DragLayerProvider>
                            <Root modules={opts.modules} keyOf={opts.keyOf} prepare={opts.prepare} />
                        </DragLayerProvider>
                    </OverlayManagerProvider>
                </UIStoreProvider>
            </ChakraProvider>
        </StrictMode>,
    );
}
