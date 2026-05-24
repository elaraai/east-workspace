/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `useFlowState` — ReactFlow controller for the ontology editor.
 *
 * Ported from the east-ontology webview but decoupled from
 * `OntologyContext` — the ontology + flatten result + mutation callbacks
 * are injected by the parent (the renderer in `index.tsx`).
 *
 * Phase 2: read-only (no mutation surfaces are wired here yet; the
 * `onConnect` / `onNodesChange` removals just fire the injected callbacks
 * which the read-only renderer keeps as no-ops).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    applyNodeChanges,
    applyEdgeChanges,
    useReactFlow,
    type Node as FlowNode,
    type Edge as FlowEdge,
    type NodeChange,
    type EdgeChange,
} from '@xyflow/react';
import { calculateLayout } from './layout.js';
import type { FlatLink, FlatNode } from './types.js';
import type { OntologyFlowNodeData } from './OntologyNode.js';
import type { OntologyFlowEdgeData } from './OntologyEdge.js';

/**
 * Mutation callbacks the parent renderer injects. In read-only mode the
 * parent passes no-ops; in editable mode each callback re-derives the
 * next-ontology and writes it back through `binding.write` via
 * `useBindingOntology`'s `mutate`.
 */
export interface OntologyMutations {
    deleteNodes(ids: Set<string>): void;
    deleteLinks(ids: Set<string>): void;
}

export interface UseFlowStateArgs {
    flatNodes: FlatNode[];
    flatLinks: FlatLink[];
    mutations: OntologyMutations;
}

interface GetBestHandlesResult {
    sourceHandle: string;
    targetHandle: string;
}

function getBestHandles(
    sourcePos: { x: number; y: number },
    targetPos: { x: number; y: number },
): GetBestHandlesResult {
    const dx = targetPos.x - sourcePos.x;
    const dy = targetPos.y - sourcePos.y;
    if (Math.abs(dx) > Math.abs(dy)) {
        return dx > 0
            ? { sourceHandle: 'right',  targetHandle: 'left-target' }
            : { sourceHandle: 'left',   targetHandle: 'right-target' };
    }
    return dy > 0
        ? { sourceHandle: 'bottom', targetHandle: 'top-target' }
        : { sourceHandle: 'top',    targetHandle: 'bottom-target' };
}

function buildFlowNodes(
    flatNodes: FlatNode[],
    positions: Map<string, { x: number; y: number }>,
): FlowNode<OntologyFlowNodeData>[] {
    return flatNodes.map(n => ({
        id: n.id,
        type: 'ontology' as const,
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        data: {
            name: n.name,
            description: n.description,
            type: n.nodeType,
            attention: 'normal' as const,
        },
    }));
}

function buildFlowEdges(
    flatLinks: FlatLink[],
    positions: Map<string, { x: number; y: number }>,
): FlowEdge<OntologyFlowEdgeData>[] {
    return flatLinks.map(l => {
        const sp = positions.get(l.source) ?? { x: 0, y: 0 };
        const tp = positions.get(l.target) ?? { x: 0, y: 0 };
        const handles = getBestHandles(sp, tp);
        return {
            id: l.id,
            source: l.source,
            target: l.target,
            sourceHandle: handles.sourceHandle,
            targetHandle: handles.targetHandle,
            type: 'ontology' as const,
            data: {
                type: l.linkType,
                label: l.linkType.replace(/_/g, ' '),
                attention: 'normal' as const,
            },
        };
    });
}

export function useFlowState({ flatNodes, flatLinks, mutations }: UseFlowStateArgs) {
    const { screenToFlowPosition } = useReactFlow();

    // Initial positions — computed once per mount; tracked imperatively after.
    const [initialPositions] = useState(() => {
        const { positions } = calculateLayout(flatNodes, flatLinks);
        return positions;
    });
    const positionsRef = useRef<Map<string, { x: number; y: number }>>(initialPositions);

    // Seed a position for a not-yet-rendered node id (used by "add node" so
    // the new node lands where the user clicked, before the binding refetch
    // rebuilds the flow nodes).
    const setNodePosition = useCallback((id: string, pos: { x: number; y: number }) => {
        positionsRef.current.set(id, pos);
    }, []);

    const [nodes, setNodes] = useState<FlowNode<OntologyFlowNodeData>[]>(
        () => buildFlowNodes(flatNodes, initialPositions),
    );
    const [edges, setEdges] = useState<FlowEdge<OntologyFlowEdgeData>[]>(
        () => buildFlowEdges(flatLinks, initialPositions),
    );

    // Sync from binding refetch → local state. Preserves positions from
    // drags; new nodes get (0,0) until the next layout pass.
    const prevFlatNodesRef = useRef(flatNodes);
    const prevFlatLinksRef = useRef(flatLinks);
    useEffect(() => {
        const nodesChanged = prevFlatNodesRef.current !== flatNodes;
        const linksChanged = prevFlatLinksRef.current !== flatLinks;
        if (!nodesChanged && !linksChanged) return;

        prevFlatNodesRef.current = flatNodes;
        prevFlatLinksRef.current = flatLinks;

        for (const n of flatNodes) {
            if (!positionsRef.current.has(n.id)) {
                positionsRef.current.set(n.id, { x: 0, y: 0 });
            }
        }
        if (nodesChanged) setNodes(buildFlowNodes(flatNodes, positionsRef.current));
        if (linksChanged) setEdges(buildFlowEdges(flatLinks, positionsRef.current));
    }, [flatNodes, flatLinks]);

    const onNodesChange = useCallback((changes: NodeChange[]) => {
        const removed = new Set(changes.filter(c => c.type === 'remove').map(c => c.id));
        if (removed.size > 0) {
            mutations.deleteNodes(removed);
            return;
        }
        let hasPositionChanges = false;
        for (const c of changes) {
            if (c.type === 'position' && c.position) {
                positionsRef.current.set(c.id, c.position);
                hasPositionChanges = true;
            }
        }
        setNodes(nds => applyNodeChanges(changes, nds) as FlowNode<OntologyFlowNodeData>[]);
        if (hasPositionChanges) {
            setEdges(prev => prev.map(e => {
                const sp = positionsRef.current.get(e.source) ?? { x: 0, y: 0 };
                const tp = positionsRef.current.get(e.target) ?? { x: 0, y: 0 };
                const handles = getBestHandles(sp, tp);
                if (e.sourceHandle === handles.sourceHandle && e.targetHandle === handles.targetHandle) return e;
                return { ...e, sourceHandle: handles.sourceHandle, targetHandle: handles.targetHandle };
            }));
        }
    }, [mutations]);

    const onEdgesChange = useCallback((changes: EdgeChange[]) => {
        const removed = new Set(changes.filter(c => c.type === 'remove').map(c => c.id));
        if (removed.size > 0) {
            mutations.deleteLinks(removed);
            return;
        }
        setEdges(eds => applyEdgeChanges(changes, eds) as FlowEdge<OntologyFlowEdgeData>[]);
    }, [mutations]);

    return useMemo(
        () => ({ nodes, edges, onNodesChange, onEdgesChange, screenToFlowPosition, setNodePosition }),
        [nodes, edges, onNodesChange, onEdgesChange, screenToFlowPosition, setNodePosition],
    );
}
