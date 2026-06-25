/**
 * Repro for issue #106: which platform-output handles actually break beast2 encode,
 * and is it really about State vs Decision?
 *
 * The beast2 encoder is TYPE-DIRECTED. For any FunctionType slot it requires the
 * JS value to carry EAST_IR_SYMBOL (i.e. be a compiled East.function). A live
 * platform handle is a plain JS struct of host closures with NO IR, so the
 * encoder throws "Cannot serialize function: no IR attached"
 * (libs/east/src/serialization/beast2/index.ts:199).
 *
 * Run: cd libs/east && npx tsx contrib/repro-106-handle-encode.ts
 */
import {
    East, FunctionType, StructType, FloatType, IntegerType, NullType,
    BooleanType, StringType, ArrayType,
} from "@elaraai/east";
import { encodeBeast2For } from "@elaraai/east/internal";

function tryEncode(label: string, type: any, value: any): void {
    try {
        const bytes = encodeBeast2For(type)(value);
        console.log(`  OK     ${label}  ->  ${bytes.length} bytes`);
    } catch (e) {
        console.log(`  THROW  ${label}  ->  ${(e as Error).message}`);
    }
}

// A struct of {read,write,has} closures — the shape State.bind returns.
const HandleType = StructType({
    read: FunctionType([], FloatType),
    write: FunctionType([FloatType], NullType),
    has: FunctionType([], BooleanType),
});

console.log("\n--- A. direct encode of hand-built JS values (shows the type-directed rule) ---");

// 1. A genuine compiled East.function has IR -> encodes fine.
tryEncode(
    "compiled East.function (has IR)",
    FunctionType([IntegerType], IntegerType),
    East.compile(East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)), []),
);

// 2. State.bind LIVE handle shape: raw host closures, no IR.
tryEncode("State.bind handle {read,write,has} (raw closures)", HandleType,
    { read: () => 0.0, write: (_v: unknown) => null, has: () => true });

// 3. Decision.bind LIVE handle shape: also raw host closures (decisionHandleType()
//    is a struct full of FunctionType fields — bind.ts:139-159).
const DecisionLiveHandleType = StructType({
    queue: FunctionType([], ArrayType(StringType)),
    resolve: FunctionType([StringType], NullType),
    update: FunctionType([StringType], NullType),
    answer: FunctionType([StringType], NullType),
});
tryEncode("Decision.bind LIVE handle {queue,resolve,update,answer} (raw closures)", DecisionLiveHandleType,
    { queue: () => [], resolve: (_: unknown) => null, update: (_: unknown) => null, answer: (_: unknown) => null });

// 4. The escape hatch DecisionQueue already uses: a plain-data ref, no closures.
tryEncode("DecisionHandleRefType-style ref (plain data)", StructType({ decisions: ArrayType(StringType), judgements: StringType }),
    { decisions: ["task/roster"], judgements: "staged/judgements" });

console.log("\n--- B. FAITHFUL end-to-end: a REAL platform bind, run, then encoded ---");

// A real platform function that returns raw host closures (mirrors State.bind's
// runtime impl in east-ui-components/src/platform/state-runtime.ts).
const myBind = East.platform("my_bind", [StringType, FloatType], HandleType);
const store = new Map<string, number>();
const platform = [
    myBind.implement((key: unknown, def: unknown) => {
        const k = key as string;
        if (!store.has(k)) store.set(k, def as number);
        return {
            read: () => store.get(k)!,
            write: (v: unknown) => { store.set(k, v as number); return null; },
            has: () => store.has(k),
        };
    }),
];

// 5. Run a program that binds the handle and returns it; encode the live result.
const liveHandle = East.compile(
    East.function([], HandleType, ($) => { $.return(myBind("probe", 0.0)); }),
    platform,
)();
tryEncode("live handle produced by a real platform bind", HandleType, liveHandle);

// 6. THE ISSUE'S EXACT SHAPE: a payload struct whose onChange callback CAPTURES
//    the bound handle and writes through it (probe.write(v)). Run, then encode.
const PayloadType = StructType({ label: StringType, onChange: FunctionType([FloatType], NullType) });
const payload = East.compile(
    East.function([], PayloadType, ($) => {
        const probe = $.let(myBind("probe", 0.0));                                  // live handle
        const onChange = East.function([FloatType], NullType, ($$, v) => { $$.return(probe.write(v)); });
        $.return(East.value({ label: "slider", onChange }, PayloadType));           // capture in a struct
    }),
    platform,
)();
tryEncode("payload whose onChange callback captures the bound handle", PayloadType, payload);

console.log("");
