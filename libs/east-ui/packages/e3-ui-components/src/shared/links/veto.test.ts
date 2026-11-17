/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The host's veto of a connection (`connectVetoOf`): its words refuse a
 * candidate and none allows it; each candidate is asked once; an end it can't
 * name, and a veto that throws, allow.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { none, some, type option } from "@elaraai/east";
import { connectVetoOf, type ConnectVetoFn } from "./veto.js";

/** An end as these vetoes hear it. */
interface Ref { readonly kind: string; readonly key: string }

const REFS: Readonly<Record<string, Ref>> = { a: { kind: "job", key: "a" }, b: { kind: "binding", key: "b" } };
const refOf = (id: string): Ref | undefined => REFS[id];

afterEach(() => { vi.restoreAllMocks(); });

describe("connectVetoOf", () => {
    test("no veto allows every connection", () => {
        expect(connectVetoOf<Ref>(undefined, refOf, "Plan")("feed", "a", "b")).toBeUndefined();
    });

    test("the veto hears the kind and both ends by their refs; its words refuse, and none allows", () => {
        const heard: { kind: string; from: Ref; to: Ref }[] = [];
        const veto: ConnectVetoFn<Ref> = (candidate): option<string> => {
            heard.push(candidate);
            return candidate.to.kind === "job" ? some("A feed ends at a bindery job") : none;
        };
        const ask = connectVetoOf(veto, refOf, "Plan");
        expect(ask("feed", "a", "b")).toBeUndefined();
        expect(ask("feed", "b", "a")).toBe("A feed ends at a bindery job");
        expect(heard).toEqual([{ kind: "feed", from: REFS.a, to: REFS.b }, { kind: "feed", from: REFS.b, to: REFS.a }]);
    });

    test("each candidate is asked once: a pointer's moves over one target never ask again", () => {
        const veto = vi.fn((): option<string> => some("No"));
        const ask = connectVetoOf<Ref>(veto, refOf, "Plan");
        expect([ask("feed", "a", "b"), ask("feed", "a", "b"), ask("feed", "a", "b")]).toEqual(["No", "No", "No"]);
        expect(veto).toHaveBeenCalledTimes(1);
        // Another kind over the same ends is another candidate.
        ask("runoff", "a", "b");
        expect(veto).toHaveBeenCalledTimes(2);
    });

    test("an end the builder can't name is allowed, the veto unasked", () => {
        const veto = vi.fn((): option<string> => some("No"));
        expect(connectVetoOf<Ref>(veto, refOf, "Plan")("feed", "a", "gone")).toBeUndefined();
        expect(veto).not.toHaveBeenCalled();
    });

    test("a veto that throws is logged, naming the builder, and allows: a broken veto never blocks editing", () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        const ask = connectVetoOf<Ref>(() => { throw new Error("boom"); }, refOf, "Plan");
        expect(ask("feed", "a", "b")).toBeUndefined();
        expect(logged).toHaveBeenCalledTimes(1);
        expect(logged.mock.calls[0]![0]).toBe("[Plan] canConnect veto failed (allowing):");
    });
});
