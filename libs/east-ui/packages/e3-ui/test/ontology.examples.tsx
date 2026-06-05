/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * Ontology component examples — each scene binds an `OntologyType`-typed
 * `e3.input` to the Ontology editor, with the input's default value spelled
 * out fully inline (no builder helpers — every `variant()` / `some()` /
 * `none` call lives at the construction site).
 *
 * Pattern:
 *   1. Declare `e3.input(name, OntologyType, default)` with `default` fully
 *      inline (no shared constants, no `node()` / `link()` wrappers).
 *   2. Inside `<Reactive>`, bind via `Data.bind([OntologyType], path)`.
 *   3. Pass `view.binding` to `<Ontology binding={view.binding} />`.
 *   4. (Optional) Stack a `<Diff bindings={[view.binding]} />` next to it
 *      to surface the pending node/link patch.
 */

import { East, none, some, variant, example } from '@elaraai/east';
import { Card, HStack, Reactive, Text, UIComponentType, VStack } from '@elaraai/east-ui';
import { Data, Diff, Ontology, OntologyType } from '@elaraai/e3-ui';
import * as e3 from '@elaraai/e3';

// ============================================================================
// Inputs — one per scene; exported so the showcase can forward as extras.
// ============================================================================

export const simpleOntologyInput = e3.input('simple_ontology', OntologyType, {
    nodes: [],
    links: [],
    metadata: none,
});

export const supplyChainOntologyInput = e3.input('supply_chain_ontology', OntologyType, {
    nodes: [
        { id: 'obj-1',  name: 'Reduce stockout rate', description: some('Strategic target for FY26.'),     type: variant('objective', null) },
        { id: 'kpi-1',  name: 'Fill rate (weekly)',   description: some('Orders fulfilled / total.'),       type: variant('kpi',       null) },
        { id: 'kpi-2',  name: 'Inventory turnover',   description: none,                                    type: variant('kpi',       null) },
        { id: 'proc-1', name: 'Receive raw goods',    description: some('Dock-to-stock receipt.'),          type: variant('process',   null) },
        { id: 'proc-2', name: 'Quality inspection',   description: none,                                    type: variant('process',   null) },
        { id: 'proc-3', name: 'Pick & pack',          description: none,                                    type: variant('process',   null) },
        { id: 'proc-4', name: 'Dispatch',             description: none,                                    type: variant('process',   null) },
        { id: 'res-1',  name: 'Pallet inventory',     description: some('On-hand pallets at DC-West.'),     type: variant('resource',  null) },
        { id: 'res-2',  name: 'Picker pool',          description: none,                                    type: variant('resource',  null) },
        { id: 'data-1', name: 'WMS order stream',     description: none,                                    type: variant('data',      null) },
        { id: 'data-2', name: 'Carrier API',          description: some('Shipment status webhook.'),        type: variant('data',      null) },
        { id: 'pol-1',  name: 'FEFO picking policy',  description: some('First-expiring-first-out.'),       type: variant('policy',    null) },
    ],
    links: [
        { id: 'l-1',  source: 'kpi-1',  target: 'obj-1',  type: variant('drives',            null) },
        { id: 'l-2',  source: 'kpi-2',  target: 'obj-1',  type: variant('drives',            null) },
        { id: 'l-3',  source: 'proc-1', target: 'res-1',  type: variant('produces',          null) },
        { id: 'l-4',  source: 'proc-2', target: 'res-1',  type: variant('used_by',           null) },
        { id: 'l-5',  source: 'proc-3', target: 'res-1',  type: variant('uses',              null) },
        { id: 'l-6',  source: 'proc-3', target: 'res-2',  type: variant('uses',              null) },
        { id: 'l-7',  source: 'proc-4', target: 'data-2', type: variant('inserts_data_into', null) },
        { id: 'l-8',  source: 'data-1', target: 'proc-3', type: variant('informs',           null) },
        { id: 'l-9',  source: 'data-2', target: 'kpi-1',  type: variant('gets_data_from',    null) },
        { id: 'l-10', source: 'pol-1',  target: 'proc-3', type: variant('constrains',        null) },
        { id: 'l-11', source: 'kpi-1',  target: 'proc-4', type: variant('measures',          null) },
        { id: 'l-12', source: 'kpi-2',  target: 'res-1',  type: variant('measures',          null) },
        { id: 'l-13', source: 'proc-2', target: 'proc-3', type: variant('informs',           null) },
        { id: 'l-14', source: 'proc-1', target: 'proc-2', type: variant('informs',           null) },
        { id: 'l-15', source: 'proc-3', target: 'proc-4', type: variant('informs',           null) },
    ],
    metadata: some({
        version: '1.0.0',
        created: new Date('2026-01-15T00:00:00Z'),
        updated: new Date('2026-05-01T12:00:00Z'),
        description: some('Supply-chain operations ontology — fulfilment leg.'),
    }),
});

