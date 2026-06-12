/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, TestImpl } from "@elaraai/east-node-std";
import { ArrayType, StructType, encodeBeast2For, equalFor, variant } from "@elaraai/east";
import { TreePathType, type TreePath } from "@elaraai/e3-types";
import { DataManifestType, encodeManifest, decodeManifest, type DataManifest } from "@elaraai/e3-ui";

const manifestEqual = equalFor(DataManifestType);

/** Encode with the pre-`functions` manifest shape (what older SDKs wrote). */
function encodeLegacyManifest(paths: TreePath[]): Uint8Array {
    const LegacyType = StructType({ paths: ArrayType(TreePathType) });
    return encodeBeast2For(LegacyType)({ paths });
}

describeEast("DataManifest", (test) => {
    test("encodes + decodes an empty manifest", _ => {
        const manifest: DataManifest = { paths: [], functions: [] };
        const blob = encodeManifest(manifest);
        if (!(blob instanceof Uint8Array) || blob.length === 0) throw new Error("expected non-empty Uint8Array");
        if (!manifestEqual(decodeManifest(blob), manifest)) throw new Error("round-trip mismatch");
    });

    test("round-trips a single path", _ => {
        const manifest: DataManifest = {
            paths: [[variant("field", "inputs"), variant("field", "sales")]],
            functions: [],
        };
        if (!manifestEqual(decodeManifest(encodeManifest(manifest)), manifest)) throw new Error("round-trip mismatch");
    });

    test("round-trips multiple paths", _ => {
        const manifest: DataManifest = {
            paths: [
                [variant("field", "inputs"), variant("field", "sales")],
                [variant("field", "tasks"), variant("field", "summarize"), variant("field", "output")],
                [variant("field", "inputs"), variant("field", "threshold")],
            ],
            functions: ["forecast", "rebalance"],
        };
        if (!manifestEqual(decodeManifest(encodeManifest(manifest)), manifest)) throw new Error("round-trip mismatch");
    });

    test("decodes a legacy { paths } blob with functions defaulted empty", _ => {
        // A blob written by a pre-`functions` SDK — encoded with the
        // legacy struct shape directly.
        const legacy = encodeLegacyManifest([[variant("field", "inputs"), variant("field", "sales")]]);
        const decoded = decodeManifest(legacy);
        if (!manifestEqual(decoded, {
            paths: [[variant("field", "inputs"), variant("field", "sales")]],
            functions: [],
        })) throw new Error("legacy decode mismatch");
    });

    test("encoding is deterministic for the same input", _ => {
        const manifest: DataManifest = {
            paths: [[variant("field", "a")], [variant("field", "b")], [variant("field", "c")]],
            functions: ["f"],
        };
        const a = encodeManifest(manifest);
        const b = encodeManifest(manifest);
        if (a.length !== b.length || a.some((byte, i) => byte !== b[i])) throw new Error("encoding is not deterministic");
    });
}, { platformFns: TestImpl });
