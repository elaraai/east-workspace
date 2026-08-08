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
 * Values are theme tokens, or `color-mix()` over theme tokens for the
 * blended kinds — so they follow colour-mode changes. Mixed
 * tones for `computation` / `resource` / `policy` / `document` use
 * `color-mix` math against those same anchors (precomputed because Chakra
 * tokens don't natively express `color-mix`).
 */
export const NODE_KIND_ACCENT: Record<OntologyNodeKind, string> = {
    process:     'brand.600',
    computation: 'color-mix(in srgb, var(--chakra-colors-brand-600) 60%, var(--chakra-colors-gray-500))',
    decision:    'brand.700',
    objective:   'gray.800',
    kpi:         'status.pos',
    agent:       'color-mix(in srgb, var(--chakra-colors-brand-700) 45%, color-mix(in srgb, var(--chakra-colors-status-warn) 15%, var(--chakra-colors-gray-500)))', // plum — people/role tone
    data:        'status.warn',
    resource:    'color-mix(in srgb, var(--chakra-colors-brand-600) 30%, var(--chakra-colors-gray-500))',
    policy:      'color-mix(in srgb, var(--chakra-colors-status-warn) 50%, var(--chakra-colors-gray-600))',
    document:    'color-mix(in srgb, var(--chakra-colors-brand-600) 30%, var(--chakra-colors-gray-100))',
    group:       'gray.600',
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