export const governanceOntologyInput = e3.input('governance_ontology', OntologyType, {
    nodes: [
        { id: 'obj-g',   name: 'SOC 2 Type II readiness', description: none,                                  type: variant('objective', null) },
        { id: 'pol-acl', name: 'Access-control policy',   description: some('Least privilege; quarterly.'),   type: variant('policy',    null) },
        { id: 'pol-ret', name: 'Data retention policy',   description: none,                                  type: variant('policy',    null) },
        { id: 'pol-enc', name: 'Encryption-at-rest',      description: none,                                  type: variant('policy',    null) },
        { id: 'doc-iso', name: 'ISO 27001 controls',      description: none,                                  type: variant('document',  null) },
        { id: 'doc-dpa', name: 'Customer DPA template',   description: none,                                  type: variant('document',  null) },
        { id: 'dec-q1',  name: 'Q1 audit scope review',   description: some('Quarterly board-level review.'), type: variant('decision',  null) },
        { id: 'proc-rev',name: 'Access review',           description: none,                                  type: variant('process',   null) },
        { id: 'proc-log',name: 'Audit-log monitoring',    description: none,                                  type: variant('process',   null) },
        { id: 'kpi-mttr',name: 'MTTR (security tickets)', description: none,                                  type: variant('kpi',       null) },
    ],
    links: [
        { id: 'lg-1',  source: 'pol-acl',  target: 'obj-g',    type: variant('drives',     null) },
        { id: 'lg-2',  source: 'pol-ret',  target: 'obj-g',    type: variant('drives',     null) },
        { id: 'lg-3',  source: 'pol-enc',  target: 'obj-g',    type: variant('drives',     null) },
        { id: 'lg-4',  source: 'doc-iso',  target: 'pol-acl',  type: variant('defines',    null) },
        { id: 'lg-5',  source: 'doc-iso',  target: 'pol-ret',  type: variant('defines',    null) },
        { id: 'lg-6',  source: 'doc-iso',  target: 'pol-enc',  type: variant('defines',    null) },
        { id: 'lg-7',  source: 'dec-q1',   target: 'proc-rev', type: variant('executes',   null) },
        { id: 'lg-8',  source: 'doc-dpa',  target: 'pol-ret',  type: variant('references', null) },
        { id: 'lg-9',  source: 'pol-acl',  target: 'proc-rev', type: variant('constrains', null) },
        { id: 'lg-10', source: 'proc-log', target: 'kpi-mttr', type: variant('informs',    null) },
        { id: 'lg-11', source: 'kpi-mttr', target: 'obj-g',    type: variant('drives',     null) },
    ],
    metadata: none,
});

export const readonlyOntologyInput = e3.input('readonly_ontology', OntologyType, {
    nodes: [
        { id: 'r-obj',  name: 'Customer NPS ≥ 60', description: some('Locked target — read-only view.'), type: variant('objective', null) },
        { id: 'r-kpi',  name: 'Quarterly NPS',     description: none,                                    type: variant('kpi',       null) },
        { id: 'r-data', name: 'Survey responses',  description: none,                                    type: variant('data',      null) },
        { id: 'r-proc', name: 'Compute NPS',       description: none,                                    type: variant('process',   null) },
    ],
    links: [
        { id: 'r-l1', source: 'r-kpi',  target: 'r-obj',  type: variant('drives',         null) },
        { id: 'r-l2', source: 'r-data', target: 'r-proc', type: variant('informs',        null) },
        { id: 'r-l3', source: 'r-proc', target: 'r-kpi',  type: variant('results_in',     null) },
        { id: 'r-l4', source: 'r-data', target: 'r-kpi',  type: variant('gets_data_from', null) },
    ],
    metadata: none,
});

