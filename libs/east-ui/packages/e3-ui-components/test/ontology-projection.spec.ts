/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for the ontology table projection (`projection.ts`) — pure
 * function over an `OntologyType` value: value-chain stages via SCC
 * condensation + longest-path layering, objective grouping via KPI
 * `drives` reachability, flow neighbors, and completeness lints.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { none, some, variant } from '@elaraai/east';

import { projectTable } from '../src/ontology/projection.js';
import type { Ontology } from '../src/ontology/types.js';

type Node = Ontology['nodes'][number];
type Link = Ontology['links'][number];

function node(id: string, kind: Node['type']['type'], name = id): Node {
    return { id, name, description: none, type: variant(kind, null) as Node['type'] };
}
function link(id: string, source: string, target: string, kind: Link['type']['type']): Link {
    return { id, source, target, type: variant(kind, null) as Link['type'] };
}
function ontology(nodes: Node[], links: Link[]): Ontology {
    return { nodes, links, metadata: none };
}

/** Buy → make → sell with the working-capital loop closed, plus an
 *  order-intake process outside the cycle. */
function tradingCycle(): Ontology {
    return ontology(
        [
            node('obj', 'objective', 'Grow profit'),
            node('kpi-m', 'kpi', 'Margin'),
            node('kpi-d', 'kpi', 'Dispatch'),
            node('buy', 'process', 'Procure'),
            node('make', 'process', 'Manufacture'),
            node('sell', 'process', 'Sell'),
            node('orders', 'process', 'Receive orders'),
            node('cash', 'resource', 'Cash'),
            node('raw', 'resource', 'Raw materials'),
            node('fin', 'resource', 'Finished goods'),
            node('book', 'resource', 'Order book'),
            node('dec-b', 'decision', 'Purchase volume'),
            node('ag', 'agent', 'Procurement team'),
        ],
        [
            link('l1', 'buy', 'cash', 'uses'),
            link('l2', 'buy', 'raw', 'produces'),
            link('l3', 'make', 'raw', 'uses'),
            link('l4', 'make', 'fin', 'produces'),
            link('l5', 'sell', 'fin', 'uses'),
            link('l6', 'sell', 'cash', 'produces'),     // closes the cycle
            link('l7', 'orders', 'book', 'produces'),
            link('l8', 'sell', 'book', 'uses'),
            link('l9', 'kpi-m', 'buy', 'measures'),
            link('l10', 'kpi-m', 'make', 'measures'),
            link('l11', 'kpi-d', 'sell', 'measures'),
            link('l12', 'kpi-m', 'obj', 'drives'),
            link('l13', 'kpi-d', 'obj', 'drives'),
            link('l14', 'dec-b', 'buy', 'drives'),
            link('l15', 'ag', 'buy', 'executes'),
        ],
    );
}

