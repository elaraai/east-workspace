/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
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
    test("the check's refusal holding Save is listed and reachable (#1525): the warning button selects its duty, its panel shows it over the form, the field it names taking the keyboard, the Issues tab lists it first in any view, and a cost centre clears it", async () => {
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
        // The field it names takes the keyboard, so it is in view in its pane, ready to be set right (#1585).
        expect(document.activeElement).toBe(costCentre());
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
        await waitFor(() => expect(document.activeElement).toBe(costCentre()));
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
    test("a refusal of a duty whose draft stands in another week than the record's is named by its draft's day, and pressed shows it there, selected, the refusal over its form (#1584)", async () => {
        const { container } = await h.mount(ex.rosterWarehouse); const user = userEvent.setup();
        const toolbar = () => within(slot(container, 'toolbar'));
        const end = () => slot(container, 'end');
        // A. Alder's Saturday early, its cost centre cleared — the warehouse's check on a draft refuses it — and moved to the late shift.
        await press(toolbar().getByRole('radio', { name: 'Sat' }));
        await press(assignment(container, 's4'));
        const costCentre = within(end().querySelector<HTMLElement>('[data-field="costCentre"]')!).getByRole('textbox');
        await user.clear(costCentre); await user.type(costCentre, '{Enter}'); await settle();
        await press(within(end()).getByRole('radio', { name: 'Late' }));
        // Another session's save moves it to the next week's Sunday: its times conflict with the draft's, which stand on Saturday.
        const duties = await h.read(ex.rosterDuties);
        duties.set('s4', { ...duties.get('s4')!, start: at('2028-03-12T06:00:00'), end: at('2028-03-12T14:00:00') });
        await h.patch(ex.rosterDuties, duties);
        await waitFor(() => expect(container.querySelector('[data-session-banner="conflicts"]')).not.toBeNull());
        // The next week, where the record holds it now: the refusal is the draft's, named by its Saturday's late.
        await act(async () => { fireEvent.keyDown(slot(container, 'main'), { key: ']' }); }); await settle();
        await press(within(end()).getByRole('tab', { name: /^Issues/ }));
        const line = end().querySelector('[data-roster-issue="refusal"] button');
        expect(line?.textContent).toBe('A. Alder · Sat, Mar 11, 2028 · Late');
        await press(line);
        expect(toolbar().getByRole('radio', { name: 'Sat' }).getAttribute('aria-checked')).toBe('true');
        const details = () => end().querySelector('[data-roster-inspector="details"]');
        await waitFor(() => expect(details()?.querySelector('[data-roster-refusals]')).not.toBeNull());
        expect(assignment(container, 's4').hasAttribute('data-selected')).toBe(true);
    });
    test("a duty's start is held to its day: twelve hours after its shift's start is the next day's, so it is refused — its box back at the start the duty holds, the reason under it — and the duty stays on its day (#1584, #1585)", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        const toolbar = () => within(slot(container, 'toolbar'));
        const end = () => slot(container, 'end');
        const segment = (field: string, name: string) => within(end().querySelector<HTMLElement>(`[data-field="${field}"]`)!).getAllByRole('spinbutton')
            .find(s => s.getAttribute('aria-label')?.startsWith(name))!;
        // A. Alder's Saturday early: its end on to 11 PM, then its start to 6 PM, twelve hours past its shift's.
        await press(toolbar().getByRole('radio', { name: 'Sat' }));
        await press(assignment(container, 's4'));
        for (let i = 0; i < 9; i++) { await act(async () => { fireEvent.keyDown(segment('end', 'hour'), { key: 'ArrowUp' }); }); await settle(); }
        await act(async () => { fireEvent.focusOut(segment('end', 'hour')); }); await settle();
        await act(async () => { fireEvent.keyDown(segment('start', 'AM/PM'), { key: 'ArrowUp' }); }); await settle();
        expect(segment('start', 'AM/PM').textContent).toBe('PM');
        await act(async () => { fireEvent.focusOut(segment('start', 'AM/PM')); }); await settle();
        // Refused: the box shows the 6 AM the duty holds again, never the 6 PM it refused, and the field says why — once,
        // under it, never again under the form.
        expect([segment('start', 'hour').textContent, segment('start', 'AM/PM').textContent]).toEqual(['6', 'AM']);
        expect(end().querySelector('[data-field="start"] [data-part="error-text"]')?.textContent)
            .toBe("A duty starts up to 12 hours before its shift's start, or less than 12 hours after it.");
        expect(end().querySelector('[data-roster-inspector="details"] [role="alert"]')).toBeNull();
        // Its later end taken, its start refused: still Saturday's early, never moved to Sunday's.
        expect(cell(container, 6, 'inbound', 'early').contains(assignment(container, 's4'))).toBe(true);
        expect([assignment(container, 's4').hasAttribute('data-drafted'), assignment(container, 's4').hasAttribute('data-removed')]).toEqual([true, false]);
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
