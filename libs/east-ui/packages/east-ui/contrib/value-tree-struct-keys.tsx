/** @jsxImportSource @elaraai/east-ui */
// Scratch: visual check for #515 — struct-keyed dict entries label as
// " · "-joined field summaries while their VALUES stay editable.
import { East, DictType, IntegerType, NullType, StringType, StructType } from "@elaraai/east";
import { ValueTree, UIComponentType } from "@elaraai/east-ui";

const MachineKey = StructType({ machine: StringType, line: StringType, shift: IntegerType });
const MachinesType = DictType(MachineKey, StructType({ units: IntegerType, note: StringType }));

export const structKeyedTree = East.function([], UIComponentType, (_$) => (
    <ValueTree
        value={East.value(new Map([
            [{ machine: "press", line: "L4", shift: 2n }, { units: 1980n, note: "serviced" }],
            [{ machine: "mill", line: "L2", shift: 2n }, { units: 1980n, note: "aligned" }],
            [{ machine: "oven", line: "L7", shift: 1n }, { units: 640n, note: "" }],
        ]), MachinesType)}
        onUpdate={East.function([MachinesType], NullType, (_$h, _next) => null)}
        style={{ openDepth: 2n, toolbar: true }}
    />
));
