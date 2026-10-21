/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An app's fit as a builder asks it on e3 (#1376): the example's own
 * `e3.function`, called by name through the shared `Func` runtime
 * (`use-fit.ts`). What the builder asked is each call's body, decoded by the
 * fit's request type; what e3 answered, each answer a tap kept through the
 * test, decoded by its result type; and a fit held or failed is a fault at the
 * harness's fetch. The Roster's Find fixes and the Allocation's board ask
 * through it.
 *
 * @packageDocumentation
 */

import { beforeEach } from "vitest";
import { decodeBeast2For, type EastType, type ValueTypeOf } from "@elaraai/east";
import { ExecuteResultType, FunctionCallRequestType, ResponseType } from "@elaraai/e3-types";
import type { E3Answer, E3Hold, E3Match, E3Request } from "../../e3-web.test-utils.js";
import type { E3Harness } from "../../e3-web-mount.test-utils.js";

/**
 * A call of an app's fit: its POST by the function's name, as e3's client
 * sends a builder's question — of any fit when no name is given. A listing of
 * the functions, which the runtime makes first, is none.
 *
 * @param name - The fit's `e3.function` name
 * @returns The match
 */
export const isFitCall = (name?: string): E3Match => (request) =>
    request.kind === "call" && request.method === "POST" && request.name !== undefined && (name === undefined || request.name === name);

/**
 * A builder's fit, as it asks it on e3: each method takes a fit's
 * `e3.function` name, and given none is every fit's.
 *
 * @typeParam Q - A question, decoded
 * @typeParam R - An answer, decoded
 */
export interface FitCalls<Q, R> {
    /** How many calls of the fit the builder has made in the test so far. */
    calls(name?: string): number;
    /** Each question the builder has asked the fit in the test so far, in order, as its call's body says. */
    requests(name?: string): Q[];
    /** Each answer e3 has given the fit in the test so far, in the order they came. */
    answers(name?: string): R[];
    /** Holds each call of the fit on its way to e3, from now until released. */
    hold(name?: string): E3Hold;
    /**
     * Answers each call of the fit as e3 answers one it cannot serve now
     * (`503`, `unavailable`), from now until the returned function stops it.
     */
    fail(name?: string): () => void;
}

/**
 * A builder's fit on e3, over the file's harness: called as the file is
 * collected, after its `e3Harness`, so each test's tap of the answers starts
 * as the test does.
 *
 * @param h - The file's harness
 * @param types - The fit's request and result types
 * @returns The fit's calls
 */
export function fitCalls<Q extends EastType, R extends EastType>(h: E3Harness, types: { readonly request: Q; readonly result: R }): FitCalls<ValueTypeOf<Q>, ValueTypeOf<R>> {
    const readCall = decodeBeast2For(FunctionCallRequestType);
    const readRequest = decodeBeast2For(types.request);
    const readExecuted = decodeBeast2For(ResponseType(ExecuteResultType));
    const readResult = decodeBeast2For(types.result);
    /** The question a call asked: its one argument, sent by value. */
    const questionOf = (request: E3Request): ValueTypeOf<Q> => {
        if (request.body === undefined) throw new Error(`${request.path} sent no body`);
        const [arg] = readCall(request.body).args;
        if (arg === undefined || arg.type !== "value") throw new Error(`${request.path} asked no question by value`);
        return readRequest(arg.value);
    };
    /** An answer e3 gave, decoded; a failure — e3's, or a fault's — is none. */
    const answerOf = (answer: E3Answer): ValueTypeOf<R>[] => {
        if (answer.status !== 200) return [];
        const response = readExecuted(answer.body);
        if (response.type !== "success" || response.value.outcome.type !== "success") return [];
        return [readResult(response.value.outcome.value.value)];
    };
    // Every fit's answers through the test, from its start: the harness's own beforeEach has let the last test's taps go.
    let kept: readonly E3Answer[] = [];
    beforeEach(() => { kept = h.e3.answers(isFitCall()); });
    return {
        calls: (name) => h.requests("call").filter(isFitCall(name)).length,
        requests: (name) => h.requests("call").filter(isFitCall(name)).map(questionOf),
        answers: (name) => kept.filter((answer) => isFitCall(name)(answer.request)).flatMap(answerOf),
        hold: (name) => h.e3.hold(isFitCall(name)),
        fail: (name) => h.e3.fail(isFitCall(name), { status: 503, type: "unavailable", message: "the fit's service is down" }),
    };
}
