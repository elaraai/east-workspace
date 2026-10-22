/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A value read after its dataset moved on — the status named one hash, and the
 * read answered another's value — is kept under the hash the response names,
 * and never shown as the hash that was asked for: a return to that hash (a
 * toggled input) would show the other value. On e3 itself (#1377): the
 * dataset moves on as another session writes it.
 */

import { describe, test, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IntegerType, toEastTypeValue } from "@elaraai/east";
import { datasetGet } from "@elaraai/e3-api-client";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { e3Harness } from "../e3-web-mount.test-utils.js";
import { useDatasetValue } from "./useDatasetValue.js";

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

/** The count's dotted path, as a preview names it. */
const COUNT = "inputs.count";
const valueKey = (hash: string) => ["datasetValue", h.e3.apiUrl, h.e3.repo, h.workspace, COUNT, hash];
const statusKey = () => ["datasetStatus", h.e3.apiUrl, h.e3.repo, h.workspace, COUNT];
/** The hash of what e3 holds of the count now, read as another session would. */
const heldHash = async () => (await datasetGet(h.e3.apiUrl, h.e3.repo, h.workspace, ex.countInput.path, h.e3.direct)).hash;

describe("useDatasetValue", () => {
    test("keeps a value under the hash its response names, and fetches the status again", async () => {
        // The status named the count as deployed; another session has written 7 since.
        const asked = await heldHash();
        await h.write(ex.countInput, 7n);
        const held = await heldHash();
        expect(held).not.toBe(asked);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        client.setQueryData(statusKey(), { hash: asked });
        const { result, rerender } = renderHook(
            ({ hash }: { hash: string }) => useDatasetValue(h.e3.apiUrl, h.e3.repo, h.workspace, COUNT, {
                type: toEastTypeValue(IntegerType), hash, requestOptions: { token: null, fetch: h.e3.fetch },
            }),
            {
                initialProps: { hash: asked },
                wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
            },
        );
        await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(result.current.data).toBe(undefined);
        expect((client.getQueryData(valueKey(held)) as { decoded: unknown }).decoded).toBe(7n);
        expect(client.getQueryState(statusKey())?.isInvalidated).toBe(true);
        expect(h.requests("read", COUNT)).toHaveLength(1);

        // The status, fetched again, names the value that was read, which is
        // served from the cache at once.
        rerender({ hash: held });
        expect(result.current.data?.decoded).toBe(7n);
    });
});
