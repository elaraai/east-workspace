/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Ontology component — graph editor for an `OntologyType`-bound dataset.
 *
 * @remarks
 * The Ontology card surfaces a ReactFlow-driven node/link graph editor over
 * the value of a single {@link Data.bind} binding whose source dataset is
 * typed as {@link OntologyType}. Mutations (add / delete / reconnect /
 * update node) write the whole next-ontology back through `binding.write`,
 * so the same staged-buffer + commit / discard / merge machinery that
 * powers `Diff` is reused unchanged.
 *
 * Declared via the `EastUI.component` extension API — the React renderer
 * lives in `@elaraai/e3-ui-components` and is wired via
 * `implementUIComponent(OntologyComponent, EastChakraOntology)` at module
 * load time.
 *
 * @packageDocumentation
 */

import {
    East,
    NullType,
    StringType,
    DateTimeType,
    BooleanType,
    ArrayType,
    StructType,
    VariantType,
    OptionType,
    FunctionType,
    none,
    some,
    variant,
    type ExprType,
    type SubtypeExprOrValue,
} from '@elaraai/east';
import { EastUI, DensityType, type DensityLiteral, type UIComponentType } from '@elaraai/east-ui';

import { DiffBindingType, type BoundValue } from '../bind/data.js';

// ============================================================================
// Ontology value schema — nodes, links, metadata.
// ============================================================================

/**
 * Discriminator for the kind of business element a node represents.
 *
 * @property process - A unit of execution / activity.
 * @property resource - A consumable or capacity tracked by the business.
 * @property kpi - A measurable indicator.
 * @property decision - A point at which the business chooses among options.
 * @property agent - A person, team, or system role that executes processes
 *   and owns decisions (REA's third leg: resources, events, agents).
 * @property data - A dataset or signal flowing through the business.
 * @property objective - A strategic goal the business pursues.
 * @property policy - A rule constraining other elements.
 * @property document - Reference material — a procedure, contract, spec.
 * @property computation - A derived quantity / model output.
 * @property group - A visual container for related nodes (no semantics).
 */
export const NodeKindType = VariantType({
    process: NullType,
    resource: NullType,
    kpi: NullType,
    decision: NullType,
    agent: NullType,
    data: NullType,
    objective: NullType,
    policy: NullType,
    document: NullType,
    computation: NullType,
    group: NullType,
});
/** Type alias for {@link NodeKindType}. */
export type NodeKindType = typeof NodeKindType;

/**
 * Discriminator for the relationship semantics between two nodes.
 *
 * @property uses - Source uses target as input.
 * @property produces - Source produces target as output.
 * @property results_in - Source's outcome culminates in target.
 * @property gets_data_from - Source reads data from target.
 * @property inserts_data_into - Source writes data into target.
 * @property informs - Source provides context that shapes target.
 * @property drives - Source motivates / triggers target.
 * @property constrains - Source limits the behaviour of target.
 * @property defines - Source specifies the definition of target.
 * @property executes - Source carries out target.
 * @property references - Source points at target for documentation.
 * @property validates - Source checks target for correctness.
 * @property measures - Source quantifies target.
 * @property simulates - Source models target.
 * @property contains - Source visually groups target (for `group` nodes).
 * @property used_by - Inverse of `uses`.
 */
export const LinkKindType = VariantType({
    uses: NullType,
    produces: NullType,
    results_in: NullType,
    gets_data_from: NullType,
    inserts_data_into: NullType,
    informs: NullType,
    drives: NullType,
    constrains: NullType,
    defines: NullType,
    executes: NullType,
    references: NullType,
    validates: NullType,
    measures: NullType,
    simulates: NullType,
    contains: NullType,
    used_by: NullType,
});
/** Type alias for {@link LinkKindType}. */
export type LinkKindType = typeof LinkKindType;

/**
 * A directed relationship between two nodes.
 *
 * @property id - Stable identifier for the link.
 * @property source - `id` of the source node.
 * @property target - `id` of the target node.
 * @property type - The relationship semantics — see {@link LinkKindType}.
 */
export const LinkType = StructType({
    id: StringType,
    source: StringType,
    target: StringType,
    type: LinkKindType,
});
/** Type alias for {@link LinkType}. */
export type LinkType = typeof LinkType;

/**
 * A node in the ontology graph.
 *
 * @property id - Stable identifier for the node.
 * @property name - Display name.
 * @property description - Optional long-form description.
 * @property type - Discriminator — see {@link NodeKindType}.
 */
export const NodeType = StructType({
    id: StringType,
    name: StringType,
    description: OptionType(StringType),
    type: NodeKindType,
});
/** Type alias for {@link NodeType}. */
export type NodeType = typeof NodeType;

