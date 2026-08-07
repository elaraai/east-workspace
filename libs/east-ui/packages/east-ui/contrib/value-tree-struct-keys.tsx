/** @jsxImportSource @elaraai/east-ui */
// Scratch: visual check for #515 — struct-keyed dict entries label as
// " · "-joined field summaries while their VALUES stay editable.
import { East, DictType, IntegerType, NullType, StringType, StructType } from "@elaraai/east";
import { ValueTree, UIComponentType } from "@elaraai/east-ui";

const LegKey = StructType({ tank: StringType, side: StringType, vintage: IntegerType });
const LegsType = DictType(LegKey, StructType({ litres: IntegerType, note: StringType }));

export const structKeyedTree = East.function([], UIComponentType, (_$) => (
    <ValueTree
        value={East.value(new Map([
            [{ tank: "DC4B", side: "from", vintage: 2024n }, { litres: 1980n, note: "racked" }],
            [{ tank: "DC2E", side: "to", vintage: 2024n }, { litres: 1980n, note: "topped" }],
            [{ tank: "BG7", side: "from", vintage: 2025n }, { litres: 640n, note: "" }],
        ]), LegsType)}
        onUpdate={East.function([LegsType], NullType, (_$h, _next) => null)}
        style={{ openDepth: 2n, toolbar: true }}
    />
));
