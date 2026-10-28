/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A record source's count handed to its builder as soon as it lands (#1398,
 * problem 23): pending is never a number, a failure says why, and the count
 * follows the narrowing and the record. Presented over a decoded handle and a
 * tracked boundary, as the rail's controls are; the count's own reads are the
 * record Slice's, with their contract tests.
 */

import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { IntegerType, decodeBeast2For, encodeBeast2For, none, some, type ValueTypeOf, type option } from "@elaraai/east";
import { RecordSliceConfigType, RecordSliceStateType, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { getStore, initializeStore, trackKey } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { useRecordSliceCount } from "./count.js";

type Bind = ValueTypeOf<RecordSliceBindType>;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** A source whose count the test answers, read through a tracked key a pulse moves, as a landing does. */
function fixture() {
    initializeStore(new UIStore());
    const config = decodeBeast2For(RecordSliceConfigType)(encodeBeast2For(RecordSliceConfigType)({
        fields: [], indexes: [], range: none, search: [], presets: [],
    }));
    const key = "record.count";
    const encode = encodeBeast2For(RecordSliceStateType);
    const decode = decodeBeast2For(RecordSliceStateType);
    getStore().write(key, encode({ where: new Map(), preset: none, resolution: none }));
    let revision = 0n;
    const pulse = () => getStore().write("network", encodeBeast2For(IntegerType)(++revision));
    let answer: () => option<bigint> = () => none;
    const count = vi.fn<Bind["count"]>(() => { trackKey("network"); return answer(); });
    const read = () => { trackKey(key); return decode(getStore().read(key)!); };
    const write = (state: ValueTypeOf<RecordSliceStateType>) => { getStore().write(key, encode(state)); return null; };
    const slice: Bind = { key, config, sourceId: "record", read, write,
        choose: () => null, range: () => null, prefix: () => null, clear: () => null, clearAll: () => null,
        count, countWhere: count, total: () => some(20n), domain: () => none, suggest: () => none, values: () => [],
        replaces: () => [], togglePreset: () => null, setResolution: () => null, retry: () => null,
        readEntry: () => some(none), contains: () => some(false), containsRow: () => some(false),
    };
    return { slice, pulse, answer: (next: () => option<bigint>) => { answer = next; } };
}

function Probe({ slice }: { slice: Bind | undefined }) {
    const { count, error } = useRecordSliceCount(slice);
    return <div data-probe="" data-count={count === undefined ? "pending" : String(count)} data-error={error} />;
}

const probe = () => document.querySelector("[data-probe]")!;

test("the count reaches the builder as soon as it lands: pending is never a number, and a failure says why", () => {
    const f = fixture();
    render(<Probe slice={f.slice} />);
    expect(probe().getAttribute("data-count")).toBe("pending");
    f.answer(() => some(16_667n));
    act(f.pulse);
    expect(probe().getAttribute("data-count")).toBe("16667");
    f.answer(() => { throw new Error("offline"); });
    act(f.pulse);
    expect([probe().getAttribute("data-count"), probe().getAttribute("data-error")]).toEqual(["pending", "offline"]);
});

test("with no source there is nothing to count, and nothing is read", () => {
    render(<Probe slice={undefined} />);
    expect([probe().getAttribute("data-count"), probe().hasAttribute("data-error")]).toEqual(["pending", false]);
});
