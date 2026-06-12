/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * Ontology component examples — every scene binds one of **two** shared
 * `OntologyType`-typed `e3.input`s (a supply-chain fulfilment leg and a
 * buy→make→sell trading loop), with each input's default value spelled out
 * fully inline (no builder helpers — every `variant()` / `some()` / `none`
 * call lives at the construction site).
 *
 * Both ontologies carry deliberate gaps (a process without outputs, an
 * unmeasured KPI, a process with no path to an objective) so the editor's
 * completeness warnings have something real to surface.
 *
 * Pattern:
 *   1. Declare `e3.input(name, OntologyType, default)` with `default` fully
 *      inline (no shared constants, no `node()` / `link()` wrappers).
 *   2. Inside `<Reactive>`, bind via `Data.bind(dataset)`.
 *   3. Pass the handle to `<Ontology value={view} />` — its East type pins the
 *      source to `OntologyType`, so a wrong-typed bind is a compile error.
 *   4. (Optional) Stack a `<Diff bindings={[view.binding]} />` next to it
 *      to surface the pending node/link patch.
 */

import { East, none, some, variant, example } from '@elaraai/east';
import { Card, Reactive, Text, UIComponentType, VStack } from '@elaraai/east-ui';
import { Data, Diff, Ontology, OntologyType } from '@elaraai/e3-ui';
import * as e3 from '@elaraai/e3';

// ============================================================================
// Inputs — two shared ontologies, reused by every scene; exported so the
// showcase can forward them as extras.
// ============================================================================

export const supplyChainOntologyInput = e3.input('supply_chain_ontology', OntologyType, {
    nodes: [
        { id: 'obj-1',  name: 'Reduce stockout rate',    description: some('Strategic target for FY26.'),      type: variant('objective', null) },
        { id: 'kpi-1',  name: 'Fill rate (weekly)',      description: some('Orders fulfilled / total.'),       type: variant('kpi',       null) },
        { id: 'kpi-2',  name: 'Inventory turnover',      description: none,                                    type: variant('kpi',       null) },
        { id: 'proc-1', name: 'Receive raw goods',       description: some('Dock-to-stock receipt.'),          type: variant('process',   null) },
        { id: 'proc-2', name: 'Quality inspection',      description: some('Sampling per inbound lot.'),       type: variant('process',   null) },
        { id: 'proc-3', name: 'Pick & pack',             description: none,                                    type: variant('process',   null) },
        { id: 'proc-4', name: 'Dispatch',                description: none,                                    type: variant('process',   null) },
        { id: 'res-1',  name: 'Pallet inventory',        description: some('On-hand pallets at DC-West.'),     type: variant('resource',  null) },
        { id: 'res-2',  name: 'Picker pool',             description: none,                                    type: variant('resource',  null) },
        { id: 'res-3',  name: 'Packed orders',           description: none,                                    type: variant('resource',  null) },
        { id: 'res-4',  name: 'Shipped consignments',    description: none,                                    type: variant('resource',  null) },
        { id: 'dec-1',  name: 'Replenishment quantity',  description: some('Order-up-to level per SKU.'),      type: variant('decision',  null) },
        { id: 'dec-2',  name: 'Pick-wave size',          description: none,                                    type: variant('decision',  null) },
        { id: 'ag-1',   name: 'DC operations team',      description: none,                                    type: variant('agent',     null) },
        { id: 'ag-2',   name: 'Inventory planner',       description: none,                                    type: variant('agent',     null) },
        { id: 'data-1', name: 'WMS order stream',        description: none,                                    type: variant('data',      null) },
        { id: 'data-2', name: 'Carrier API',             description: some('Shipment status webhook.'),        type: variant('data',      null) },
        { id: 'pol-1',  name: 'FEFO picking policy',     description: some('First-expiring-first-out.'),       type: variant('policy',    null) },
    ],
    links: [
        // Measurement up to the objective.
        { id: 'l-1',  source: 'kpi-1',  target: 'obj-1',  type: variant('drives',            null) },
        { id: 'l-2',  source: 'kpi-2',  target: 'obj-1',  type: variant('drives',            null) },
        { id: 'l-3',  source: 'kpi-1',  target: 'proc-4', type: variant('measures',          null) },
        { id: 'l-4',  source: 'kpi-2',  target: 'proc-1', type: variant('measures',          null) },
        // Resource flow: receive -> pick & pack -> dispatch.
        { id: 'l-5',  source: 'proc-1', target: 'res-1',  type: variant('produces',          null) },
        { id: 'l-6',  source: 'proc-3', target: 'res-1',  type: variant('uses',              null) },
        { id: 'l-7',  source: 'proc-3', target: 'res-2',  type: variant('uses',              null) },
        { id: 'l-8',  source: 'proc-3', target: 'res-3',  type: variant('produces',          null) },
        { id: 'l-9',  source: 'proc-4', target: 'res-3',  type: variant('uses',              null) },
        { id: 'l-10', source: 'proc-4', target: 'res-4',  type: variant('produces',          null) },
        // Quality inspection consumes pallets but produces nothing —
        // a deliberate REA-duality gap the table view flags.
        { id: 'l-11', source: 'res-1',  target: 'proc-2', type: variant('used_by',           null) },
        // Decisions and owners.
        { id: 'l-12', source: 'dec-1',  target: 'proc-1', type: variant('drives',            null) },
        { id: 'l-13', source: 'dec-2',  target: 'proc-3', type: variant('drives',            null) },
        { id: 'l-14', source: 'ag-1',   target: 'proc-3', type: variant('executes',          null) },
        { id: 'l-15', source: 'ag-1',   target: 'proc-4', type: variant('executes',          null) },
        { id: 'l-16', source: 'ag-2',   target: 'dec-1',  type: variant('executes',          null) },
        // Systems and constraints.
        { id: 'l-17', source: 'data-1', target: 'proc-3', type: variant('informs',           null) },
        { id: 'l-18', source: 'proc-4', target: 'data-2', type: variant('inserts_data_into', null) },
        { id: 'l-19', source: 'data-2', target: 'kpi-1',  type: variant('gets_data_from',    null) },
        { id: 'l-20', source: 'pol-1',  target: 'proc-3', type: variant('constrains',        null) },
    ],
    metadata: some({
        version: '1.1.0',
        created: new Date('2026-01-15T00:00:00Z'),
        updated: new Date('2026-06-12T00:00:00Z'),
        description: some('Supply-chain operations ontology — fulfilment leg.'),
    }),
});