export const compactOntologyInput = e3.input('compact_ontology', OntologyType, {
    nodes: [
        { id: 'c-pr1', name: 'Source data',     description: none, type: variant('process', null) },
        { id: 'c-pr2', name: 'Transform',       description: none, type: variant('process', null) },
        { id: 'c-pr3', name: 'Load',            description: none, type: variant('process', null) },
        { id: 'c-d1',  name: 'Bronze tier',     description: none, type: variant('data',    null) },
        { id: 'c-d2',  name: 'Silver tier',     description: none, type: variant('data',    null) },
        { id: 'c-d3',  name: 'Gold tier',       description: none, type: variant('data',    null) },
    ],
    links: [
        { id: 'c-l1', source: 'c-pr1', target: 'c-d1', type: variant('produces',          null) },
        { id: 'c-l2', source: 'c-pr2', target: 'c-d1', type: variant('uses',              null) },
        { id: 'c-l3', source: 'c-pr2', target: 'c-d2', type: variant('produces',          null) },
        { id: 'c-l4', source: 'c-pr3', target: 'c-d2', type: variant('uses',              null) },
        { id: 'c-l5', source: 'c-pr3', target: 'c-d3', type: variant('produces',          null) },
        { id: 'c-l6', source: 'c-pr1', target: 'c-pr2', type: variant('informs',          null) },
        { id: 'c-l7', source: 'c-pr2', target: 'c-pr3', type: variant('informs',          null) },
    ],
    metadata: none,
});

export const ontologyWithDiffInput = e3.input('with_diff_ontology', OntologyType, {
    nodes: [
        { id: 'wd-obj',  name: 'Reduce churn',     description: none, type: variant('objective', null) },
        { id: 'wd-kpi',  name: 'Monthly churn %',  description: none, type: variant('kpi',       null) },
        { id: 'wd-proc', name: 'Win-back campaign',description: none, type: variant('process',   null) },
        { id: 'wd-data', name: 'CRM signals',      description: none, type: variant('data',      null) },
        { id: 'wd-pol',  name: 'Discount policy',  description: none, type: variant('policy',    null) },
    ],
    links: [
        { id: 'wd-l1', source: 'wd-kpi',  target: 'wd-obj',  type: variant('drives',          null) },
        { id: 'wd-l2', source: 'wd-proc', target: 'wd-kpi',  type: variant('results_in',      null) },
        { id: 'wd-l3', source: 'wd-data', target: 'wd-proc', type: variant('informs',         null) },
        { id: 'wd-l4', source: 'wd-pol',  target: 'wd-proc', type: variant('constrains',      null) },
    ],
    metadata: none,
});

export const dashboardLeftInput = e3.input('dashboard_left', OntologyType, {
    nodes: [
        { id: 'dl-obj',  name: 'Ops uptime ≥ 99.9%', description: none, type: variant('objective', null) },
        { id: 'dl-kpi',  name: 'P99 latency',        description: none, type: variant('kpi',       null) },
        { id: 'dl-proc', name: 'Health check',       description: none, type: variant('process',   null) },
    ],
    links: [
        { id: 'dl-l1', source: 'dl-kpi',  target: 'dl-obj',  type: variant('drives',     null) },
        { id: 'dl-l2', source: 'dl-proc', target: 'dl-kpi',  type: variant('measures',   null) },
    ],
    metadata: none,
});

export const dashboardRightInput = e3.input('dashboard_right', OntologyType, {
    nodes: [
        { id: 'dr-obj',  name: 'Audit pass',       description: none, type: variant('objective', null) },
        { id: 'dr-pol',  name: 'Logging policy',   description: none, type: variant('policy',    null) },
        { id: 'dr-doc',  name: 'Control matrix',   description: none, type: variant('document',  null) },
    ],
    links: [
        { id: 'dr-l1', source: 'dr-pol', target: 'dr-obj', type: variant('drives',     null) },
        { id: 'dr-l2', source: 'dr-doc', target: 'dr-pol', type: variant('defines',    null) },
    ],
    metadata: none,
});

// ============================================================================
// 1. Minimal call site — empty default, all options at their defaults.
// ============================================================================

