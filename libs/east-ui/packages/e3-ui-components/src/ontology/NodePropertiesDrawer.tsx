/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<NodePropertiesDrawer>` — slide-out editor for a single ontology node.
 *
 * Ported from the east-ontology webview but decoupled from
 * `OntologyContext` — the node lookup and the update / delete callbacks
 * are injected by the parent renderer.
 *
 * Phase 2 wires the drawer to a read-only `node` lookup; in phase 3 the
 * `onUpdate` / `onDelete` callbacks become non-null and the edit footer
 * goes live.
 *
 * @packageDocumentation
 */

import { useEffect, useMemo, useState } from 'react';
import {
    Box, Drawer, Field, HStack, Input, NativeSelect, Portal, Text, Textarea, VStack,
} from '@chakra-ui/react';
import type { OntologyNode, OntologyNodeKind } from './types.js';
import { ALL_NODE_KINDS } from './types.js';
import { NODE_KIND_ACCENT } from './accents.js';

export interface NodePropertiesDrawerProps {
    /** Node to edit; `null` closes the drawer. */
    nodeId: string | null;
    /** Resolves a node id to its current ontology entry, or `undefined`. */
    getNode(id: string): OntologyNode | undefined;
    /** Close the drawer without committing pending edits. */
    onClose(): void;
    /** Apply edits to a node. Pass `null` to disable mutation (read-only). */
    onUpdate: ((id: string, updates: { type?: OntologyNodeKind; name?: string; description?: string }) => void) | null;
    /** Delete a node. Pass `null` to disable. */
    onDelete: ((id: string) => void) | null;
}

interface NodePropertiesFormProps {
    nodeId: string;
    node: OntologyNode;
    onUpdate: NodePropertiesDrawerProps['onUpdate'];
    onDelete: NodePropertiesDrawerProps['onDelete'];
    onClose: () => void;
}

function NodePropertiesForm({ nodeId, node, onUpdate, onDelete, onClose }: NodePropertiesFormProps) {
    const readonly = onUpdate === null;
    const serverName = node.name;
    const serverDesc = node.description.type === 'some' ? node.description.value : '';
    const [name, setName] = useState(serverName);
    const [description, setDescription] = useState(serverDesc);

    useEffect(() => { setName(serverName); }, [serverName]);
    useEffect(() => { setDescription(serverDesc); }, [serverDesc]);

    return (
        <VStack gap="4" align="stretch">
            <Field.Root>
                <Field.Label fontFamily="mono" fontSize="2xs" letterSpacing="widest" textTransform="uppercase" color="fg.muted">
                    Type
                </Field.Label>
                <HStack gap="2" alignItems="center">
                    <Box w="8px" h="8px" borderRadius="full" bg={NODE_KIND_ACCENT[node.type.type]} flexShrink={0} />
                    <NativeSelect.Root size="sm" flex="1" disabled={readonly}>
                        <NativeSelect.Field
                            value={node.type.type}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onUpdate?.(nodeId, { type: e.target.value as OntologyNodeKind })}
                        >
                            {ALL_NODE_KINDS.map(nt => <option key={nt} value={nt}>{nt}</option>)}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                    </NativeSelect.Root>
                </HStack>
            </Field.Root>

            <Field.Root>
                <Field.Label fontFamily="mono" fontSize="2xs" letterSpacing="widest" textTransform="uppercase" color="fg.muted">
                    Name
                </Field.Label>
                <Input
                    size="sm"
                    value={name}
                    disabled={readonly}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                    onBlur={() => { if (!readonly && name !== serverName) onUpdate?.(nodeId, { name }); }}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                        if (readonly) return;
                        if (e.key === 'Enter' && name !== serverName) onUpdate?.(nodeId, { name });
                    }}
                />
            </Field.Root>

            <Field.Root>
                <Field.Label fontFamily="mono" fontSize="2xs" letterSpacing="widest" textTransform="uppercase" color="fg.muted">
                    Description
                </Field.Label>
                <Textarea
                    size="sm"
                    value={description}
                    rows={4}
                    disabled={readonly}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                    onBlur={() => { if (!readonly && description !== serverDesc) onUpdate?.(nodeId, { description }); }}
                />
            </Field.Root>

            {!readonly && (
                <HStack gap="2" pt="2" borderTop="1px solid" borderColor="border.subtle" justifyContent="space-between">
                    <Box
                        as="button"
                        fontFamily="mono"
                        fontSize="xs"
                        letterSpacing="wider"
                        textTransform="uppercase"
                        color="ink.danger"
                        px="3" py="1.5"
                        border="1px solid"
                        borderColor="transparent"
                        _hover={{ borderColor: 'ink.danger' }}
                        onClick={() => { onDelete?.(nodeId); onClose(); }}
                    >
                        Delete
                    </Box>
                    <Text fontFamily="mono" fontSize="2xs" letterSpacing="widest" textTransform="uppercase" color="fg.subtle">
                        Edits save on blur
                    </Text>
                </HStack>
            )}
        </VStack>
    );
}

export function NodePropertiesDrawer({ nodeId, getNode, onClose, onUpdate, onDelete }: NodePropertiesDrawerProps) {
    const node = useMemo(() => (nodeId ? getNode(nodeId) : undefined), [nodeId, getNode]);
    const open = nodeId !== null && node !== undefined;

    return (
        <Drawer.Root open={open} onOpenChange={(d) => { if (!d.open) onClose(); }} placement="end" size="sm">
            <Portal>
                <Drawer.Backdrop />
                <Drawer.Positioner>
                    <Drawer.Content bg="bg.surface" borderLeft="1px solid" borderColor="border.subtle">
                        {/* eyebrow header */}
                        <Drawer.Header bg="bg.panel" borderBottom="1px solid" borderColor="border.subtle" px="4" py="3">
                            <HStack justify="space-between" alignItems="center">
                                <Text fontFamily="mono" fontSize="xs" fontWeight="semibold" letterSpacing="widest" textTransform="uppercase" color="fg">
                                    Edit Node
                                </Text>
                                {nodeId && (
                                    <Text fontFamily="mono" fontSize="2xs" letterSpacing="wider" color="fg.muted">
                                        {nodeId}
                                    </Text>
                                )}
                            </HStack>
                        </Drawer.Header>
                        <Drawer.Body px="4" py="4">
                            {node && nodeId && (
                                <NodePropertiesForm
                                    nodeId={nodeId}
                                    node={node}
                                    onUpdate={onUpdate}
                                    onDelete={onDelete}
                                    onClose={onClose}
                                />
                            )}
                        </Drawer.Body>
                    </Drawer.Content>
                </Drawer.Positioner>
            </Portal>
        </Drawer.Root>
    );
}
