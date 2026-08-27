/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, TestImpl } from "@elaraai/east-node-std";
import { equalFor, variant } from "@elaraai/east";
import { DataManifestType, encodeManifest, decodeManifest, type DataManifest } from "@elaraai/e3-ui";

const manifestEqual = equalFor(DataManifestType);

describeEast("DataManifest", (test) => {
    test("encodes + decodes an empty manifest", _ => {
        const manifest: DataManifest = { paths: [], functions: [], records: [], pages: [] };
        const blob = encodeManifest(manifest);
        if (!(blob instanceof Uint8Array) || blob.length === 0) throw new Error("expected non-empty Uint8Array");
        if (!manifestEqual(decodeManifest(blob), manifest)) throw new Error("round-trip mismatch");
    });

    test("round-trips a single path", _ => {
        const manifest: DataManifest = {
            paths: [[variant("field", "inputs"), variant("field", "sales")]],
            functions: [],
            records: [],
            pages: [],
        };
        if (!manifestEqual(decodeManifest(encodeManifest(manifest)), manifest)) throw new Error("round-trip mismatch");
    });

    test("round-trips paths, functions, records and paged sources together", _ => {
        const manifest: DataManifest = {
            paths: [
                [variant("field", "inputs"), variant("field", "sales")],
                [variant("field", "tasks"), variant("field", "summarize"), variant("field", "output")],
                [variant("field", "records"), variant("field", "counter")],
            ],
            functions: ["forecast", "rebalance"],
            records: ["counter"],
            pages: [[variant("field", "inputs"), variant("field", "ops")]],
        };
        if (!manifestEqual(decodeManifest(encodeManifest(manifest)), manifest)) throw new Error("round-trip mismatch");
    });

    test("encoding is deterministic for the same input", _ => {
        const manifest: DataManifest = {
            paths: [[variant("field", "a")], [variant("field", "b")], [variant("field", "c")]],
            functions: ["f"],
            records: ["r"],
            pages: [[variant("field", "p")]],
        };
        const a = encodeManifest(manifest);
        const b = encodeManifest(manifest);
        if (a.length !== b.length || a.some((byte, i) => byte !== b[i])) throw new Error("encoding is not deterministic");
    });
}, { platformFns: TestImpl });