export const tradingCycleOntologyInput = e3.input('trading_cycle_ontology', OntologyType, {
    nodes: [
        { id: 'tc-obj',   name: 'Grow operating profit',    description: some('FY27 north star.'),                       type: variant('objective', null) },
        { id: 'tc-kpi-m', name: 'Gross margin %',           description: some('Weekly, by product family.'),             type: variant('kpi',       null) },
        { id: 'tc-kpi-d', name: 'On-time dispatch %',       description: none,                                           type: variant('kpi',       null) },
        // Deliberately unattached — surfaces as a graph warning.
        { id: 'tc-kpi-f', name: 'Forecast accuracy',        description: some('Not wired to a process yet.'),            type: variant('kpi',       null) },
        { id: 'tc-buy',   name: 'Procure materials',        description: some('Spend cash on raw inputs.'),              type: variant('process',   null) },
        { id: 'tc-make',  name: 'Manufacture products',     description: some('Convert materials into finished goods.'), type: variant('process',   null) },
        { id: 'tc-sell',  name: 'Sell & dispatch',          description: some('Convert finished goods back into cash.'), type: variant('process',   null) },
        { id: 'tc-ord',   name: 'Receive customer orders',  description: none,                                           type: variant('process',   null) },
        { id: 'tc-cash',  name: 'Working capital',          description: some('Cash on hand — the loop closer.'),        type: variant('resource',  null) },
        { id: 'tc-raw',   name: 'Raw materials',            description: none,                                           type: variant('resource',  null) },
        { id: 'tc-fin',   name: 'Finished products',        description: none,                                           type: variant('resource',  null) },
        { id: 'tc-book',  name: 'Order book',               description: none,                                           type: variant('resource',  null) },
        { id: 'tc-dec-b', name: 'Purchase volume & timing', description: some('How much to buy, and when.'),             type: variant('decision',  null) },
        { id: 'tc-dec-m', name: 'Production schedule',      description: none,                                           type: variant('decision',  null) },
        { id: 'tc-dec-s', name: 'Price list',               description: some('Margin lever per product family.'),       type: variant('decision',  null) },
        { id: 'tc-ag-p',  name: 'Procurement team',         description: none,                                           type: variant('agent',     null) },
        { id: 'tc-ag-o',  name: 'Plant supervisor',         description: none,                                           type: variant('agent',     null) },
        { id: 'tc-ag-s',  name: 'Sales desk',               description: none,                                           type: variant('agent',     null) },
        { id: 'tc-pol',   name: 'Customer credit terms',    description: some('Net-30; gates dispatch.'),                type: variant('policy',    null) },
        { id: 'tc-erp',   name: 'ERP ledger',               description: none,                                           type: variant('data',      null) },
    ],
    links: [
        // The working-capital cycle: cash -> materials -> goods -> cash.
        { id: 'tc-l1',  source: 'tc-buy',   target: 'tc-cash',  type: variant('uses',       null) },
        { id: 'tc-l2',  source: 'tc-buy',   target: 'tc-raw',   type: variant('produces',   null) },
        { id: 'tc-l3',  source: 'tc-make',  target: 'tc-raw',   type: variant('uses',       null) },
        { id: 'tc-l4',  source: 'tc-make',  target: 'tc-fin',   type: variant('produces',   null) },
        { id: 'tc-l5',  source: 'tc-sell',  target: 'tc-fin',   type: variant('uses',       null) },
        { id: 'tc-l6',  source: 'tc-sell',  target: 'tc-cash',  type: variant('produces',   null) },
        // Order intake feeds the cycle without being inside it. It has no
        // inputs, KPI, or decision — deliberate gaps the table view flags.
        { id: 'tc-l7',  source: 'tc-ord',   target: 'tc-book',  type: variant('produces',   null) },
        { id: 'tc-l8',  source: 'tc-sell',  target: 'tc-book',  type: variant('uses',       null) },
        // Measurement up to the objective.
        { id: 'tc-l9',  source: 'tc-kpi-m', target: 'tc-buy',   type: variant('measures',   null) },
        { id: 'tc-l10', source: 'tc-kpi-m', target: 'tc-make',  type: variant('measures',   null) },
        { id: 'tc-l11', source: 'tc-kpi-d', target: 'tc-sell',  type: variant('measures',   null) },
        { id: 'tc-l12', source: 'tc-kpi-m', target: 'tc-obj',   type: variant('drives',     null) },
        { id: 'tc-l13', source: 'tc-kpi-d', target: 'tc-obj',   type: variant('drives',     null) },
        // Decisions steering each process.
        { id: 'tc-l14', source: 'tc-dec-b', target: 'tc-buy',   type: variant('drives',     null) },
        { id: 'tc-l15', source: 'tc-dec-m', target: 'tc-make',  type: variant('drives',     null) },
        { id: 'tc-l16', source: 'tc-dec-s', target: 'tc-sell',  type: variant('drives',     null) },
        // Owners, constraints, systems.
        { id: 'tc-l17', source: 'tc-ag-p',  target: 'tc-buy',   type: variant('executes',   null) },
        { id: 'tc-l18', source: 'tc-ag-o',  target: 'tc-make',  type: variant('executes',   null) },
        { id: 'tc-l19', source: 'tc-ag-s',  target: 'tc-sell',  type: variant('executes',   null) },
        { id: 'tc-l20', source: 'tc-pol',   target: 'tc-sell',  type: variant('constrains', null) },
        { id: 'tc-l21', source: 'tc-erp',   target: 'tc-buy',   type: variant('informs',    null) },
        { id: 'tc-l22', source: 'tc-sell',  target: 'tc-erp',   type: variant('inserts_data_into', null) },
    ],
    metadata: some({
        version: '1.0.0',
        created: new Date('2026-06-01T00:00:00Z'),
        updated: new Date('2026-06-12T00:00:00Z'),
        description: some('Buy → make → sell with the working-capital cycle closed.'),
    }),
});

