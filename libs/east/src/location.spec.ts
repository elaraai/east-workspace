/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { normalizeFramePath, resolveLocIds, setLocationBasePath, SourceMap } from "./location.js";

describe("normalizeFramePath", () => {
  // Reset to the automatic (cwd) base after every test so cases don't leak.
  afterEach(() => setLocationBasePath(undefined));

  describe("file:// scheme stripping", () => {
    test("strips a Unix file:// URL and relativizes to the base", () => {
      setLocationBasePath("/home/u/proj");
      assert.equal(normalizeFramePath("file:///home/u/proj/dist/src/foo.js"), "dist/src/foo.js");
    });

    test("strips a Windows file:// URL (drops the leading slash before the drive)", () => {
      setLocationBasePath("C:/Users/x/proj");
      assert.equal(normalizeFramePath("file:///C:/Users/x/proj/src/foo.ts"), "src/foo.ts");
    });

    test("decodes percent-encoding (e.g. spaces) in file:// URLs", () => {
      setLocationBasePath("/home/u/my proj");
      assert.equal(normalizeFramePath("file:///home/u/my%20proj/src/foo.ts"), "src/foo.ts");
    });

    test("a file:// URL outside the base is returned cleaned but absolute", () => {
      setLocationBasePath("/home/u/proj");
      assert.equal(normalizeFramePath("file:///opt/other/foo.ts"), "/opt/other/foo.ts");
    });
  });

  describe("plain paths", () => {
    test("relativizes a plain Unix absolute path under the base", () => {
      setLocationBasePath("/home/u/proj");
      assert.equal(normalizeFramePath("/home/u/proj/src/a/b/foo.ts"), "src/a/b/foo.ts");
    });

    test("normalizes Windows backslashes and relativizes", () => {
      setLocationBasePath("C:\\Users\\x\\proj");
      assert.equal(normalizeFramePath("C:\\Users\\x\\proj\\dist\\foo.js"), "dist/foo.js");
    });

    test("a path not under the base is returned unchanged (cleaned)", () => {
      setLocationBasePath("/home/u/proj");
      assert.equal(normalizeFramePath("/somewhere/else/foo.ts"), "/somewhere/else/foo.ts");
    });
  });

  describe("base-boundary correctness", () => {
    test("a sibling dir sharing a prefix is NOT falsely relativized", () => {
      setLocationBasePath("/a/proj");
      // "/a/proj-extra/..." must not be treated as inside "/a/proj"
      assert.equal(normalizeFramePath("/a/proj-extra/foo.ts"), "/a/proj-extra/foo.ts");
    });

    test("a trailing slash on the base is handled", () => {
      setLocationBasePath("/a/proj/");
      assert.equal(normalizeFramePath("/a/proj/foo.ts"), "foo.ts");
    });

    test("a path equal to the base resolves to '.'", () => {
      setLocationBasePath("/a/proj");
      assert.equal(normalizeFramePath("/a/proj"), ".");
    });

    test("setLocationBasePath accepts a file:// base", () => {
      setLocationBasePath("file:///home/u/proj");
      assert.equal(normalizeFramePath("file:///home/u/proj/src/foo.ts"), "src/foo.ts");
    });
  });

  describe("non-file environments", () => {
    test("a browser http(s) URL is left as-is", () => {
      setLocationBasePath("/home/u/proj");
      assert.equal(normalizeFramePath("https://example.com/app/foo.js"), "https://example.com/app/foo.js");
    });
  });

  describe("automatic base (process.cwd) and reset", () => {
    test("relativizes paths under the working directory when no base is set", () => {
      setLocationBasePath(undefined); // auto → process.cwd()
      const cwd = process.cwd().replace(/\\/g, "/");
      assert.equal(normalizeFramePath(`${cwd}/dist/src/foo.js`), "dist/src/foo.js");
    });

    test("leaves paths outside the working directory absolute", () => {
      setLocationBasePath(undefined);
      assert.equal(normalizeFramePath("/definitely/not/under/cwd/foo.ts"), "/definitely/not/under/cwd/foo.ts");
    });

    test("an explicit base overrides the automatic one, and undefined resets it", () => {
      setLocationBasePath("/explicit/root");
      assert.equal(normalizeFramePath("/explicit/root/x.ts"), "x.ts");
      setLocationBasePath(undefined);
      // back to cwd-relative: an /explicit/root path is now (almost certainly) absolute
      assert.equal(normalizeFramePath("/explicit/root/x.ts"), "/explicit/root/x.ts");
    });
  });

  describe("robustness — never throws, returns sensible output", () => {
    test("empty string", () => {
      setLocationBasePath("/a/proj");
      assert.equal(normalizeFramePath(""), "");
    });

    test("garbage with no path structure", () => {
      setLocationBasePath("/a/proj");
      assert.equal(normalizeFramePath("<anonymous>"), "<anonymous>");
    });

    test("malformed file:// URL is returned without throwing", () => {
      setLocationBasePath(undefined);
      const out = normalizeFramePath("file://");
      assert.equal(typeof out, "string");
    });
  });
});

