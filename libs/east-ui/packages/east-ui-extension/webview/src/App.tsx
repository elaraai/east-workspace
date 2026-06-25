/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { ChakraProvider, Box, Flex } from '@chakra-ui/react';
import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OverlayManagerProvider, system } from '@elaraai/east-ui-components';
import { E3Provider, useE3Context } from './context/E3Context';
import { Toolbar } from './components/Toolbar';
import { WorkspaceTree } from './components/WorkspaceTree';
import { TaskPreview } from './components/TaskPreview';
import { ElaraLogo } from './components/ElaraLogo';
import { SidebarToggle } from './components/SidebarToggle';
import { StatusDisplay } from '@elaraai/e3-ui-components';

declare global {
    interface Window {
        __E3_API_URL__: string;
        __E3_REPO_PATH__: string;
    }
}

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 2,
            staleTime: 30_000, // 30 seconds
        },
    },
});

function AppContent() {
    const { sidebarCollapsed, toggleSidebar } = useE3Context();

    return (
        <Flex height="100vh" overflow="hidden">
            {/* Sidebar — full-height left rail (bsys nav.panel). Collapses to a
             *  56 px app-mark rail; the header lives over the main content only,
             *  so the wordmark anchors the app shell. */}
            <Box
                as="aside"
                layerStyle="nav.panel"
                width={sidebarCollapsed ? '56px' : '240px'}
                flexShrink={0}
                height="100vh"
                overflowY="auto"
                overflowX="hidden"
                transitionProperty="width"
                transitionDuration="{durations.normal}"
                transitionTimingFunction="{easings.smooth}"
            >
                {/* Logo region — bsys "Logo region": 64 px expanded · 56 px
                 *  collapsed · 16 px side padding · 12 px rule-free gap below. */}
                <Flex
                    layerStyle="nav.logo"
                    align="center"
                    justify={sidebarCollapsed ? 'center' : 'flex-start'}
                    px={sidebarCollapsed ? '0' : '16px'}
                    h={sidebarCollapsed ? '56px' : '64px'}
                    mb="12px"
                >
                    {sidebarCollapsed
                        ? <ElaraLogo variant="collapsed" height={8} width={8} />
                        : <ElaraLogo variant="full" height={8} />}
                </Flex>

                {sidebarCollapsed
                    ? (
                        <Flex justify="center">
                            <SidebarToggle aria-label="Expand sidebar" onClick={toggleSidebar} icon={faChevronRight} />
                        </Flex>
                    )
                    : <WorkspaceTree />}
            </Box>

            {/* Header bar + main content */}
            <Flex direction="column" flex={1} minWidth={0} overflow="hidden">
                <Toolbar />
                <Box flex={1} minWidth={0} minHeight={0} overflow="hidden">
                    <TaskPreview />
                </Box>
            </Flex>
        </Flex>
    );
}

export function App() {
    const apiUrl = window.__E3_API_URL__;
    const repoPath = window.__E3_REPO_PATH__;

    // Validate configuration
    if (!apiUrl || !repoPath) {
        return (
            <ChakraProvider value={system}>
                <StatusDisplay variant="error" title="Configuration Error" details="Missing configuration: API URL or repository path not provided" />
            </ChakraProvider>
        );
    }

    return (
        <QueryClientProvider client={queryClient}>
            <ChakraProvider value={system}>
                <OverlayManagerProvider>
                    <E3Provider apiUrl={apiUrl} repoPath={repoPath}>
                        <AppContent />
                    </E3Provider>
                </OverlayManagerProvider>
            </ChakraProvider>
        </QueryClientProvider>
    );
}
