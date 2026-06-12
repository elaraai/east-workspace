/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraOntology` — Chakra v3 + ReactFlow renderer for the `Ontology`
 * extension component declared in `@elaraai/e3-ui`. Mounts the graph
 * editor over a bound `OntologyType` dataset, with the same staged-buffer
 * + commit machinery `EastChakraDiff` uses.
 *
 * Phase 2 wires the read side end-to-end (binding → decode → render);
 * `onMutate` is wired but the canvas mutation paths (add / delete /
 * connect) are inert until Phase 3 promotes them from no-ops.
 *
 * Registers itself against {@link Ontology.Component} at module load via
 * {@link implementUIComponent}.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, useState } from 'react';
import {
    Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider,
    type Connection, type EdgeTypes, type Node as FlowNode, type NodeTypes,
} from '@xyflow/react';
import { Global } from '@emotion/react';
// xyflow ships a static stylesheet its nodes/edges need for positioning.
// The rest of the design system is emotion CSS-in-JS (no static CSS files),
// so rather than make every consumer remember a separate `.css` import (and
// silently collapse if they don't), we bundle the stylesheet into the JS as
// a string and inject it through emotion's <Global>, scoped to the editor —
// same self-contained model as east-ui-components.
// @ts-expect-error — `?inline` returns the stylesheet as a string at build time.
import xyflowCss from '@xyflow/react/dist/style.css?inline';
import { Box, HStack, Input, Menu, Portal, SegmentGroup, Text } from '@chakra-ui/react';
import { FiList, FiSearch, FiShare2, FiX } from 'react-icons/fi';
import { none, some, variant, type ValueTypeOf } from '@elaraai/east';
import { Ontology } from '@elaraai/e3-ui/internal';
import { implementUIComponent } from '@elaraai/east-ui-components';

import { OntologyNode, type OntologyFlowNodeData } from './OntologyNode.js';
import { OntologyEdge } from './OntologyEdge.js';
import { NodePropertiesDrawer } from './NodePropertiesDrawer.js';
import { OntologyTable } from './OntologyTable.js';
import {
    ALL_NODE_KINDS,
    ValidLinks,
    flattenOntology,
    type Ontology as OntologyValue,
    type OntologyLink as OntologyLinkValue,
    type OntologyNode as OntologyNodeValue,
    type OntologyNodeKind,
} from './types.js';
import { NODE_KIND_ACCENT } from './accents.js';
import { useFlowState } from './flow-state.js';
import { useBindingOntology } from './bind-runtime.js';

// Monotonic counter for new node ids — synchronous so a pane "add node" can
// seed the node's position before the binding refetch rebuilds the graph.
let nodeIdSeq = 0;
function freshNodeId(): string {
    nodeIdSeq += 1;
    return `node-${Date.now()}-${nodeIdSeq}`;
}

const NODE_TYPES: NodeTypes = { ontology: OntologyNode };
const EDGE_TYPES: EdgeTypes = { ontology: OntologyEdge };

type OntologyValueIR = ValueTypeOf<typeof Ontology.Component.schema>;

function getOpt<T>(opt: { type: 'none'; value: null } | { type: 'some'; value: T }): T | undefined {
    return opt.type === 'some' ? opt.value : undefined;
}

/** Pick the smallest positive integer suffix not yet used by a link id of
 *  the form `l-<n>`. Falls back to timestamp if existing ids don't fit. */
function nextLinkId(existing: OntologyLinkValue[]): string {
    let max = 0;
    for (const l of existing) {
        const m = /^l-(\d+)$/.exec(l.id);
        if (m && m[1]) {
            const n = Number(m[1]);
            if (n > max) max = n;
        }
    }
    return `l-${max + 1}`;
}

export interface EastChakraOntologyProps {
    value: OntologyValueIR;
    storageKey: string;
}

interface OntologyMutationHandlers {
    updateNode(id: string, updates: { type?: OntologyNodeKind; name?: string; description?: string }): void;
    deleteNodes(ids: Set<string>): void;
    deleteLinks(ids: Set<string>): void;
    addLink(source: string, target: string): void;
    addNode(id: string, kind: OntologyNodeKind): void;
}

interface OntologyEditorBodyProps {
    ontology: OntologyValue;
    readonly: boolean;
    hideMiniMap: boolean;
    hideSearch: boolean;
    handlers: OntologyMutationHandlers;
}

function OntologyEditorBody({
    ontology, readonly, hideMiniMap, hideSearch, handlers,
}: OntologyEditorBodyProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    // Context-menu anchors (screen coords); null = closed.
    const [paneMenu, setPaneMenu] = useState<{ x: number; y: number } | null>(null);
    const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
    const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; edgeId: string } | null>(null);

    const flat = useMemo(() => flattenOntology(ontology), [ontology]);

    const mutations = useMemo(() => ({
        deleteNodes: (ids: Set<string>) => { if (!readonly) handlers.deleteNodes(ids); },
        deleteLinks: (ids: Set<string>) => { if (!readonly) handlers.deleteLinks(ids); },
    }), [readonly, handlers]);

    const onConnect = useCallback((conn: Connection) => {
        if (readonly || !conn.source || !conn.target) return;
        handlers.addLink(conn.source, conn.target);
    }, [readonly, handlers]);

    const { nodes: flowNodes, edges: flowEdges, onNodesChange, onEdgesChange, screenToFlowPosition, setNodePosition } =
        useFlowState({ flatNodes: flat.nodes, flatLinks: flat.links, mutations });

    const closeMenus = useCallback(() => {
        setPaneMenu(null);
        setNodeMenu(null);
        setEdgeMenu(null);
    }, []);

    const onPaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
        if (readonly) return;
        event.preventDefault();
        setNodeMenu(null);
        setEdgeMenu(null);
        setPaneMenu({ x: event.clientX, y: event.clientY });
    }, [readonly]);

    const onNodeContextMenu = useCallback((event: React.MouseEvent, node: FlowNode) => {
        if (readonly) return;
        event.preventDefault();
        setPaneMenu(null);
        setEdgeMenu(null);
        setNodeMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
    }, [readonly]);

    const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: { id: string }) => {
        if (readonly) return;
        event.preventDefault();
        setPaneMenu(null);
        setNodeMenu(null);
        setEdgeMenu({ x: event.clientX, y: event.clientY, edgeId: edge.id });
    }, [readonly]);

    const onAddNode = useCallback((kind: OntologyNodeKind) => {
        if (!paneMenu) return;
        const id = freshNodeId();
        setNodePosition(id, screenToFlowPosition({ x: paneMenu.x, y: paneMenu.y }));
        handlers.addNode(id, kind);
        setPaneMenu(null);
        setSelectedNodeId(id);
    }, [paneMenu, screenToFlowPosition, setNodePosition, handlers]);

    // Search match resolution.
    const searchMatchIds = useMemo<Set<string> | null>(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return null;
        const matched = new Set<string>();
        for (const n of flowNodes) {
            const data = n.data as OntologyFlowNodeData;
            if (
                data.name.toLowerCase().includes(q) ||
                data.type.toLowerCase().includes(q) ||
                (data.description && data.description.toLowerCase().includes(q))
            ) {
                matched.add(n.id);
            }
        }
        return matched;
    }, [flowNodes, searchQuery]);

    // Focus / dim derived nodes + edges (search wins over click focus).
    const displayNodes = useMemo(() => {
        const focusSet = searchMatchIds ?? (focusedNodeId ? new Set([focusedNodeId]) : null);
        if (!focusSet) return flowNodes;
        const connected = new Set<string>(focusSet);
        for (const e of flowEdges) {
            if (focusSet.has(e.source) || focusSet.has(e.target)) {
                connected.add(e.source);
                connected.add(e.target);
            }
        }
        return flowNodes.map(n => ({
            ...n,
            data: {
                ...n.data,
                attention: focusSet.has(n.id)
                    ? ('focused' as const)
                    : connected.has(n.id)
                        ? ('normal' as const)
                        : ('unfocused' as const),
            },
        }));
    }, [flowNodes, flowEdges, focusedNodeId, searchMatchIds]);

    const displayEdges = useMemo(() => {
        const focusSet = searchMatchIds ?? (focusedNodeId ? new Set([focusedNodeId]) : null);
        if (!focusSet) return flowEdges;
        return flowEdges.map(e => ({
            ...e,
            data: {
                ...e.data!,
                attention: (focusSet.has(e.source) || focusSet.has(e.target))
                    ? ('focused' as const)
                    : ('unfocused' as const),
            },
        }));
    }, [flowEdges, focusedNodeId, searchMatchIds]);

    const onNodeClick = useCallback((_: React.MouseEvent, node: FlowNode) => {
        setSearchQuery('');
        setFocusedNodeId(prev => prev === node.id ? null : node.id);
    }, []);

    const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: FlowNode) => {
        if (readonly) return;
        setSelectedNodeId(node.id);
    }, [readonly]);

    const onPaneClick = useCallback(() => {
        setFocusedNodeId(null);
        closeMenus();
    }, [closeMenus]);

    const proOptions = useMemo(() => ({ hideAttribution: true }), []);
    const miniMapNodeColor = useCallback((node: FlowNode) => {
        const data = node.data as OntologyFlowNodeData;
        const accent: Record<string, string> = {
            process:     '#3a7780',
            computation: '#42757d',
            decision:    '#2b4b55',
            objective:   '#253333',
            kpi:         '#2f7a5b',
            agent:       '#6d5a7a',
            data:        '#b8862d',
            resource:    '#56727a',
            policy:      '#8d7a5f',
            document:    '#bcd1d3',
            group:       '#4a5f5f',
        };
        return accent[data.type] ?? '#6b8080';
    }, []);

    const getNode = useCallback(
        (id: string): OntologyNodeValue | undefined => ontology.nodes.find(n => n.id === id),
        [ontology],
    );

    return (
        <>
            {!hideSearch && (
                <Box position="absolute" top="2" left="2" right="2" zIndex={10}>
                    <HStack gap="2">
                        <Box position="relative" flex="1">
                            <Box position="absolute" left="2" top="50%" transform="translateY(-50%)" color="fg.subtle" zIndex={1} pointerEvents="none">
                                <FiSearch size={14} />
                            </Box>
                            <Input
                                size="sm"
                                placeholder="Search nodes…"
                                value={searchQuery}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                    setSearchQuery(e.target.value);
                                    setFocusedNodeId(null);
                                }}
                                bg="bg.surface"
                                borderRadius="sm"
                                border="1px solid"
                                borderColor={searchMatchIds ? (searchMatchIds.size > 0 ? 'brand.solid' : 'ink.danger') : 'border.subtle'}
                                pl="8"
                                pr={searchQuery ? '8' : '3'}
                            />
                            {searchQuery && (
                                <Box
                                    position="absolute" right="2" top="50%" transform="translateY(-50%)"
                                    cursor="pointer" color="fg.subtle" zIndex={1}
                                    onClick={() => setSearchQuery('')}
                                    _hover={{ color: 'fg' }}
                                >
                                    <FiX size={14} />
                                </Box>
                            )}
                            {searchMatchIds && (
                                <Box position="absolute" right={searchQuery ? '8' : '2'} top="50%" transform="translateY(-50%)" zIndex={1} pointerEvents="none">
                                    <Text fontFamily="mono" fontSize="2xs" color={searchMatchIds.size > 0 ? 'brand.fg' : 'ink.danger'}>
                                        {searchMatchIds.size}
                                    </Text>
                                </Box>
                            )}
                        </Box>
                    </HStack>
                </Box>
            )}

            <Box h="100%" w="100%">
                <ReactFlow
                    nodes={displayNodes}
                    edges={displayEdges}
                    nodeTypes={NODE_TYPES}
                    edgeTypes={EDGE_TYPES}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeClick={onNodeClick}
                    onNodeDoubleClick={onNodeDoubleClick}
                    onPaneClick={onPaneClick}
                    onPaneContextMenu={onPaneContextMenu}
                    onNodeContextMenu={onNodeContextMenu}
                    onEdgeContextMenu={onEdgeContextMenu}
                    minZoom={0.1}
                    maxZoom={2}
                    proOptions={proOptions}
                    deleteKeyCode={null}
                    nodesDraggable={!readonly}
                    nodesConnectable={!readonly}
                    elementsSelectable
                    fitView
                >
                    {/* Dual line-grid per the schematic `.sch-canvas` spec:
                        minor 24px + major 120px lines in `rule` (gray.200) at
                        35% / 80% — gives the surface graph-paper texture so
                        white node cards read clearly against it (esp. over
                        video). */}
                    <Background id="ont-minor" variant={BackgroundVariant.Lines} gap={24} lineWidth={1} color="rgba(226, 232, 232, 0.35)" />
                    <Background id="ont-major" variant={BackgroundVariant.Lines} gap={120} lineWidth={1} color="rgba(226, 232, 232, 0.8)" />
                    <Controls />
                    {!hideMiniMap && <MiniMap nodeColor={miniMapNodeColor} maskColor="rgba(17, 27, 34, 0.10)" />}
                </ReactFlow>
            </Box>

            <NodePropertiesDrawer
                nodeId={selectedNodeId}
                getNode={getNode}
                onClose={() => setSelectedNodeId(null)}
                onUpdate={readonly ? null : handlers.updateNode}
                onDelete={readonly ? null : (id) => handlers.deleteNodes(new Set([id]))}
            />

            {/* Pane context menu — add a node of the chosen kind at the cursor. */}
            {paneMenu && (
                <Menu.Root
                    open
                    onOpenChange={(d) => { if (!d.open) setPaneMenu(null); }}
                    positioning={{ placement: 'bottom-start', getAnchorRect: () => ({ x: paneMenu.x, y: paneMenu.y, width: 0, height: 0 }) }}
                >
                    <Portal>
                        <Menu.Positioner>
                            <Menu.Content minW="180px">
                                <Menu.ItemGroup>
                                    <Menu.ItemGroupLabel
                                        fontFamily="mono" fontSize="2xs" fontWeight="bold"
                                        letterSpacing="widest" textTransform="uppercase" color="fg.subtle"
                                    >
                                        Add node
                                    </Menu.ItemGroupLabel>
                                    {ALL_NODE_KINDS.map(kind => (
                                        <Menu.Item key={kind} value={kind} onClick={() => onAddNode(kind)}>
                                            <HStack gap="2">
                                                <Box w="8px" h="8px" borderRadius="full" bg={NODE_KIND_ACCENT[kind]} flexShrink={0} />
                                                <Text fontSize="sm" textTransform="capitalize">{kind}</Text>
                                            </HStack>
                                        </Menu.Item>
                                    ))}
                                </Menu.ItemGroup>
                            </Menu.Content>
                        </Menu.Positioner>
                    </Portal>
                </Menu.Root>
            )}

            {/* Node context menu — edit properties or delete. */}
            {nodeMenu && (
                <Menu.Root
                    open
                    onOpenChange={(d) => { if (!d.open) setNodeMenu(null); }}
                    positioning={{ placement: 'bottom-start', getAnchorRect: () => ({ x: nodeMenu.x, y: nodeMenu.y, width: 0, height: 0 }) }}
                >
                    <Portal>
                        <Menu.Positioner>
                            <Menu.Content minW="180px">
                                <Menu.Item value="edit" onClick={() => { setSelectedNodeId(nodeMenu.nodeId); setNodeMenu(null); }}>
                                    Edit properties
                                </Menu.Item>
                                <Menu.Separator />
                                <Menu.Item
                                    value="delete"
                                    color="ink.danger"
                                    onClick={() => { handlers.deleteNodes(new Set([nodeMenu.nodeId])); setNodeMenu(null); }}
                                >
                                    Delete node
                                </Menu.Item>
                            </Menu.Content>
                        </Menu.Positioner>
                    </Portal>
                </Menu.Root>
            )}

            {/* Edge context menu — delete link. */}
            {edgeMenu && (
                <Menu.Root
                    open
                    onOpenChange={(d) => { if (!d.open) setEdgeMenu(null); }}
                    positioning={{ placement: 'bottom-start', getAnchorRect: () => ({ x: edgeMenu.x, y: edgeMenu.y, width: 0, height: 0 }) }}
                >
                    <Portal>
                        <Menu.Positioner>
                            <Menu.Content minW="160px">
                                <Menu.Item
                                    value="delete"
                                    color="ink.danger"
                                    onClick={() => { handlers.deleteLinks(new Set([edgeMenu.edgeId])); setEdgeMenu(null); }}
                                >
                                    Delete link
                                </Menu.Item>
                            </Menu.Content>
                        </Menu.Positioner>
                    </Portal>
                </Menu.Root>
            )}
        </>
    );
}

const EastChakraOntology = memo(function EastChakraOntology({ value }: EastChakraOntologyProps) {
    const binding = value.binding as ValueTypeOf<typeof Ontology.Component.schema>['binding'];
    // The editor mutates the binding directly (direct mode writes through;
    // staged mode buffers for a paired Diff to review/commit). It has no
    // commit affordance of its own, so `commit`/`discard` aren't consumed
    // here — `pending` is surfaced as a header hint only.
    const { ontology, pending, mutate } = useBindingOntology(binding);
    const readonly = getOpt(value.readonly) ?? false;
    const hideMiniMap = getOpt(value.hideMiniMap) ?? false;
    const hideSearch = getOpt(value.hideSearch) ?? false;
    const defaultView = getOpt(value.defaultView)?.type ?? 'graph';
    const [view, setView] = useState<'graph' | 'table'>(defaultView);
    // Node selected from the table view — opens the shared properties drawer.
    const [tableSelectedId, setTableSelectedId] = useState<string | null>(null);

    const handlers = useMemo<OntologyMutationHandlers>(() => {
        const transform = (fn: (curr: OntologyValue) => OntologyValue) => {
            if (!ontology) return;
            mutate(fn(ontology));
        };

        return {
            updateNode: (id, updates) => transform(curr => {
                const ntMap = new Map(curr.nodes.map(n => [n.id, n.type.type]));
                if (updates.type) ntMap.set(id, updates.type);
                const nextNodes: OntologyNodeValue[] = curr.nodes.map(n => {
                    if (n.id !== id) return n;
                    const desc = updates.description !== undefined
                        ? (updates.description === '' ? none : some(updates.description))
                        : n.description;
                    return {
                        ...n,
                        name: updates.name ?? n.name,
                        description: desc,
                        type: updates.type ? variant(updates.type, null) : n.type,
                    };
                });
                // If a node's kind changed, drop links whose new endpoint
                // combination has no valid relation (matches the webview's
                // `reconcileLinks` semantics).
                const nextLinks: OntologyLinkValue[] = curr.links.flatMap(link => {
                    if (link.source !== id && link.target !== id) return [link];
                    const valid = ValidLinks[ntMap.get(link.source)!]?.[ntMap.get(link.target)!];
                    if (!valid) return [];
                    return [link];
                });
                return { ...curr, nodes: nextNodes, links: nextLinks };
            }),

            deleteNodes: (ids) => transform(curr => ({
                ...curr,
                nodes: curr.nodes.filter(n => !ids.has(n.id)),
                links: curr.links.filter(l => !ids.has(l.source) && !ids.has(l.target)),
            })),

            deleteLinks: (ids) => transform(curr => ({
                ...curr,
                links: curr.links.filter(l => !ids.has(l.id)),
            })),

            addLink: (source, target) => transform(curr => {
                const srcKind = curr.nodes.find(n => n.id === source)?.type.type;
                const tgtKind = curr.nodes.find(n => n.id === target)?.type.type;
                if (!srcKind || !tgtKind) return curr;
                const linkKind = ValidLinks[srcKind][tgtKind];
                if (!linkKind) return curr;
                const newLink: OntologyLinkValue = {
                    id: nextLinkId(curr.links),
                    source,
                    target,
                    type: variant(linkKind, null),
                };
                return { ...curr, links: [...curr.links, newLink] };
            }),

            addNode: (id, kind) => transform(curr => {
                const newNode: OntologyNodeValue = {
                    id,
                    name: `New ${kind}`,
                    description: none,
                    type: variant(kind, null),
                };
                return { ...curr, nodes: [...curr.nodes, newNode] };
            }),
        };
    }, [ontology, mutate]);

    if (!ontology) {
        return (
            <Box
                bg="bg.surface" border="1px solid" borderColor="border.subtle" borderRadius="lg"
                p="9" textAlign="center"
            >
                <Text fontFamily="mono" fontSize="md" color="fg.subtle">
                    Loading ontology…
                </Text>
            </Box>
        );
    }

    const nodeCount = ontology.nodes.length;
    const linkCount = ontology.links.length;
    const getNode = (id: string): OntologyNodeValue | undefined => ontology.nodes.find(n => n.id === id);

    return (
        <Box
            bg="bg.surface"
            border="1px solid"
            borderColor="border.subtle"
            borderRadius="lg"
            overflow="hidden"
            display="flex"
            flexDirection="column"
            h="600px"
            fontFeatureSettings='"tnum"'
        >
            {/* xyflow base stylesheet, injected via emotion (deduped by content)
                so the graph renders wherever the component is mounted. */}
            <Global styles={xyflowCss} />
            {/* eyebrow header */}
            <HStack
                px="4" py="3"
                borderBottom="1px solid" borderColor="border.subtle"
                bg="bg.panel"
                justify="space-between"
            >
                <HStack gap="3">
                    <Text fontFamily="mono" fontSize="xs" fontWeight="semibold" letterSpacing="widest" textTransform="uppercase" color="fg">
                        Ontology
                    </Text>
                    <Text fontFamily="mono" fontSize="2xs" letterSpacing="wider" color="fg.muted">
                        {nodeCount} NODES · {linkCount} LINKS
                    </Text>
                </HStack>
                <HStack gap="3">
                    {pending && (
                        <Text fontFamily="mono" fontSize="2xs" letterSpacing="wider" textTransform="uppercase" color="ink.warning">
                            Unsaved changes
                        </Text>
                    )}
                    {/* Graph | Table — both are projections of the same bound
                        value; the staged buffer and commit machinery are
                        view-agnostic. */}
                    <SegmentGroup.Root
                        size="xs"
                        value={view}
                        onValueChange={(e: { value: string | null }) => {
                            if (e.value === 'graph' || e.value === 'table') setView(e.value);
                        }}
                    >
                        <SegmentGroup.Indicator />
                        <SegmentGroup.Item value="graph">
                            <SegmentGroup.ItemText>
                                <HStack gap="1.5"><FiShare2 size={11} /> Graph</HStack>
                            </SegmentGroup.ItemText>
                            <SegmentGroup.ItemHiddenInput />
                        </SegmentGroup.Item>
                        <SegmentGroup.Item value="table">
                            <SegmentGroup.ItemText>
                                <HStack gap="1.5"><FiList size={11} /> Table</HStack>
                            </SegmentGroup.ItemText>
                            <SegmentGroup.ItemHiddenInput />
                        </SegmentGroup.Item>
                    </SegmentGroup.Root>
                </HStack>
            </HStack>

            {/* body — graph canvas or process table */}
            <Box flex="1" position="relative" bg="bg.panel" minH="0">
                {view === 'graph' ? (
                    <ReactFlowProvider>
                        <OntologyEditorBody
                            ontology={ontology}
                            readonly={readonly}
                            hideMiniMap={hideMiniMap}
                            hideSearch={hideSearch}
                            handlers={handlers}
                        />
                    </ReactFlowProvider>
                ) : (
                    <>
                        <OntologyTable ontology={ontology} onSelectNode={setTableSelectedId} />
                        <NodePropertiesDrawer
                            nodeId={tableSelectedId}
                            getNode={getNode}
                            onClose={() => setTableSelectedId(null)}
                            onUpdate={readonly ? null : handlers.updateNode}
                            onDelete={readonly ? null : (id) => { handlers.deleteNodes(new Set([id])); setTableSelectedId(null); }}
                        />
                    </>
                )}
            </Box>
        </Box>
    );
});

implementUIComponent(Ontology.Component, EastChakraOntology);

export { EastChakraOntology };
