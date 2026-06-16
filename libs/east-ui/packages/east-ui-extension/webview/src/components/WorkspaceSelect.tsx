/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Workspace switcher — the compact `select` (size `sm`) pinned to the right of
 * the app bar. Picking a workspace scopes the sidebar nav (its Inputs + Tasks)
 * and clears the item selection. Auto-selects the first workspace once the list
 * lands and nothing valid is active.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo } from 'react';
import { Select as ChakraSelect, createListCollection, Portal, Spinner } from '@chakra-ui/react';
import { useWorkspaceList } from '@elaraai/e3-ui-components';
import { useE3Context } from '../context/E3Context';

export function WorkspaceSelect() {
    const { apiUrl, currentWorkspace, setCurrentWorkspace, setSelection } = useE3Context();
    const { data: workspaces, isLoading } = useWorkspaceList(apiUrl, 'default', undefined, {
        refetchInterval: 5000,
    });

    // Default to the first workspace once the list lands and nothing valid is active.
    useEffect(() => {
        if (!workspaces || workspaces.length === 0) return;
        const names = workspaces.map(w => w.name);
        if (!currentWorkspace || !names.includes(currentWorkspace)) {
            setCurrentWorkspace(names[0]!);
        }
    }, [workspaces, currentWorkspace, setCurrentWorkspace]);

    const collection = useMemo(
        () => createListCollection({ items: (workspaces ?? []).map(w => ({ value: w.name, label: w.name })) }),
        [workspaces],
    );

    const handleValueChange = useCallback((details: { value: string[] }) => {
        const next = details.value[0];
        if (!next) return;
        setCurrentWorkspace(next);
        setSelection({ type: 'none' }); // a workspace switch clears the item selection
    }, [setCurrentWorkspace, setSelection]);

    if (isLoading && !workspaces) {
        return <Spinner size="xs" />;
    }

    return (
        <ChakraSelect.Root
            size="sm"
            width="44"
            collection={collection}
            value={currentWorkspace ? [currentWorkspace] : []}
            onValueChange={handleValueChange}
            positioning={{ sameWidth: true }}
        >
            <ChakraSelect.HiddenSelect />
            <ChakraSelect.Control>
                <ChakraSelect.Trigger aria-label="Workspace">
                    <ChakraSelect.ValueText placeholder="Workspace" />
                </ChakraSelect.Trigger>
                <ChakraSelect.IndicatorGroup>
                    <ChakraSelect.Indicator />
                </ChakraSelect.IndicatorGroup>
            </ChakraSelect.Control>
            <Portal>
                <ChakraSelect.Positioner>
                    <ChakraSelect.Content>
                        {collection.items.map(item => (
                            <ChakraSelect.Item key={item.value} item={item}>
                                {item.label}
                                <ChakraSelect.ItemIndicator />
                            </ChakraSelect.Item>
                        ))}
                    </ChakraSelect.Content>
                </ChakraSelect.Positioner>
            </Portal>
        </ChakraSelect.Root>
    );
}