/**
 * Versioning + provenance metadata attached to an ontology value.
 *
 * @property version - Semver string identifying the schema revision.
 * @property created - Timestamp when this ontology was first written.
 * @property updated - Timestamp of the most recent edit.
 * @property description - Optional caption shown beside the editor header.
 */
export const OntologyMetadataType = StructType({
    version: StringType,
    created: DateTimeType,
    updated: DateTimeType,
    description: OptionType(StringType),
});
/** Type alias for {@link OntologyMetadataType}. */
export type OntologyMetadataType = typeof OntologyMetadataType;

/**
 * The full ontology value carried by an `OntologyType`-typed dataset.
 *
 * @property nodes - Every node in the graph.
 * @property links - Every relationship between nodes. Each link's `source`
 *   and `target` must match a node's `id`; orphaned links are surfaced as
 *   warnings in the editor.
 * @property metadata - Optional versioning + provenance metadata.
 */
const OntologyTypeImpl = StructType({
    nodes: ArrayType(NodeType),
    links: ArrayType(LinkType),
    metadata: OptionType(OntologyMetadataType),
});

/**
 * The structural type of {@link OntologyType}, as a named interface.
 *
 * Same declaration-emit fix as `UIComponentNode` in east-ui: the struct
 * literal's inferred type is a large anonymous structural type (every
 * node/link variant spelled out). Type aliases lose their name through
 * generic inference, so a downstream `export const x = e3.input('o',
 * OntologyType, …)` compiled with declaration emit would serialize the
 * whole structure inline into the `.d.ts`. An interface is a symbol, so
 * the declaration emitter references it by name instead.
 *
 * The interface wraps the whole `StructType` (not its fields record):
 * `StructType`'s `Record<string, …>` fields constraint rejects closed
 * interfaces, but the struct value type itself extends cleanly.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface OntologyStructType extends OntologyTypeImpl {}
type OntologyTypeImpl = typeof OntologyTypeImpl;

export const OntologyType: OntologyStructType = OntologyTypeImpl;
/** Type alias for {@link OntologyType}. */
export type OntologyType = typeof OntologyType;

// ============================================================================
// Sub-types — visual style escape hatches.
// ============================================================================

/**
 * Visual style escape hatches for the Ontology editor. Every visible surface
 * is tokenable; defaults come from the host's design system (Elara AI bsys
 * tokens — see the renderer in `@elaraai/e3-ui-components`).
 *
 * @property nodeBackground - Card background for non-selected nodes.
 * @property nodeBorderColor - Card border colour for non-selected nodes.
 * @property nodeSelectedBackground - Card background when a node is
 *   focused / selected.
 * @property nodeSelectedBorderColor - Card border colour when a node is
 *   focused / selected.
 * @property nodeAccentColor - Default colour for the 2px top stripe when no
 *   kind-specific accent is defined. Per-kind accents come from the
 *   renderer's bsys palette and are not exposed here.
 * @property edgeColor - Default stroke for edges.
 * @property edgeEmphasizedColor - Stroke for edges in the hover / selected /
 *   focused states.
 * @property labelBackground - Background for edge label pills.
 * @property labelBorderColor - Border for edge label pills.
 * @property panelBackground - Background for the outer editor frame.
 * @property panelBorderColor - Border for the outer editor frame.
 * @property headerBackground - Background for the eyebrow header strip.
 * @property footerBackground - Background for the commit-bar footer.
 * @property gridColor - Canvas grid line colour (major + minor).
 * @property minimapMaskColor - Mask colour for the off-screen region in
 *   the minimap.
 */
export const OntologyStyleType = StructType({
    nodeBackground:          OptionType(StringType),
    nodeBorderColor:         OptionType(StringType),
    nodeSelectedBackground:  OptionType(StringType),
    nodeSelectedBorderColor: OptionType(StringType),
    nodeAccentColor:         OptionType(StringType),
    edgeColor:               OptionType(StringType),
    edgeEmphasizedColor:     OptionType(StringType),
    labelBackground:         OptionType(StringType),
    labelBorderColor:        OptionType(StringType),
    panelBackground:         OptionType(StringType),
    panelBorderColor:        OptionType(StringType),
    headerBackground:        OptionType(StringType),
    footerBackground:        OptionType(StringType),
    gridColor:               OptionType(StringType),
    minimapMaskColor:        OptionType(StringType),
});
/** Type alias for {@link OntologyStyleType}. */
export type OntologyStyleType = typeof OntologyStyleType;

