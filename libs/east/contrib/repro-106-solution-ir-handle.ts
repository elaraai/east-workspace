/**
 * Issue #106 — the TRANSPARENT fix (proof of concept).
 *
 * Today a bind (State.bind etc.) returns {read,write,has} as RAW HOST CLOSURES
 * with no IR, so a captured handle can't be beast2-encoded.
 *
 * Fix: make a bind's methods COMPILED East.functions that call low-level
 * platform primitives (kv_read/kv_write/kv_has), capturing only the plain-data
 * key. Then the handle is ordinary serializable East data, and
 * decodeBeast2For({platform}) re-binds it to the DECODER's store for free.
 *
 * Run: cd libs/east && npx tsx contrib/repro-106-solution-ir-handle.ts
 */
import {
    East, FunctionType, StructType, FloatType, NullType, BooleanType, StringType,
} from "@elaraai/east";
import { encodeBeast2For, decodeBeast2For } from "@elaraai/east/internal";

// Low-level platform primitives over a host key-value store.
const kvRead = East.platform("kv_read", [StringType], FloatType);
const kvWrite = East.platform("kv_write", [StringType, FloatType], NullType);
const kvHas = East.platform("kv_has", [StringType], BooleanType);

// Two independent stores: the "encoder" store and the "decoder" store.
function makePlatform(store: Map<string, number>) {
    return [
        kvRead.implement((k: unknown) => store.get(k as string) ?? 0.0),
        kvWrite.implement((k: unknown, v: unknown) => { store.set(k as string, v as number); return null; }),
        kvHas.implement((k: unknown) => store.has(k as string)),
    ];
}
const storeEnc = new Map<string, number>();
const storeDec = new Map<string, number>();
const platformEnc = makePlatform(storeEnc);
const platformDec = makePlatform(storeDec);

// The handle TYPE is unchanged — a struct of {read,write,has}. What changes is
// that the methods are IR-bearing East.functions, not raw closures.
const HandleType = StructType({
    read: FunctionType([], FloatType),
    write: FunctionType([FloatType], NullType),
    has: FunctionType([], BooleanType),
});

// The new "bind": build the handle's methods as compiled East.functions that
// capture only `key` (plain data) and call the primitives.
function bind(key: string, platform: any[]) {
    const k = East.value(key, StringType);
    return {
        read: East.compile(East.function([], FloatType, ($) => { $.return(kvRead(k)); }), platform),
        write: East.compile(East.function([FloatType], NullType, ($, v) => { $.return(kvWrite(k, v)); }), platform),
        has: East.compile(East.function([], BooleanType, ($) => { $.return(kvHas(k)); }), platform),
    };
}

console.log("\n--- 1. The handle now ENCODES (methods carry IR) ---");
const handle = bind("probe", platformEnc);
let bytes: Uint8Array;
try {
    bytes = encodeBeast2For(HandleType)(handle);
    console.log(`  OK     handle encoded -> ${bytes.length} bytes`);
} catch (e) {
    console.log(`  THROW  ${(e as Error).message}`);
    process.exit(1);
}

console.log("\n--- 2. It DECODES against a DIFFERENT store and operates on THAT store ---");
const decoded = decodeBeast2For(HandleType, { platform: platformDec })(bytes) as {
    read: () => number; write: (v: number) => null; has: () => boolean;
};
decoded.write(7.0);
console.log(`  decoded.has()  = ${decoded.has()}   (decoder store has "probe")`);
console.log(`  decoded.read() = ${decoded.read()}   (reads decoder store)`);
console.log(`  storeDec.get("probe") = ${storeDec.get("probe")}   (write landed in DECODER store)`);
console.log(`  storeEnc.get("probe") = ${storeEnc.get("probe")}   (ENCODER store untouched -> re-bound correctly)`);

console.log("\n--- 3. THE ISSUE'S EXACT SHAPE now round-trips: onChange captures the handle ---");
const myBind = East.platform("my_bind", [StringType], HandleType);
// my_bind returns an IR-bearing handle built against the same primitives.
const platformEnc2 = [...platformEnc, myBind.implement((key: unknown) => bind(key as string, platformEnc))];
const PayloadType = StructType({ label: StringType, onChange: FunctionType([FloatType], NullType) });
const payload = East.compile(
    East.function([], PayloadType, ($) => {
        const probe = $.let(myBind("slider_value"));
        const onChange = East.function([FloatType], NullType, ($$, v) => { $$.return(probe.write(v)); });
        $.return(East.value({ label: "slider", onChange }, PayloadType));
    }),
    platformEnc2,
)();
const payloadBytes = encodeBeast2For(PayloadType)(payload);
console.log(`  OK     payload-with-captured-handle encoded -> ${payloadBytes.length} bytes`);
const payloadDec = decodeBeast2For(PayloadType, { platform: platformDec })(payloadBytes) as {
    label: string; onChange: (v: number) => null;
};
payloadDec.onChange(42.0);
console.log(`  payloadDec.onChange(42) -> storeDec.get("slider_value") = ${storeDec.get("slider_value")}   (callback wrote to DECODER store)`);
console.log("");
