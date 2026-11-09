/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { equalFor, none, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import {
    act, assignment, at, card, cell, drop, libraryCard, narrow, open, press, rosterHarness, settle, slot, START, weekDuties, width, type Choice,
} from "./harness.test-utils.js";
const h = rosterHarness();
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
    test("the duty kind's and the targets' own forms use the same history, and Save writes each record's rows", async () => {
        const { container } = await h.mount(ex.rosterCustomInspector); const user = userEvent.setup();
        const before = await h.read(ex.rosterDuties);
        await press(assignment(container, 's37'));
        const unpaid = within(slot(container, 'end')).getByRole('spinbutton', { name: 'Custom unpaid break' });
        await typeNumber(user, unpaid, '30');
        expect(assignment(container, 's37').hasAttribute('data-drafted')).toBe(true);
        expect((await h.read(ex.rosterDuties)).get('s37')!.unpaidBreak).toBe(0);
        const requirement = slot(container, 'main').querySelector('[data-roster-requirement]')!;
        await press(requirement);
        const heads = within(slot(container, 'end')).getByRole('spinbutton', { name: 'Custom heads' });
        await typeNumber(user, heads, '20');
        await save(container);
        const duties = await h.read(ex.rosterDuties);
        // The duty's own form wrote its field, and every other field of the row as it was.
        expect(equalFor(ex.WarehouseDuty)(duties.get('s37')!, { ...before.get('s37')!, unpaidBreak: 30 })).toBe(true);
        expect(weekDuties(duties, START).size).toBe(316);
        // The target's own form wrote its row: its heads, and what it rests on.
        const cover = (await h.read(ex.rosterCover)).get('2028-03-09-inbound-early')!;
        expect([cover.heads, cover.basis]).toEqual([20n, 'planner']);
    });
    test("a new duty's own fields are the app's `values` of it (#1526): a request and a person assigned on eight-hour shifts save at once, each with half an hour's break and its team's cost centre, with no edit in its form", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        const before = await h.read(ex.rosterDuties);
        await drop(await libraryCard(container, 'Northside Staffing'), cell(container, 4, 'dispatch', 'early'));
        await drop(await libraryCard(container, 'N. Ochre'), cell(container, 4, 'inbound', 'late'));
        // Each has its team's cost centre: the warehouse's check on a draft holds nothing.
        expect(within(slot(container, 'toolbar')).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false);
        await save(container);
        const added = [...(await h.read(ex.rosterDuties))].filter(([key]) => !before.has(key))
            .map(([, duty]) => [duty.team, duty.shift, duty.unpaidBreak, duty.agreed, duty.costCentre, duty.note]);
        expect(added).toHaveLength(2);
        expect(added).toEqual(expect.arrayContaining([['dispatch', 'early', 30, none, 'CC-DS', ''], ['inbound', 'late', 30, none, 'CC-IN', '']]));
    });
    test("a cover target added on a slot with none saves what the app's `values` give it (#1526): `basis: \"planner\"`", async () => {
        // The forecast left Thursday's inbound early without a target: one added there is the planner's.
        const cover = await h.read(ex.rosterCover);
        cover.delete('2028-03-09-inbound-early');
        await h.patch(ex.rosterCover, cover);
        const { container } = await h.mount(ex.rosterWarehouse); const user = userEvent.setup();
        await press(slot(container, 'main').querySelector('[data-roster-requirement]'));
        await typeNumber(user, within(slot(container, 'end')).getByRole('spinbutton', { name: 'Positions' }), '12');
        // A form's number commits with Enter.
        await user.keyboard('{Enter}'); await settle();
        await save(container);
        const added = [...(await h.read(ex.rosterCover))].filter(([key]) => !cover.has(key)).map(([, row]) => [row.team, row.shift, row.heads, row.basis]);
        expect(added).toEqual([['inbound', 'early', 12n, 'planner']]);
    });
    test("the app's check holds Save while a duty has no cost centre, and Save writes the one its form gives", async () => {
        const { container } = await h.mount(ex.rosterWarehouse); const user = userEvent.setup();
        const before = await h.read(ex.rosterDuties);
        const saveButton = () => within(slot(container, 'toolbar')).getByRole('button', { name: 'Save' });
        await drop(await libraryCard(container, 'Northside Staffing'), cell(container, 4, 'inbound', 'night'));
        await press(slot(container, 'main').querySelector('[data-roster-assignment][data-request][data-drafted]'));
        const costCentre = () => within(slot(container, 'end').querySelector<HTMLElement>('[data-field="costCentre"]')!).getByRole('textbox');
        // Its team's, from the app's `values`; cleared, the warehouse's check on a draft holds Save.
        expect((costCentre() as HTMLInputElement).value).toBe('CC-IN');
        await user.clear(costCentre()); await user.type(costCentre(), '{Enter}'); await settle();
        expect(saveButton()).toHaveProperty('disabled', true);
        await user.type(costCentre(), 'CC-NIGHT{Enter}');
        await settle();
        expect(saveButton()).toHaveProperty('disabled', false);
        await save(container);
        const added = [...(await h.read(ex.rosterDuties))].filter(([key]) => !before.has(key)).map(([, duty]) => duty.costCentre);
        expect(added).toEqual(['CC-NIGHT']);
    });
    test("the check's refusal holding Save is listed and reachable (#1525): the warning button selects its duty, its panel shows it over the form, the Issues tab lists it first in any view, and a cost centre clears it", async () => {
        const { container } = await h.mount(ex.rosterWarehouse); const user = userEvent.setup();
        const toolbar = () => within(slot(container, 'toolbar'));
        const end = () => slot(container, 'end');
        const chip = () => Number.parseInt(slot(container, 'toolbar').querySelector('[data-roster-issues]')?.getAttribute('aria-label') ?? '0', 10);
        await press(within(cell(container, 4, 'inbound', 'night')).getByRole('button', { name: 'Request Northside Staffing' }));
        const request = () => slot(container, 'main').querySelector('[data-roster-assignment][data-request][data-drafted]');
        // Its cost centre, the app's `values` gave it, cleared: the warehouse's check on a draft refuses it, and holds Save.
        const costCentre = () => within(end().querySelector<HTMLElement>('[data-field="costCentre"]')!).getByRole('textbox');
        await user.clear(costCentre()); await user.type(costCentre(), '{Enter}'); await settle();
        expect(toolbar().getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
        // Another duty selected, so the warning button's choice is its own.
        await press(assignment(container, 's37'));
        expect(request()?.hasAttribute('data-selected')).toBe(false);
        // The chip counts it with the breaches and the gaps: one fewer once it clears.
        const counted = chip();
        // The history's warning button: the refused duty selected, its Details showing the refusal over its form, the field ringed.
        await press(toolbar().getByRole('button', { name: editingMessages.issues({ n: 1, count: '1' }) }));
        expect(request()?.hasAttribute('data-selected')).toBe(true);
        const details = () => end().querySelector('[data-roster-inspector="details"]');
        expect(details()?.querySelector('[data-roster-refusals]')?.textContent).toContain('Cost centre: Give the duty a cost centre');
        expect([...details()!.querySelectorAll('[data-issue]')].map(el => el.getAttribute('data-field'))).toEqual(['costCentre']);
        // The Issues tab lists it first, by its duty's person, day and shift — whatever day the view shows.
        await press(toolbar().getByRole('radio', { name: 'Fri' }));
        await press(within(end()).getByRole('tab', { name: /^Issues/ }));
        const issues = end().querySelector('[data-roster-inspector="issues"]')!;
        expect(issues.textContent).toContain('Not saved yet · 1');
        const line = issues.querySelector('[data-roster-issue]')!;
        expect(line.getAttribute('data-roster-issue')).toBe('refusal');
        expect([line.querySelector('button')?.textContent, line.lastElementChild?.textContent])
            .toEqual(['Requested · Northside Staffing · Thu, Mar 9, 2028 · Night', 'Cost centre: Give the duty a cost centre']);
        // Pressed, its duty is shown on its day and selected, the refusal over its form.
        await press(line.querySelector('button'));
        expect(toolbar().getByRole('radio', { name: 'Thu' }).getAttribute('aria-checked')).toBe('true');
        expect(request()?.hasAttribute('data-selected')).toBe(true);
        expect(details()?.querySelector('[data-roster-refusals]')).not.toBeNull();
        // A cost centre clears it: Save on, and nothing left over the form.
        await user.type(within(end().querySelector<HTMLElement>('[data-field="costCentre"]')!).getByRole('textbox'), 'CC-IN{Enter}');
        await settle();
        expect(toolbar().getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false);
        expect(details()?.querySelector('[data-roster-refusals]')).toBeNull();
        expect(chip()).toBe(counted - 1);
    });
    test("a refusal pressed in Month opens its duty's week in Week, the duty selected and the refusal over its form — never the month's first week's Summary (#1584)", async () => {
        const { container } = await h.mount(ex.rosterWarehouse); const user = userEvent.setup();
        const toolbar = () => within(slot(container, 'toolbar'));
        const end = () => slot(container, 'end');
        // Its cost centre cleared: the warehouse's check on a draft refuses the duty, on the Thursday of the month's second week.
        await press(assignment(container, 's37'));
        const costCentre = within(end().querySelector<HTMLElement>('[data-field="costCentre"]')!).getByRole('textbox');
        await user.clear(costCentre); await user.type(costCentre, '{Enter}'); await settle();
        expect(toolbar().getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
        await press(toolbar().getByRole('radio', { name: 'People' }));
        await press(toolbar().getByRole('radio', { name: 'Month' }));
        expect(slot(container, 'main').querySelector('[data-roster-grid="people-month"]')).not.toBeNull();
        await press(within(end()).getByRole('tab', { name: /^Issues/ }));
        const line = end().querySelector('[data-roster-issue="refusal"] button');
        expect(line?.textContent).toBe('C. Clover · Thu, Mar 9, 2028 · Early');
        await press(line);
        // Its week in Week, and once that week is read the duty selected: its Details, the refusal over its form.
        expect(toolbar().getByRole('radio', { name: 'Week' }).getAttribute('aria-checked')).toBe('true');
        expect(slot(container, 'main').querySelector('[data-roster-column-header]')!.textContent).toMatch(/^Sun\s*5$/);
        const details = () => end().querySelector('[data-roster-inspector="details"]');
        await waitFor(() => expect(details()?.querySelector('[data-roster-refusals]')).not.toBeNull());
        expect(details()?.querySelector('[data-inspector-title]')?.textContent).toBe('C. Clover');
    });
    test('live configuration and suggestions refresh without replacing a pending duty', async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        await press(within(assignment(container, 's37')).getByRole('button', { name: 'Remove C. Clover' }));
        const teams = await h.read(ex.rosterTeams);
        teams.set('inbound', { ...teams.get('inbound')!, label: 'Receiving' });
        await h.patch(ex.rosterTeams, teams);
        await h.patch(ex.rosterSuggestions, new Map());
        expect(slot(container, 'main').textContent).toContain('Receiving');
        expect(slot(container, 'main').querySelector('[data-roster-proposal]')).toBeNull();
        expect(assignment(container, 's37').hasAttribute('data-removed')).toBe(true);
        await save(container); expect((await h.read(ex.rosterDuties)).has('s37')).toBe(false);
    });
    test('mobile agency requests remain restorable in People view', async () => {
        const duties = await h.read(ex.rosterDuties);
        duties.set('request', { who: variant('agency', 'northside'), start: at('2028-03-09T06:00:00'), end: at('2028-03-09T14:00:00'), shift: 'early', team: 'inbound',
            role: 'crew', task: none, unpaidBreak: 0, agreed: none, costCentre: 'CC-IN', note: '' });
        // The stored request is deliberately changed below through the same remove/restore commands.
        await h.patch(ex.rosterDuties, duties);
        const { container, store } = await open(ex.rosterPeople);
        // Hide named staff through the rail's people source so the request row is
        // in the mounted virtual window; narrowing must not hide agency requests.
        await narrow(store, 'rosterPeople', 'people', new Map<string, Choice>([['name', variant('prefix', 'Z. Nobody')]]));
        await width(390);
        await press(within(card(container, 'request')).getByRole('button', { name: 'Remove' }));
        expect(within(card(container, 'request')).getByRole('button', { name: 'Restore' })).not.toBeNull();
        await press(within(card(container, 'request')).getByRole('button', { name: 'Restore' }));
        expect(within(card(container, 'request')).getByRole('button', { name: 'Remove' })).not.toBeNull();
    });
});