/**
 * The Ontology editor's display mode — the segmented control in the header
 * switches between them. Both are projections of the same bound value and
 * share the staged-buffer + commit machinery.
 *
 * @property graph - The ReactFlow node/link canvas (default).
 * @property table - The process table: rows are `process` nodes grouped by
 *   the `objective` they serve and ordered by topological value-chain stage
 *   (derived from `uses` / `produces` resource flow).
 */
export const OntologyViewType = VariantType({
    graph: NullType,
    table: NullType,
});
/** Type alias for {@link OntologyViewType}. */
export type OntologyViewType = typeof OntologyViewType;

/** String literal form of {@link OntologyViewType}. */
export type OntologyViewLiteral = 'graph' | 'table';

// ============================================================================
// Re-export the binding descriptor — same opaque carrier the Diff card uses.
// ============================================================================

/** Re-exported from {@link Data}; see {@link DiffBindingType}. */
export { DiffBindingType } from '../bind/data.js';

// ============================================================================
// Ontology payload — IR shape consumed by the renderer.
// ============================================================================

/**
 * Schema for the `Ontology` extension component. Internal IR shape — the
 * developer-facing factory `Ontology.Root` accepts a {@link Data.bind}
 * handle's `binding` field and forwards it as `binding`.
 *
 * @property binding - The binding the editor reads + writes. The
 *   underlying source dataset must be typed as {@link OntologyType};
 *   this is a developer-side contract (the IR carrier itself is type-erased).
 * @property readonly - Render without per-node / per-link mutation
 *   surfaces. The footer commit-bar and the property drawer still render
 *   but Save / Delete / Add-node are hidden, and the canvas blocks
 *   drag-handles + context menus. Default `false`.
 * @property hideMiniMap - Suppress the minimap overlay. None ⇒ false.
 * @property hideSearch - Suppress the search field in the toolbar.
 *   None ⇒ false.
 * @property density - Information-density preset (`comfortable` | `compact`
 *   | `condensed`). Defaults to `comfortable`.
 * @property onCommitted - Fired after a successful commit (the bound
 *   dataset has been updated).
 * @property onDiscarded - Fired after a successful discard (the staging
 *   buffer was dropped).
 * @property style - Visual style escape hatches — see
 *   {@link OntologyStyleType}.
 */
export const OntologyPayloadType = StructType({
    binding:      DiffBindingType,
    readonly:     OptionType(BooleanType),
    hideMiniMap:  OptionType(BooleanType),
    hideSearch:   OptionType(BooleanType),
    density:      OptionType(DensityType),
    onCommitted:  OptionType(FunctionType([], NullType)),
    onDiscarded:  OptionType(FunctionType([], NullType)),
    style:        OptionType(OntologyStyleType),
    /** Initial display mode — graph canvas (default) or process table. */
    defaultView:  OptionType(OntologyViewType),
});
/** Type alias for {@link OntologyPayloadType}. */
export type OntologyPayloadType = typeof OntologyPayloadType;

/**
 * Internal `EastUI.component` carrier. Renderers register against this in
 * `@elaraai/e3-ui-components`. Most callers should use {@link Ontology.Root}
 * (which wraps this with the handle-friendly API) rather than touching
 * `OntologyComponent` directly.
 */
export const OntologyComponent = EastUI.component('Ontology', OntologyPayloadType, { optional: true });

// ============================================================================
// User-facing factory.
// ============================================================================

/**
 * Options for {@link Ontology.Root}.
 *
 * @property value - The bound dataset to surface. Pass the
 *   {@link Data.bind} handle (`value={view}`) whose source dataset is typed as
 *   {@link OntologyType}. The handle's East type carries the source type, so a
 *   handle bound to any non-`OntologyType` dataset is a compile error here.
 * @property readonly - Render without mutation surfaces. The footer
 *   commit-bar and property drawer still render. Defaults to false.
 * @property hideMiniMap - Suppress the minimap overlay. Defaults to false.
 * @property hideSearch - Suppress the search field. Defaults to false.
 * @property density - Information-density preset (`comfortable` | `compact`
 *   | `condensed`). Defaults to `comfortable`.
 * @property onCommitted - Fired after a successful commit.
 * @property onDiscarded - Fired after a successful discard.
 * @property style - Visual style escape hatches — see
 *   {@link OntologyStyleType}.
 */
