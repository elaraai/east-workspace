/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * App bar — the compact `eyebrowRow` strip over the main content. A single row:
 * a `breadcrumb` trail of the current selection on the left (repo › workspace ›
 * Inputs/Tasks › item), a live connection dot and the workspace `select` on the
 * right. Replaces the old two-row `header.bar`.
 *
 * @packageDocumentation
 */

import { Fragment, useMemo } from 'react';
import { Box, HStack, chakra, useSlotRecipe } from '@chakra-ui/react';
import { useE3Context, type Selection } from '../context/E3Context';
import { StatusIndicator } from './StatusIndicator';
import { WorkspaceSelect } from './WorkspaceSelect';

interface Crumb {
    label: string;
    /** Navigates when this crumb is not the current (last) one. */
    onClick?: () => void;
}

/** Build the breadcrumb trail root-first; the last entry is the current view. */
function buildCrumbs(
    selection: Selection,
    repoName: string,
    currentWorkspace: string | null,
    setSelection: (s: Selection) => void,
): Crumb[] {
    const crumbs: Crumb[] = [{ label: repoName }];
    if (currentWorkspace) {
        crumbs.push({ label: currentWorkspace, onClick: () => setSelection({ type: 'none' }) });
    }
    if (selection.type === 'task') {
        crumbs.push({ label: 'Tasks' });
        crumbs.push({ label: selection.task });
    } else if (selection.type === 'input') {
        crumbs.push({ label: 'Inputs' });
        crumbs.push({ label: selection.path.replace(/^\.inputs\./, '') });
    }
    return crumbs;
}

export function Toolbar() {
    const { repoPath, selection, currentWorkspace, setSelection } = useE3Context();
    const bar = useSlotRecipe({ key: 'eyebrowRow' })();
    const crumb = useSlotRecipe({ key: 'breadcrumb' })();
    const repoName = useMemo(() => repoPath.split('/').pop() ?? repoPath, [repoPath]);
    const crumbs = useMemo(
        () => buildCrumbs(selection, repoName, currentWorkspace, setSelection),
        [selection, repoName, currentWorkspace, setSelection],
    );

    return (
        <Box as="header" css={bar.root} color="fg">
            <Box as="nav" aria-label="Breadcrumb" css={crumb.root} minWidth={0} overflow="hidden">
                <Box as="ol" css={crumb.list} title={repoPath}>
                    {crumbs.map((c, i) => {
                        const isLast = i === crumbs.length - 1;
                        return (
                            <Fragment key={i}>
                                {i > 0 && <Box as="li" css={crumb.separator} aria-hidden="true">›</Box>}
                                <Box as="li" css={crumb.item}>
                                    {isLast ? (
                                        <Box as="span" css={crumb.currentLink} aria-current="page">{c.label}</Box>
                                    ) : c.onClick ? (
                                        <chakra.button type="button" css={crumb.link} onClick={c.onClick}>{c.label}</chakra.button>
                                    ) : (
                                        <Box as="span" css={crumb.link}>{c.label}</Box>
                                    )}
                                </Box>
                            </Fragment>
                        );
                    })}
                </Box>
            </Box>

            <HStack gap="3" flexShrink={0}>
                <StatusIndicator tone="success" label="Connected" live hideLabel />
                <WorkspaceSelect />
            </HStack>
        </Box>
    );
}