// ============================================================================
// 1. Supply-chain ontology — the fulfilment leg as a graph.
// ============================================================================

export const supplyChainOntology = example({
    keywords: ['Ontology', 'supply-chain', 'process', 'kpi', 'objective', 'agent', 'decision'],
    description: 'Supply-chain ontology — process/resource/data/kpi graph with decisions, owners, and policy constraints',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const view = $.let(Data.bind(supplyChainOntologyInput, { mode: 'direct' }));
                return <Ontology value={view} />;
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 2. Table view — buy → make → sell with a closed working-capital cycle. The
//    segmented control switches Graph | Table; the table groups by objective,
//    orders by value-chain stage, and marks the cash cycle on every member.
// ============================================================================

export const ontologyTableCycleView = example({
    keywords: ['Ontology', 'table', 'view', 'cycle', 'value-chain', 'stage', 'agent', 'defaultView', 'segmented'],
    description: 'Table view of a buy/make/sell business — objective-grouped process rows, topological stages, and the working-capital cycle marked',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const view = $.let(Data.bind(tradingCycleOntologyInput));
            return <Ontology value={view} defaultView="table" />;
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// 3. Compact-density editor — the trading loop in tighter chrome.
// ============================================================================

export const compactDensityOntology = example({
    keywords: ['Ontology', 'density', 'compact'],
    description: 'Compact-density Ontology editor — tighter node cards and toolbar spacing',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const view = $.let(Data.bind(tradingCycleOntologyInput, { mode: 'direct' }));
                return <Ontology value={view} density="compact" />;
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 4. Ontology + Diff — editor on top, Diff card below shows the in-flight
//    node/link patch before commit.
// ============================================================================

export const ontologyWithDiff = example({
    keywords: ['Ontology', 'Diff', 'bindStaged', 'review'],
    description: 'Ontology editor + Diff panel — pending node/link patch surfaces in Diff card',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const view = $.let(Data.bind(supplyChainOntologyInput));
                return (
                    <Card>
                        <VStack gap="4" align="stretch">
                            <Text textStyle="heading-md">Fulfilment ontology</Text>
                            <Text>Edit nodes and links above; review the pending patch below before applying.</Text>
                            <Ontology value={view} />
                            <Diff bindings={[view.binding]} hideUnchanged={some(true)} />
                        </VStack>
                    </Card>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
