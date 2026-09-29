/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The type section's well-known registry, whatever order its modules load in.
 * The IR type's value comes from `../shared.js`, which imports the type
 * section back through the compiler; a load that begins at `shared.js` — the
 * order esbuild's code splitting gives a browser bundle — evaluates the type
 * section first, so the registry must not read that value at load.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { encodeBeast2For } from "../index.js";
import { IntegerType } from "../../../types.js";
import { EastTypeValueType, toEastTypeValue } from "../../../type_of_type.js";

describe("beast2 v5 type section", () => {
  test("a load that begins at the IR type's module encodes the bytes any other load does", () => {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      await import(${JSON.stringify(new URL("../shared.js", import.meta.url).href)});
      const { encodeBeast2For } = await import(${JSON.stringify(new URL("../index.js", import.meta.url).href)});
      const { IntegerType } = await import(${JSON.stringify(new URL("../../../types.js", import.meta.url).href)});
      const { EastTypeValueType, toEastTypeValue } = await import(${JSON.stringify(new URL("../../../type_of_type.js", import.meta.url).href)});
      const hex = (bytes) => Buffer.from(bytes).toString("hex");
      console.log(JSON.stringify({
        integer: hex(encodeBeast2For(IntegerType)(1n)),
        type: hex(encodeBeast2For(EastTypeValueType)(toEastTypeValue(IntegerType))),
      }));
    `], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr.slice(-2_000));
    const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
    // A type value's section names its well-known schema by reference, so the
    // same bytes here mean the registry was whole in the child.
    assert.deepEqual(JSON.parse(child.stdout), {
      integer: hex(encodeBeast2For(IntegerType)(1n)),
      type: hex(encodeBeast2For(EastTypeValueType)(toEastTypeValue(IntegerType))),
    });
  });
});
