/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Header bar — bsys "Header recipe". Two rows, sticky to viewport top, no logo
 * (the wordmark lives in the sidebar app shell), no back-button (the breadcrumb
 * is the back-button).
 *   Row 1 — breadcrumb left · connection trust-chip right.
 *   Row 2 — surface title left · state eyebrow immediately right of it.
 *
 * @packageDocumentation
 */

import { Fragment, useMemo } from 'react';
import { Box, Flex, Heading, Text } from '@chakra-ui/react';
import { useE3Context, type Selection } from '../context/E3Context';
import { StatusIndicator } from './StatusIndicator';

interface SurfaceDescriptor {
    /** Breadcrumb trail, root-first. The last segment is the current surface. */
    crumbs: string[];
    /** Row 2 surface title. */
    title: string;
    /** Row 2 state eyebrow (mode); null when there is no active surface. */
    mode: string | null;
}

function describeSelection(selection: Selection, repoName: string): SurfaceDescriptor {
    switch (selection.type) {
        case 'none':
            return { crumbs: [repoName], title: 'East UI Preview', mode: null };
        case 'workspace':
            return { crumbs: [repoName, selection.workspace], title: selection.workspace, mode: 'Workspace' };
        case 'task':
            return { crumbs: [repoName, selection.workspace, selection.task], title: selection.task, mode: 'Task' };
        case 'input': {
            const name = selection.path.replace(/^\.inputs\./, '');
            return { crumbs: [repoName, selection.workspace, name], title: name, mode: 'Input' };
        }
    }
}

export function Toolbar() {
    const { repoPath, selection } = useE3Context();
    const repoName = useMemo(() => repoPath.split('/').pop() ?? repoPath, [repoPath]);
    const { crumbs, title, mode } = useMemo(() => describeSelection(selection, repoName), [selection, repoName]);

    return (
        <Box as="header" layerStyle="header.bar" color="fg">
            {/* Row 1 — breadcrumb left · connection trust-chip right · 28 px */}
            <Flex align="center" gap="3" mb="6px" h="28px">
                <Text textStyle="breadcrumb" title={repoPath}>
                    {crumbs.map((seg, i) => (
                        <Fragment key={i}>
                            {i > 0 && <Box as="span" color="fg.subtle" px="1">/</Box>}
                            <Box as="span" color={i === crumbs.length - 1 ? 'fg' : 'brand.600'}>{seg}</Box>
                        </Fragment>
                    ))}
                </Text>
                <Box ml="auto">
                    <StatusIndicator tone="success" label="Connected" live />
                </Box>
            </Flex>

            {/* Row 2 — surface title left · state eyebrow right of it · 36 px */}
            <Flex align="baseline" gap="3.5" h="36px">
                <Heading as="h1" textStyle="surface.title">{title}</Heading>
                {mode && <Text textStyle="state.eyebrow">{mode}</Text>}
            </Flex>
        </Box>
    );
}