export interface OntologyOptions {
    /** The bound dataset to surface — pass the `Data.bind(…)`
     *  handle itself (e.g. `value={view}`). Its East type carries the source
     *  type, so a handle bound to any non-`OntologyType` dataset is a compile
     *  error here. */
    value: BoundValue<OntologyType>;
    /** Render without mutation surfaces. Defaults to false. */
    readonly?: SubtypeExprOrValue<OptionType<BooleanType>>;
    /** Suppress the minimap overlay. Defaults to false. */
    hideMiniMap?: SubtypeExprOrValue<OptionType<BooleanType>>;
    /** Suppress the search field. Defaults to false. */
    hideSearch?: SubtypeExprOrValue<OptionType<BooleanType>>;
    /** Information-density preset. */
    density?: SubtypeExprOrValue<OptionType<DensityType>> | DensityLiteral;
    /** Fired after a successful commit (the bound dataset is updated). */
    onCommitted?: SubtypeExprOrValue<OptionType<FunctionType<[], NullType>>>;
    /** Fired after a successful discard (the staging buffer was dropped). */
    onDiscarded?: SubtypeExprOrValue<OptionType<FunctionType<[], NullType>>>;
    /** Visual style escape hatches — see {@link OntologyStyleType}. */
    style?: SubtypeExprOrValue<OptionType<OntologyStyleType>>;
    /** Initial display mode — `'graph'` (canvas, default) or `'table'`
     *  (objective-grouped process table). The header's segmented control
     *  switches between them at runtime either way. */
    defaultView?: SubtypeExprOrValue<OptionType<OntologyViewType>> | OntologyViewLiteral;
}

/**
 * The Ontology component namespace. Surfaces a graph editor over an
 * `OntologyType`-bound dataset, with the same staged-buffer + merge-aware
 * commit pipeline that powers {@link Diff}.
 *
 * @remarks
 * Use `Ontology.Root({ value: view })` to render the editor.
 * The `Component` property is the internal {@link EastUI.component}
 * carrier that renderers register against — most callers shouldn't need
 * it.
 */
export const Ontology = {
    /**
     * Build an Ontology editor. Renders the bound graph as a ReactFlow
     * canvas with node/link mutation surfaces wired through the binding.
     *
     * @param options - {@link OntologyOptions}. Only `value` is required;
     *   the rest default to absent / interactive.
     * @returns An East expression of {@link UIComponentType} representing
     *   the Ontology editor.
     *
     * @example
     * ```ts
     * import { East } from '@elaraai/east';
     * import { Reactive, UIComponentType } from '@elaraai/east-ui';
     * import { Data, Ontology, OntologyType } from '@elaraai/e3-ui';
     * import * as e3 from '@elaraai/e3';
     *
     * const ontologyInput = e3.input('supply_chain', OntologyType, {
     *   nodes: [], links: [], metadata: { type: 'none', value: null },
     * });
     *
     * const editor = East.function([], UIComponentType, (_$) =>
     *   Reactive.Root(East.function([], UIComponentType, $ => {
     *     const view = $.let(Data.bind(ontologyInput));
     *     return Ontology.Root({ value: view });
     *   })),
     * );
     * ```
     */
    Root(options: OntologyOptions): ExprType<UIComponentType> {
        const view = options.value;
        const density = options.density === undefined
            ? none
            : typeof options.density === 'string'
                ? some(East.value(variant(options.density, null), DensityType))
                : options.density;
        const defaultView = options.defaultView === undefined
            ? none
            : typeof options.defaultView === 'string'
                ? some(East.value(variant(options.defaultView, null), OntologyViewType))
                : options.defaultView;
        return OntologyComponent.Root({
            binding:     view.binding,
            readonly:    options.readonly    ?? none,
            hideMiniMap: options.hideMiniMap ?? none,
            hideSearch:  options.hideSearch  ?? none,
            density,
            onCommitted: options.onCommitted ?? none,
            onDiscarded: options.onDiscarded ?? none,
            style:       options.style       ?? none,
            defaultView,
        });
    },
    /**
     * The internal {@link EastUI.component} carrier. Renderers register
     * against this in `@elaraai/e3-ui-components` via
     * `implementUIComponent(Ontology.Component, EastChakraOntology)`.
     * Most callers should use {@link Ontology.Root} (the handle-friendly
     * factory) and never touch this directly.
     */
    Component: OntologyComponent,
    Types: {
        /** Rendered Ontology payload struct (binding + style). */
        Payload: OntologyPayloadType,
        /** Visual-presentation sub-struct (density, readonly, …). */
        Style: OntologyStyleType,
        /** The bound graph value type. */
        Ontology: OntologyType,
        /** Node struct. */
        Node: NodeType,
        /** Link struct. */
        Link: LinkType,
        /** Node-kind variant enum. */
        NodeKind: NodeKindType,
        /** Link-kind variant enum. */
        LinkKind: LinkKindType,
        /** Optional ontology metadata struct. */
        Metadata: OntologyMetadataType,
        /** Display-mode variant enum (graph | table). */
        View: OntologyViewType,
    },
} as const;