export const simpleOntologyEditor = example({
    keywords: ['Ontology', 'bindStaged', 'editor', 'minimal'],
    description: 'Empty Ontology editor — minimal call site bound to a defaulted input',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const view = $.let(Data.bind([OntologyType], simpleOntologyInput.path, { mode: 'direct' }));
                return <Ontology binding={view.binding} />;
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 2. Supply-chain ontology — 12 nodes / 15 links across process, resource,
//    data, kpi, objective, policy kinds.
// ============================================================================

export const supplyChainOntology = example({
    keywords: ['Ontology', 'supply-chain', 'process', 'kpi', 'objective', 'bindStaged'],
    description: 'Supply-chain ontology — process/resource/data/kpi graph with policy constraints',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const view = $.let(Data.bind([OntologyType], supplyChainOntologyInput.path, { mode: 'direct' }));
                return <Ontology binding={view.binding} />;
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 3. Governance ontology — policy / decision / document heavy.
// ============================================================================

export const governanceOntology = example({
    keywords: ['Ontology', 'governance', 'policy', 'decision', 'document', 'bindStaged'],
    description: 'Governance ontology — policy/decision/document graph for SOC 2 readiness',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const view = $.let(Data.bind([OntologyType], governanceOntologyInput.path, { mode: 'direct' }));
                return <Ontology binding={view.binding} />;
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 4. Read-only viewer — mutation surfaces hidden.
// ============================================================================

export const readonlyOntologyViewer = example({
    keywords: ['Ontology', 'readonly', 'viewer'],
    description: 'Read-only Ontology viewer — drawer/context menus/handles disabled',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const view = $.let(Data.bind([OntologyType], readonlyOntologyInput.path, { mode: 'direct' }));
                return <Ontology binding={view.binding} readonly={some(true)} />;
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 5. Compact-density editor — smaller node cards, tighter row gaps.
// ============================================================================

export const compactDensityOntology = example({
    keywords: ['Ontology', 'density', 'compact'],
    description: 'Compact-density Ontology editor — tighter node cards and toolbar spacing',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const view = $.let(Data.bind([OntologyType], compactOntologyInput.path, { mode: 'direct' }));
                return <Ontology binding={view.binding} density="compact" />;
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 6. Ontology + Diff — editor on top, Diff card below shows the in-flight
//    node/link patch before commit.
// ============================================================================

export const ontologyWithDiff = example({
    keywords: ['Ontology', 'Diff', 'bindStaged', 'review'],
    description: 'Ontology editor + Diff panel — pending node/link patch surfaces in Diff card',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const view = $.let(Data.bind([OntologyType], ontologyWithDiffInput.path));
                return (
                    <Card>
                        <VStack gap="4" align="stretch">
                            <Text textStyle="heading-md">Churn-reduction ontology</Text>
                            <Text>Edit nodes and links above; review the pending patch below before applying.</Text>
                            <Ontology binding={view.binding} />
                            <Diff bindings={[view.binding]} hideUnchanged={some(true)} />
                        </VStack>
                    </Card>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 7. Multi-binding dashboard — two Ontology editors side by side, independent
//    staging buffers per binding.
// ============================================================================

export const multiBindingDashboard = example({
    keywords: ['Ontology', 'dashboard', 'multi-binding', 'Stack'],
    description: 'Two Ontology editors side by side — independent staging buffers per binding',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const left  = $.let(Data.bind([OntologyType], dashboardLeftInput.path, { mode: 'direct' }));
                const right = $.let(Data.bind([OntologyType], dashboardRightInput.path, { mode: 'direct' }));
                return (
                    <VStack gap="4" align="stretch">
                        <Text textStyle="heading-md">Operations · Governance</Text>
                        <HStack gap="4" align="stretch">
                            <Card>
                                <VStack gap="3" align="stretch">
                                    <Text textStyle="heading-sm">Operations</Text>
                                    <Ontology binding={left.binding} />
                                </VStack>
                            </Card>
                            <Card>
                                <VStack gap="3" align="stretch">
                                    <Text textStyle="heading-sm">Governance</Text>
                                    <Ontology binding={right.binding} />
                                </VStack>
                            </Card>
                        </HStack>
                    </VStack>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
