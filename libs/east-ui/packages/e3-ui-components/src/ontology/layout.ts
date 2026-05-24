/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Force-directed layout for the ontology graph, ported from the
 * east-ontology webview. Picks between cose-bilkent / grid based on node /
 * link / group counts, then runs a post-pass to separate rectangular nodes
 * that ended up overlapping.
 *
 * @packageDocumentation
 */

import cytoscape from 'cytoscape';
// @ts-expect-error no type declarations available
import coseBilkent from 'cytoscape-cose-bilkent';
import type { FlatNode, FlatLink } from './types.js';

cytoscape.use(coseBilkent);

export interface LayoutResult {
    positions: Map<string, { x: number; y: number }>;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

function getCoseBilkentOptions(nodeCount: number): cytoscape.LayoutOptions {
    const baseSpacing = Math.max(300, nodeCount * 3);
    const iterations = Math.max(2500, Math.min(5000, nodeCount * 40));
    return {
        name: 'cose-bilkent',
        nodeRepulsion: baseSpacing * 12,
        idealEdgeLength: baseSpacing,
        edgeElasticity: 0.35,
        nestingFactor: 0.1,
        gravity: 0.08,
        numIter: iterations,
        tile: true,
        tilingPaddingVertical: 30,
        tilingPaddingHorizontal: 30,
        quality: 'default',
        randomize: false,
        convergenceThreshold: 0.01,
        animate: false,
        fit: true,
        padding: 50,
    } as cytoscape.LayoutOptions;
}

function getConstrainedForceOptions(): cytoscape.LayoutOptions {
    return {
        name: 'cose-bilkent',
        randomize: false,
        nodeRepulsion: 15000,
        idealEdgeLength: 200,
        edgeElasticity: 0.3,
        gravity: 0.15,
        gravityRange: 2.5,
        nestingFactor: 0.2,
        numIter: 3000,
        initialTemp: 1000,
        coolingFactor: 0.95,
        minTemp: 1.0,
        tile: true,
        tilingPaddingVertical: 40,
        tilingPaddingHorizontal: 40,
        animate: false,
        fit: true,
        padding: 50,
    } as cytoscape.LayoutOptions;
}

function getCompoundOptions(): cytoscape.LayoutOptions {
    return {
        name: 'cose-bilkent',
        nestingFactor: 0.5,
        gravity: 0.2,
        gravityCompound: 1.5,
        gravityRange: 3.0,
        nodeRepulsion: 8000,
        idealEdgeLength: 160,
        edgeElasticity: 0.3,
        initialTemp: 300,
        coolingFactor: 0.92,
        minTemp: 1.0,
        numIter: 3500,
        tile: true,
        tilingPaddingVertical: 50,
        tilingPaddingHorizontal: 50,
        animate: false,
        fit: true,
        padding: 50,
    } as cytoscape.LayoutOptions;
}

function getGridOptions(nodeCount: number): cytoscape.LayoutOptions {
    const gridSize = Math.ceil(Math.sqrt(nodeCount));
    return {
        name: 'grid',
        rows: gridSize,
        cols: gridSize,
        spacingFactor: 2.5,
        avoidOverlap: true,
        avoidOverlapPadding: 50,
        condense: false,
        animate: false,
        fit: true,
        padding: 50,
    } as cytoscape.LayoutOptions;
}

function selectLayout(nodes: FlatNode[], links: FlatLink[]): cytoscape.LayoutOptions {
    const nodeCount = nodes.length;
    const groupCount = nodes.filter(n => n.nodeType === 'group').length;
    const linkCount = links.length;
    if (nodeCount < 15) return getCoseBilkentOptions(nodeCount);
    if (linkCount > nodeCount * 1.8) return getConstrainedForceOptions();
    if (groupCount > 2) return getCompoundOptions();
    return getCoseBilkentOptions(nodeCount);
}

export function calculateLayout(nodes: FlatNode[], links: FlatLink[]): LayoutResult {
    const positions = new Map<string, { x: number; y: number }>();
    if (nodes.length === 0) return { positions };

    const cy = cytoscape({
        headless: true,
        styleEnabled: true,
        elements: {
            nodes: nodes.map(n => ({
                data: {
                    id: n.id,
                    width: NODE_WIDTH,
                    height: NODE_HEIGHT,
                    type: n.nodeType,
                    isGroup: n.nodeType === 'group',
                },
            })),
            edges: links.map(l => ({
                data: { id: l.id, source: l.source, target: l.target, type: l.linkType },
            })),
        },
        style: [
            {
                selector: 'node',
                style: {
                    width: NODE_WIDTH,
                    height: NODE_HEIGHT,
                    shape: 'rectangle' as const,
                },
            },
        ],
    });

    let layoutSucceeded = false;
    try {
        const layout = cy.layout(selectLayout(nodes, links));
        layout.run();
        layoutSucceeded = true;
    } catch {
        layoutSucceeded = false;
    }

    if (layoutSucceeded) {
        let allAtOrigin = true;
        cy.nodes().forEach(node => {
            const pos = node.position();
            if (pos.x !== 0 || pos.y !== 0) allAtOrigin = false;
        });
        if (allAtOrigin) layoutSucceeded = false;
    }

    if (!layoutSucceeded) {
        try {
            cy.layout(getGridOptions(nodes.length)).run();
        } catch {
            // best-effort — fall through with whatever positions we have
        }
    }

    const rawPositions: { id: string; x: number; y: number }[] = [];
    cy.nodes().forEach(node => {
        const pos = node.position();
        rawPositions.push({ id: node.id(), x: pos.x, y: pos.y });
    });
    cy.destroy();

    separateOverlappingNodes(rawPositions);

    for (const p of rawPositions) {
        positions.set(p.id, { x: p.x, y: p.y });
    }
    return { positions };
}

const MIN_SPACING = 60;

function separateOverlappingNodes(nodes: { id: string; x: number; y: number }[]) {
    const maxIterations = 500;
    const requiredW = NODE_WIDTH + MIN_SPACING;
    const requiredH = NODE_HEIGHT + MIN_SPACING;
    for (let iter = 0; iter < maxIterations; iter++) {
        let hasOverlap = false;
        const damping = Math.max(0.3, 0.8 - iter * 0.001);
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i]!;
                const b = nodes[j]!;
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const absDx = Math.abs(dx);
                const absDy = Math.abs(dy);
                if (absDx >= requiredW || absDy >= requiredH) continue;
                hasOverlap = true;
                const overlapX = requiredW - absDx;
                const overlapY = requiredH - absDy;
                let fx: number;
                let fy: number;
                if (absDx === 0 && absDy === 0) {
                    const angle = Math.random() * Math.PI * 2;
                    fx = Math.cos(angle) * requiredW;
                    fy = Math.sin(angle) * requiredH;
                } else if (overlapX < overlapY) {
                    fx = Math.sign(dx) * overlapX * 0.6;
                    fy = Math.sign(dy || 1) * overlapY * 0.15;
                } else {
                    fx = Math.sign(dx || 1) * overlapX * 0.15;
                    fy = Math.sign(dy) * overlapY * 0.6;
                }
                a.x += fx * damping;
                a.y += fy * damping;
                b.x -= fx * damping;
                b.y -= fy * damping;
            }
        }
        if (!hasOverlap) return;
    }
}
