/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The harness's page: a deployed ui() task drawn as an app draws one — `E3Provider`, `ReactiveDatasetProvider`,
 * `UITaskPreview` — over the e3 server the harness runs, never an e3 in the page, so every read the surface makes is
 * a request to it, answered from the repository on its disk.
 *
 * A bar over the surface lists the repository's workspaces, and the address's hash chooses one (`#jobs-1m`); with
 * none, the first. The task is `plan_lab`, the plan-scale lab's Plan, unless the address names another
 * (`?task=name`). The server is the page's own host on port 3300, unless the address names another
 * (`?api=http://host:port`).
 *
 * @packageDocumentation
 */

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Box, ChakraProvider, HStack, Link, Text } from "@chakra-ui/react";
import "@elaraai/east-ui-components/fonts";
import { DragLayerProvider, OverlayManagerProvider, system, UIStore, UIStoreProvider } from "@elaraai/east-ui-components";
// Side-effect import as well: it registers the bindings' platform impls and the builders' renderers the task draws with.
import { E3Provider, ReactiveDatasetProvider, UITaskPreview } from "@elaraai/e3-ui-components";
import { workspaceList } from "@elaraai/e3-api-client";
import { StringType, equalFor } from "@elaraai/east";

const params = new URLSearchParams(location.search);
/** The e3 server: the page's own host on the harness's port, unless the address names another. */
const API = params.get("api") ?? `${location.protocol}//${location.hostname}:3300`;
/** The server's one repository: e3-api-server serves `--repo` as `default`. */
const REPO = "default";
/** The ui() task the page draws. */
const TASK = params.get("task") ?? "plan_lab";

const sameName = equalFor(StringType);

/** The workspace the address's hash names, or none. */
const hashed = (): string | undefined => (location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : undefined);

function Harness() {
    const [workspaces, setWorkspaces] = useState<readonly string[] | undefined>(undefined);
    const [error, setError] = useState<string | undefined>(undefined);
    const [chosen, setChosen] = useState(hashed);
    useEffect(() => {
        const follow = () => setChosen(hashed());
        addEventListener("hashchange", follow);
        return () => removeEventListener("hashchange", follow);
    }, []);
    useEffect(() => {
        workspaceList(API, REPO, { token: null }).then(
            (list) => setWorkspaces(list.map((info) => info.name)),
            (err: unknown) => setError(`${API}: ${err instanceof Error ? err.message : String(err)}`),
        );
    }, []);
    const workspace = chosen ?? workspaces?.[0];
    return (
        <Box height="100vh" display="flex" flexDirection="column" bg="bg.surface">
            <HStack height="48px" flex="none" paddingInline="4" gap="5" borderBottomWidth="1px" borderColor="border.subtle">
                <Text fontWeight="semibold">{TASK}</Text>
                {workspaces?.map((name) => (
                    <Link key={name} href={`#${encodeURIComponent(name)}`} data-harness-workspace={name}
                        fontWeight={workspace !== undefined && sameName(name, workspace) ? "bold" : "normal"}>
                        {name}
                    </Link>
                ))}
                {error !== undefined && <Text color="fg.error">{error}</Text>}
            </HStack>
            <Box flex="1" minHeight="0">
                {workspace !== undefined && (
                    // A provider a workspace, so a choice starts its reads afresh.
                    <E3Provider key={workspace} config={{ apiUrl: API, repo: REPO, workspace }}>
                        <ReactiveDatasetProvider>
                            <UITaskPreview task={TASK} bare />
                        </ReactiveDatasetProvider>
                    </E3Provider>
                )}
            </Box>
        </Box>
    );
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ChakraProvider value={system}>
            <UIStoreProvider store={new UIStore()}>
                <OverlayManagerProvider>
                    <DragLayerProvider>
                        <Harness />
                    </DragLayerProvider>
                </OverlayManagerProvider>
            </UIStoreProvider>
        </ChakraProvider>
    </StrictMode>,
);