void describe('ontology table projection', () => {
    void it('condenses the resource cycle: members share a stage and are flagged', () => {
        const proj = projectTable(tradingCycle());
        const rows = proj.groups.flatMap(g => g.sections.flatMap(s => s.rows));
        const byName = new Map(rows.map(r => [r.name, r]));
        const buy = byName.get('Procure')!;
        const make = byName.get('Manufacture')!;
        const sell = byName.get('Sell')!;
        for (const r of [buy, make, sell]) {
            assert.equal(r.cyclic, true, `${r.name} should be cyclic`);
            assert.equal(r.stage, buy.stage, 'cycle members share a stage');
            assert.equal(r.cycleWith.length, 2);
        }
    });

    void it('orders by value-chain stage: order intake precedes the cycle it feeds', () => {
        const proj = projectTable(tradingCycle());
        const rows = proj.groups.flatMap(g => g.sections.flatMap(s => s.rows));
        const orders = rows.find(r => r.name === 'Receive orders')!;
        const sell = rows.find(r => r.name === 'Sell')!;
        assert.equal(orders.cyclic, false);
        assert.ok(orders.stage < sell.stage, 'upstream feeder gets an earlier stage');
        assert.equal(proj.stageCount, sell.stage);
    });

    void it('orders cycle members by the loop walk, not alphabetically', () => {
        // Within the SCC the walk enters at Sell (the only member with
        // external inflow — the order book) and follows the loop:
        // Sell → (cash) → Procure → (raw) → Manufacture. So wherever cycle
        // members share a section, a process always appears BELOW the
        // member that feeds it (only the wrap-around edge points back) —
        // alphabetical order would put Manufacture above the Procure that
        // feeds it.
        const proj = projectTable(tradingCycle());
        const group = proj.groups.find(g => g.name === 'Grow profit')!;
        const margin = group.sections.find(s => s.kpi?.name === 'Margin')!;
        assert.deepEqual(margin.rows.map(r => r.name), ['Procure', 'Manufacture'],
            'Procure (feeds Manufacture) comes first within the section');
    });

    void it('explains flow: upstream/downstream neighbors carry the connecting resources', () => {
        const proj = projectTable(tradingCycle());
        const rows = proj.groups.flatMap(g => g.sections.flatMap(s => s.rows));
        const make = rows.find(r => r.name === 'Manufacture')!;
        assert.deepEqual(make.upstream.map(n => [n.name, n.via]), [['Procure', ['Raw materials']]]);
        assert.deepEqual(make.downstream.map(n => [n.name, n.via]), [['Sell', ['Finished goods']]]);
        const sell = rows.find(r => r.name === 'Sell')!;
        assert.ok(sell.downstream.some(n => n.name === 'Procure' && n.via.includes('Cash')),
            'the cycle closes: Sell feeds Procure via Cash');
    });

    void it('groups processes under the objective their KPIs drive, partitioned by KPI', () => {
        const proj = projectTable(tradingCycle());
        const group = proj.groups.find(g => g.name === 'Grow profit')!;
        assert.equal(group.processCount, 3);
        // Two connecting KPIs → KPI-tier sections.
        const kpiNames = group.sections.map(s => s.kpi?.name).sort();
        assert.deepEqual(kpiNames, ['Dispatch', 'Margin']);
        // Receive orders reaches no objective → Unassigned.
        const unassigned = proj.groups.find(g => g.id === null)!;
        assert.deepEqual(unassigned.sections.flatMap(s => s.rows.map(r => r.name)), ['Receive orders']);
    });

    void it('collects row relations: decisions, agents, KPIs', () => {
        const proj = projectTable(tradingCycle());
        const rows = proj.groups.flatMap(g => g.sections.flatMap(s => s.rows));
        const buy = rows.find(r => r.name === 'Procure')!;
        assert.deepEqual(buy.decisions.map(d => d.name), ['Purchase volume']);
        assert.deepEqual(buy.agents.map(a => a.name), ['Procurement team']);
        assert.deepEqual(buy.kpis.map(k => k.name), ['Margin']);
    });

    void it('lints: missing decisions/KPIs per row, idle nodes and orphan links graph-wide', () => {
        const proj = projectTable(ontology(
            [
                node('p', 'process', 'Lonely process'),
                node('k', 'kpi', 'Idle KPI'),
                node('d', 'decision', 'Idle decision'),
                node('o', 'objective', 'Unreached objective'),
            ],
            [link('l1', 'p', 'ghost', 'produces')],
        ));
        const row = proj.groups.flatMap(g => g.sections.flatMap(s => s.rows))[0]!;
        assert.deepEqual(row.lints, ['No inputs (uses)', 'No outputs (produces)', 'No KPI', 'No decision']);
        assert.ok(proj.lints.some(l => l.includes('Idle KPI')));
        assert.ok(proj.lints.some(l => l.includes('Idle decision')));
        assert.ok(proj.lints.some(l => l.includes('Unreached objective')));
        assert.ok(proj.lints.some(l => l.startsWith('Orphan link l1')));
    });

    void it('nests sub-objectives beneath the apex they drive', () => {
        const proj = projectTable(ontology(
            [
                node('apex', 'objective', 'Apex'),
                node('sub', 'objective', 'Sub'),
                node('k', 'kpi', 'K'),
                node('p', 'process', 'P'),
                node('r', 'resource', 'R'),
            ],
            [
                link('l1', 'sub', 'apex', 'drives'),
                link('l2', 'k', 'sub', 'drives'),
                link('l3', 'k', 'p', 'measures'),
                link('l4', 'p', 'r', 'produces'),
                link('l5', 'p', 'r', 'uses'),
            ],
        ));
        const apex = proj.groups.find(g => g.name === 'Apex')!;
        assert.equal(apex.depth, 0);
        assert.equal(apex.children.length, 1);
        const sub = apex.children[0]!;
        assert.equal(sub.name, 'Sub');
        assert.equal(sub.depth, 1);
        // P reaches Sub via K, and Apex transitively through the drives chain.
        assert.equal(sub.processCount, 1);
        assert.equal(apex.processCount, 1);
    });

    void it('empty ontology projects to an empty table', () => {
        const proj = projectTable(ontology([], []));
        assert.equal(proj.processCount, 0);
        assert.deepEqual(proj.groups, []);
    });
});
