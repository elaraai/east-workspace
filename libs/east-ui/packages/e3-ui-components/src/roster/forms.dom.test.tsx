/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { none, variant } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { act, assignment, card, mount, rosterHarness, settle, slot, START, width } from "./harness.test-utils.js";
const h = rosterHarness();
const press = async (node: Element) => { await act(async () => { fireEvent.click(node); }); await settle(); };
const save = async (c: HTMLElement) => press(within(slot(c, 'toolbar')).getByRole('button', { name: 'Save' }));
// Zag writes numeric text on animation frames. Let the host echo settle
// between keystrokes, as the shared number-input regression tests do.
async function typeNumber(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, text: string) {
    await user.clear(input); await settle();
    for (const key of text) {
        await user.type(input, key);
        await settle();
        await act(async () => { for (let i = 0; i < 3; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    }
    expect((input as HTMLInputElement).value).toBe(text);
}
describe('Roster shared and custom forms', () => {
    test('typed custom assignment and target callbacks use the same history and whole-week Save', async () => {
        const { container } = mount(ex.rosterCustomInspector); await settle(); const user = userEvent.setup();
        await press(assignment(container, 's37'));
        const overtime = within(slot(container, 'end')).getByRole('spinbutton', { name: 'Custom overtime' });
        await typeNumber(user, overtime, '1.5');
        expect(assignment(container, 's37').hasAttribute('data-drafted')).toBe(true);
        expect(h.read(ex.rosterWeeks).get(START)!.assignments.get('s37')!.overtime).toBe(0);
        const requirement = slot(container, 'main').querySelector('[data-roster-requirement]')!;
        await press(requirement);
        const positions = within(slot(container, 'end')).getByRole('spinbutton', { name: 'Custom positions' });
        await typeNumber(user, positions, '20');
        await save(container);
        const week = h.read(ex.rosterWeeks).get(START)!;
        expect(week.assignments.get('s37')!.overtime).toBe(1.5);
        expect(week.assignments.get('s37')!.agreed.type).toBe('none');
        expect(week.requirements.get({ day: 4n, group: 'inbound', shift: 'early' })!.positions).toBe(20n);
        expect(week.assignments.size).toBe(316);
    });
    test('live configuration and proposals refresh without replacing a pending assignment', async () => {
        const { container } = mount(ex.rosterWarehouse); await settle();
        await press(within(assignment(container, 's37')).getByRole('button', { name: 'Remove C. Clover' }));
        const cfg = h.read(ex.rosterConfiguration);
        await h.commit(ex.rosterConfiguration, { ...cfg, groups: cfg.groups.map(g => ({ ...g, label: g.key === 'inbound' ? 'Receiving' : g.label })) });
        await h.commit(ex.rosterProposals, []);
        expect(slot(container, 'main').textContent).toContain('Receiving');
        expect(slot(container, 'main').querySelector('[data-roster-proposal]')).toBeNull();
        expect(assignment(container, 's37').hasAttribute('data-removed')).toBe(true);
        await save(container); expect(h.read(ex.rosterWeeks).get(START)!.assignments.has('s37')).toBe(false);
    });
    test('mobile agency requests remain restorable in People view', async () => {
        const weeks = h.read(ex.rosterWeeks), week = weeks.get(START)!;
        week.assignments.set('request', { slot: { day: 4n, group: 'inbound', shift: 'early' }, who: variant('request', 'northside'), position: 'crew', activity: none, offset: 0, overtime: 0, agreed: none });
        // The stored request is deliberately changed below through the same remove/restore commands.
        await h.commit(ex.rosterWeeks, weeks);
        const { container } = mount(ex.rosterPeople); await settle();
        // Hide named staff through the shared Slice so the request row is in
        // the mounted virtual window; filtering must not hide agency requests.
        await userEvent.setup().type(within(slot(container, 'toolbar')).getByPlaceholderText('Search…'), 'no staff match');
        await settle(); await width(390);
        await press(within(card(container, 'request')).getByRole('button', { name: 'Remove' }));
        expect(within(card(container, 'request')).getByRole('button', { name: 'Restore' })).not.toBeNull();
        await press(within(card(container, 'request')).getByRole('button', { name: 'Restore' }));
        expect(within(card(container, 'request')).getByRole('button', { name: 'Remove' })).not.toBeNull();
    });
});