describe("bare-lambda coercion locations (issue #204)", () => {
  // A bare JS lambda in a FunctionType position is coerced into a real East
  // function; errors raised from it must report the lambda's file:line —
  // both when the coercion runs under an ambient source map and when it
  // runs standalone (East.value at top level, embedded later).

  test("bare lambda coerced inside a build reports the lambda's line", async () => {
    const { East, IntegerType, FunctionType } = await import("./index.js");
    const outer = East.function([], IntegerType, ($) => {
      const f = $.const(($$: any, x: any) => {
        $$.error("boom inside");
        return x;
      }, FunctionType([IntegerType], IntegerType));
      return (f as any)(41n);
    });
    try {
      East.compile(outer as any, [])();
      assert.fail("expected the coerced lambda to throw");
    } catch (e: any) {
      assert.equal(e.eastMessage, "boom inside");
      const frames = (e.location ?? []) as { filename: string }[];
      assert.ok(
        frames.some(l => l.filename.includes("location.spec")),
        `expected a frame in this spec file, got: ${frames.map(l => l.filename).join(", ")}`
      );
    }
  });

  test("standalone East.value coercion embedded later reports the lambda's line", async () => {
    const { East, IntegerType, FunctionType } = await import("./index.js");
    // Coercion happens here with NO ambient source map; its private map must
    // survive the later embedding under the outer function's map.
    const bare = East.value(($$: any, x: any) => {
      $$.error("boom standalone");
      return x;
    }, FunctionType([IntegerType], IntegerType));

    const outer = East.function([], IntegerType, ($) => {
      const f = $.const(bare, FunctionType([IntegerType], IntegerType));
      return (f as any)(41n);
    });
    try {
      East.compile(outer as any, [])();
      assert.fail("expected the coerced lambda to throw");
    } catch (e: any) {
      assert.equal(e.eastMessage, "boom standalone");
      const frames = (e.location ?? []) as { filename: string }[];
      assert.ok(
        frames.some(l => l.filename.includes("location.spec")),
        `expected a frame in this spec file, got: ${frames.map(l => l.filename).join(", ")}`
      );
    }
  });

  test("async bare-lambda coercion carries locations too", async () => {
    const { East, IntegerType, AsyncFunctionType, NullType } = await import("./index.js");
    // The AsyncFunction branch: assert the coerced value's locations resolve
    // to this file through the embedding function's source map.
    const bare = East.value(($$: any, x: any) => {
      $$.error("boom async");
      return x;
    }, AsyncFunctionType([IntegerType], IntegerType));

    const outer = East.function([], NullType, ($) => {
      $.const(bare, AsyncFunctionType([IntegerType], IntegerType));
    });
    const ir = (outer as any).toIR();
    const map = ir.source_map;
    assert.ok(map, "outer function should carry a source map");
    const stacks = map.entries().flat(2) as { filename: string }[];
    assert.ok(
      stacks.some(l => l.filename.includes("location.spec")),
      "expected the async lambda's frames to be re-interned into the outer map"
    );
  });
});

describe("error source locations (issue #381)", () => {
  // Compile-time errors name the offending node by loc_id, which is
  // meaningless to a reader. The source map is only in scope while the
  // expression is being built, so that is where the id has to be resolved.

  test("resolveLocIds replaces an id with its source location", () => {
    const map = new SourceMap();
    const id = map.intern_stack([{ filename: "app.ts", line: 12n, column: 5n }]);
    assert.equal(
      resolveLocIds(`Variable defined at loc_id ${id} is out of scope here`, map),
      "Variable defined at app.ts:12:5 is out of scope here",
    );
  });

  test("resolveLocIds replaces every id in a message", () => {
    const map = new SourceMap();
    const a = map.intern_stack([{ filename: "a.ts", line: 1n, column: 2n }]);
    const b = map.intern_stack([{ filename: "b.ts", line: 3n, column: 4n }]);
    assert.equal(
      resolveLocIds(`defined at loc_id ${a}, reassigned at loc_id ${b}`, map),
      "defined at a.ts:1:2, reassigned at b.ts:3:4",
    );
  });

  test("resolveLocIds describes an id the map cannot place", () => {
    assert.equal(
      resolveLocIds("something failed at loc_id 0", new SourceMap()),
      "something failed at an unknown location",
    );
  });

  test("a compile-time error reports file:line, never a raw loc_id", async () => {
    const { East, IntegerType } = await import("./index.js");
    assert.throws(
      () => East.function([], IntegerType, ($) => {
        const c = $.const(1n, IntegerType);
        $.assign(c as any, 2n);
        return c;
      }),
      (e: Error) => {
        assert.doesNotMatch(e.message, /loc_id \d+/, `raw loc_id in: ${e.message}`);
        assert.match(e.message, /location\.spec\.[jt]s:\d+:\d+/, `no source location in: ${e.message}`);
        return true;
      },
    );
  });

  test("captured stacks name user code, not East's own modules", async () => {
    const { East, IntegerType, ArrayType } = await import("./index.js");
    const ir = (East.function([], IntegerType, ($) => {
      const arr = $.const([1n, 2n], ArrayType(IntegerType));
      return arr.get(0n);
    }) as any).toIR();

    const frames = (ir.source_map.entries().flat(2) as { filename: string }[]);
    assert.ok(frames.length > 0, "expected captured locations");
    for (const frame of frames) {
      assert.doesNotMatch(
        frame.filename,
        /(^|\/)(dist\/)?src\/(expr\/)?(location|block|ast)\.[jt]s$/,
        `East's own module leaked into a trace: ${frame.filename}`,
      );
    }
    assert.ok(frames.every(l => l.filename.includes("location.spec")));
  });

  test("a value built at module scope still resolves to a location", async () => {
    const { East, IntegerType, ArrayType } = await import("./index.js");
    // Built with no ambient map — its private map must survive the embedding
    // below, or the nodes keep UNKNOWN_LOC_ID and errors lose their location.
    const outside = East.value([1n, 2n, 3n], ArrayType(IntegerType));

    const ir = (East.function([IntegerType], IntegerType, ($, i) =>
      (outside as any).get(i)) as any).toIR();

    const stacks = ir.source_map.entries() as { filename: string }[][];
    assert.ok(
      stacks.some(s => s.some(l => l.filename.includes("location.spec"))),
      "the module-scope value's locations should be re-interned into the function's map",
    );
  });
});
