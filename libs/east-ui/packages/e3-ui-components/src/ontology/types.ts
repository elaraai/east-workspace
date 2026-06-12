/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Renderer-side aliases derived from the East `OntologyType` so the
 * renderer tracks any structural change to the source-of-truth type as a
 * compile error — adding a tag to `NodeKindType` / `LinkKindType` or a
 * field to a struct shows up here, not as a silent runtime drift.
 *
 * The flattened representation (`FlatNode` / `FlatLink`) strips the
 * `OptionType` / `VariantType` wrappers down to plain strings so the
 * React components can read them without ceremony.
 *
 * @packageDocumentation
 */

import type { ValueTypeOf } from '@elaraai/east';
import {
    NodeKindType as EastNodeKindType,
    LinkKindType as EastLinkKindType,
    OntologyType as EastOntologyType,
} from '@elaraai/e3-ui/internal';

/** JS string-union of every `NodeKindType` variant tag. */
export type OntologyNodeKind = ValueTypeOf<typeof EastNodeKindType>['type'];

/** JS string-union of every `LinkKindType` variant tag. */
export type OntologyLinkKind = ValueTypeOf<typeof EastLinkKindType>['type'];

/** JS-side shape of an `OntologyType` node carrier. */
export type OntologyNode = ValueTypeOf<typeof EastOntologyType>['nodes'][number];

/** JS-side shape of an `OntologyType` link carrier. */
export type OntologyLink = ValueTypeOf<typeof EastOntologyType>['links'][number];

/** JS-side shape of an `OntologyType` value. */
export type Ontology = ValueTypeOf<typeof EastOntologyType>;

/** Flattened node — variant wrappers stripped to plain strings for the
 *  layout + ReactFlow render path. `description` is `string | undefined`
 *  (not optional) because `exactOptionalPropertyTypes` in tsconfig forbids
 *  assigning `undefined` to an optional property. */
export interface FlatNode {
    id: string;
    name: string;
    description: string | undefined;
    nodeType: OntologyNodeKind;
}

/** Flattened link — kind unwrapped to a plain string. */
export interface FlatLink {
    id: string;
    source: string;
    target: string;
    linkType: OntologyLinkKind;
}

/** Strip the variant wrappers off an ontology value for layout / render.
 *  Orphan links (source or target missing from the node set) are dropped. */
export function flattenOntology(ontology: Ontology): { nodes: FlatNode[]; links: FlatLink[] } {
    const nodes: FlatNode[] = ontology.nodes.map(n => ({
        id: n.id,
        name: n.name,
        description: n.description.type === 'some' ? n.description.value : undefined,
        nodeType: n.type.type,
    }));
    const nodeIds = new Set(nodes.map(n => n.id));
    const links: FlatLink[] = ontology.links
        .filter(l => nodeIds.has(l.source) && nodeIds.has(l.target))
        .map(l => ({
            id: l.id,
            source: l.source,
            target: l.target,
            linkType: l.type.type,
        }));
    return { nodes, links };
}

/**
 * Default link kind for a `source → target` node-kind pair, or `null` if
 * no conventional relation exists. Typed as
 * `Record<OntologyNodeKind, Record<OntologyNodeKind, OntologyLinkKind | null>>`
 * — if `NodeKindType` or `LinkKindType` gains a tag, TS flags the missing
 * entries here.
 */
export const ValidLinks: Record<OntologyNodeKind, Record<OntologyNodeKind, OntologyLinkKind | null>> = {
    objective:   { objective: 'drives',   kpi: 'defines',  decision: 'informs', process: 'drives',    resource: 'drives',     agent: 'informs',  data: 'gets_data_from',    policy: 'informs',  document: 'references', computation: 'informs',  group: null },
    kpi:         { objective: 'measures', kpi: 'results_in', decision: 'informs', process: 'measures', resource: 'measures',  agent: 'measures', data: 'gets_data_from',    policy: null,       document: 'references', computation: 'gets_data_from', group: null },
    decision:    { objective: 'drives',   kpi: 'drives',   decision: 'informs', process: 'drives',    resource: 'drives',     agent: 'informs',  data: 'inserts_data_into', policy: 'executes', document: 'references', computation: 'uses',     group: null },
    process:     { objective: 'drives',   kpi: 'results_in', decision: 'informs', process: 'executes', resource: 'produces',  agent: 'uses',     data: 'inserts_data_into', policy: 'executes', document: 'references', computation: 'uses',     group: null },
    resource:    { objective: 'drives',   kpi: 'results_in', decision: 'informs', process: 'used_by',  resource: null,        agent: 'used_by',  data: 'inserts_data_into', policy: null,       document: 'references', computation: 'uses',     group: null },
    agent:       { objective: 'drives',   kpi: 'drives',   decision: 'executes', process: 'executes', resource: 'uses',       agent: 'informs',  data: 'inserts_data_into', policy: 'executes', document: 'references', computation: 'uses',     group: null },
    data:        { objective: 'informs',  kpi: 'informs',  decision: 'informs', process: 'informs',   resource: 'informs',    agent: 'informs',  data: 'gets_data_from',    policy: 'validates',document: 'references', computation: 'informs',  group: null },
    policy:      { objective: 'drives',   kpi: 'defines',  decision: 'constrains', process: 'constrains', resource: 'constrains', agent: 'constrains', data: 'constrains',  policy: 'informs',  document: 'references', computation: 'constrains', group: null },
    document:    { objective: 'defines',  kpi: 'defines',  decision: 'informs', process: 'defines',   resource: 'defines',    agent: 'defines',  data: 'defines',           policy: 'defines',  document: 'references', computation: 'defines',  group: 'defines' },
    computation: { objective: 'measures', kpi: 'produces', decision: 'informs', process: 'simulates', resource: 'simulates',  agent: 'informs',  data: 'produces',          policy: 'validates',document: 'references', computation: 'uses',     group: null },
    group:       { objective: 'contains', kpi: 'contains', decision: 'contains', process: 'contains',  resource: 'contains',  agent: 'contains', data: 'contains',          policy: 'contains', document: 'contains',   computation: 'contains', group: 'contains' },
};

/** All node kinds in display order. */
export const ALL_NODE_KINDS: OntologyNodeKind[] = [
    'objective', 'kpi', 'decision', 'process', 'resource', 'agent',
    'data', 'policy', 'document', 'computation', 'group',
];
