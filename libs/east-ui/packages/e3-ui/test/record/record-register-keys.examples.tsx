/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/east-ui */

/**
 * The Record over registers keyed by number (east-workspace#1747): machines,
 * each naming the line it runs on by the line's number, the operator on it by
 * badge number — or no one — and the shift it runs by its number in the day.
 * Each register reads its Dict's own Integer key, and each column shows its
 * members' names and keeps the number: a pick writes the Integer, and so does
 * Save. A number no member has shows as East prints it, marked.
 */

import { DictType, East, IntegerType, OptionType, StringType, StructType, example, none, some } from "@elaraai/east";
import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Data, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

/** A production line, keyed by its number. */
export const Line = StructType({ name: StringType });

/** An operator, keyed by badge number. */
export const Operator = StructType({ name: StringType });

/** A shift, keyed by its number in the day. */
export const Shift = StructType({ name: StringType });

/** A machine: the line it runs on, the operator on it — or no one — and the shift it runs, each by its number. */
export const Machine = StructType({ name: StringType, line: IntegerType, operator: OptionType(IntegerType), shift: IntegerType });

/** The lines, by number. */
export const recordLines = e3.record("record_register_lines", DictType(IntegerType, Line), {
    initial: new Map([[1n, { name: "Assembly" }], [2n, { name: "Packing" }], [3n, { name: "Finishing" }]]),
});

/** The operators, by badge number. */
export const recordOperators = e3.record("record_register_operators", DictType(IntegerType, Operator), {
    initial: new Map([[104n, { name: "A. Morgan" }], [117n, { name: "B. Ellis" }], [121n, { name: "C. Patel" }]]),
});

/** The shifts, by their number in the day. */
export const recordShifts = e3.record("record_register_shifts", DictType(IntegerType, Shift), {
    initial: new Map([[1n, { name: "Early" }], [2n, { name: "Late" }], [3n, { name: "Night" }]]),
});

/** The machines. The sander names line 4, which no line has. */
export const recordMachines = e3.record("record_register_machines", DictType(StringType, Machine), {
    initial: new Map([
        ["M-10", { name: "Press A", line: 1n, operator: some(104n), shift: 1n }],
        ["M-11", { name: "Press B", line: 1n, operator: none, shift: 2n }],
        ["M-20", { name: "Wrapper", line: 2n, operator: some(117n), shift: 1n }],
        ["M-30", { name: "Sander", line: 4n, operator: some(121n), shift: 3n }],
    ]),
    mutations: (mutation) => ({
        // The machines' patch door — every Save commits through it.
        patch: mutation.patch(),
    }),
});

export const recordMachinesByLine = example({
    keywords: ["Record", "register", "Record.register.members", "Integer key", "number key", "typed key", "key type", "Dict", "enum", "person", "cycle",
        "reference", "dropdown", "label", "keeps the key", "Option", "unassigned", "no member", "#1747"],
    description: "A Record whose registers are keyed by number: machines each naming the line they run on by the line's number, the operator on them by badge number (or no one) and the shift they run by its number in the day. Each register reads its Dict's own Integer key as its members' keys — `key: (_line, number) => number` — and the enum, person and cycle columns over them sit on Integer fields, and an Option of one: each shows its members' names, offers them in the register's order, and keeps the number, so a pick writes the Integer and Save's patch carries it. A number no member has (the sander's line 4) shows as East prints it, marked",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const machines = $.let(Record.bind(recordMachines));
            const lines = $.let(Data.bind(recordLines));
            const operators = $.let(Data.bind(recordOperators));
            const shifts = $.let(Data.bind(recordShifts));
            return (
                <Box height="360px">
                    <Record
                        record={machines}
                        title="Machines"
                        noun={{ singular: "machine", plural: "machines" }}
                        registers={{
                            // Each keyed by its Dict's own Integer key: a line by its number, an operator by badge, a shift by its number in the day.
                            lines: Record.register.members(lines.read(), { kind: "line", key: (_line, number) => number, label: (line) => line.name }),
                            operators: Record.register.members(operators.read(), {
                                kind: "operator", key: (_operator, badge) => badge, label: (operator) => operator.name, meta: (_operator, badge) => some(East.str`badge ${badge}`),
                            }),
                            shifts: Record.register.members(shifts.read(), { kind: "shift", key: (_shift, number) => number, label: (shift) => shift.name }),
                        }}
                        columns={{
                            name:     Record.column.title(Machine, { header: "Machine", width: "180px" }),
                            // A dropdown of the lines' names over an Integer field: a pick writes the line's number.
                            line:     Record.column.enum(Machine, "lines", { header: "Line", width: "160px" }),
                            // An operator by badge, or no one: an Option of the register's key.
                            operator: Record.column.person(Machine, "operators", { header: "Operator", width: "180px", unassigned: "No one" }),
                            // A click steps to the next shift, in the register's order.
                            shift:    Record.column.cycle(Machine, "shifts", { header: "Shift", width: "120px" }),
                        }}
                        name="recordMachinesByLine"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
