/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Ontology-specific accent maps — the per-kind colour and per-link-kind
 * stroke dash pattern that the renderer can't get from the shared Chakra
 * theme alone.
 *
 * Colour values reference the shared brand / gray / status palette so they
 * track theme changes. Edge dash patterns are SVG `stroke-dasharray`
 * strings (not colours) so they don't belong in the theme.
 *
 * Both maps are typed as `Record<OntologyXxxKind, ...>` — if the East
 * `NodeKindType` / `LinkKindType` gains a tag, TypeScript flags the
 * missing entry here as a compile error.
 *
 * @packageDocumentation
 */

import type { OntologyNodeKind, OntologyLinkKind } from './types.js';

/**
 * Per-kind 2px top-stripe colour, applied to the node card. Card body
 * stays neutral `paper / ink` regardless of kind.
 *
 * Values are literal hex anchored to the shared brand / gray / status
 * palette (`#3a7780` = `brand.600`, `#2f7a5b` = `status.pos`, etc.). Mixed
 * tones for `computation` / `resource` / `policy` / `document` use
 * `color-mix` math against those same anchors (precomputed because Chakra
 * tokens don't natively express `color-mix`).
 */
export const NODE_KIND_ACCENT: Record<OntologyNodeKind, string> = {
    process:     '#3a7780', // brand.600
    computation: '#42757d', // color-mix(brand.600 60%, gray.500)
    decision:    '#2b4b55', // brand.700
    objective:   '#253333', // gray.800
    kpi:         '#2f7a5b', // status.pos
    data:        '#b8862d', // status.warn
    resource:    '#56727a', // color-mix(brand.600 30%, gray.500)
    policy:      '#8d7a5f', // color-mix(status.warn 50%, gray.600)
    document:    '#bcd1d3', // color-mix(brand.600 30%, gray.100)
    group:       '#4a5f5f', // gray.600
};

/**
 * Per-link-kind stroke dash pattern. Empty string `'none'` (CSS-friendly)
 * → solid line. Patterns mirror the schematic vocabulary
 * (flow / signal / dependency / constraint / simulation) in
 * `east-ui-showcase/dist-design/configure__pattern__schematic.html`.
 */
export const EDGE_DASH: Record<OntologyLinkKind, string> = {
    // flow — solid
    uses:              'none',
    executes:          'none',
    produces:          'none',
    used_by:           'none',
    drives:            'none',
    contains:          'none',
    results_in:        'none',
    // signal
    informs:           '4,4',
    measures:          '4,4',
    // dependency
    gets_data_from:    '1.5,4',
    inserts_data_into: '1.5,4',
    references:        '1.5,4',
    // constraint
    constrains:        '8,4',
    validates:         '8,4',
    defines:           '8,4',
    // simulation
    simulates:         '10,2,2,2',
};
