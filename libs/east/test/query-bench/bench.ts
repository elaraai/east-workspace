/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* Translated queries, timed (#925, X4): run by hand with `make query-bench`,
 * never in CI, and nothing here asserts a time. The shared fixture scaled to
 * 100 000 orders — the mock's generator drawing on from its seed, so the first
 * 40 are the fixture's — is written as beast2 for East and as JSON for jq.
 * Each query is checked against the fixture's root and translated; east-c runs
 * it whole-process with its inputs eager and then lazy, east-node
 * whole-process, jq 1.8.1 whole-process, and TypeScript's compiler in process
 * over inputs decoded once. Every East runner's result must equal
 * TypeScript's. The table it prints goes into devdocs/QUERY.md §16.4 by hand,
 * with the machine and the date.
 *
 *   node dist/test/query-bench/bench.js [orders] [runs]
 *
 * EAST_C (the east-c CLI, by default libs/east-c/build-release's), EAST_NODE
 * (east-node's CLI script) and JQ (`jq` on the PATH by default) say where the
 * runners are; a runner that is missing gets a dash. */

import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DateTimeType, East,
  checkJq, decodeBeast2For, encodeBeast2PagedFor, encodeEastIR, equalFor, printFor, toJSONFor, translateJq,
  type EastType,
} from "../../src/index.js";
import { nullablePayload } from "../../src/query/jq/shapes.js";
import { FixtureRoot, makeOrders, queryFixture } from "../query.fixture.js";

const ORDERS = Number(process.argv[2] ?? 100_000);
const RUNS = Number(process.argv[3] ?? 5);

const LIBS = fileURLToPath(new URL("../../../../", import.meta.url));
const EAST_C = process.env["EAST_C"] ?? join(LIBS, "east-c/build-release/packages/east-c-cli/east-c");
const EAST_NODE = process.env["EAST_NODE"] ?? join(LIBS, "east-node/packages/east-node-cli/bin/east-node.mjs");
const EAST_NODE_STD = join(LIBS, "east-node/packages/east-node-std");
const JQ = process.env["JQ"] ?? "jq";
const DIR = join(tmpdir(), "east-query-bench");

/** The query editor mock's default query (`Query Editor Spec.md` §4.7). */
const DEFAULT_QUERY = `.customers as $customers
| .orders
| map(select(.status.type == "shipped") | select(.total >= 100 and (.status.value.date | year) == 2026))
| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})
| map({order: .id, customer: .name, region, total, shipped: .status.value.date})
| sort_by(-.total)
| .[:10]`;

/** The queries timed, each with jq's spelling where jq has no builtin East's uses. */
const QUERIES: readonly { name: string; program: string; jq?: string }[] = [
  { name: "`length`", program: ".orders | length" },
  { name: "`first(… select …)`", program: "first(.orders[] | select(.total > 1000))" },
  { name: "filter and count", program: "[.orders[] | select(.status.type == \"shipped\" and .total > 1000)] | length" },
  { name: "`reduce` by customer", program: "reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total)" },
  { name: "`group_by` totals", program: ".orders | group_by(.customer_id) | map({customer: .[0].customer_id, total: map(.total) | add})" },
  { name: "top 3 by `sort_by`", program: ".orders | sort_by(-.total) | .[:3] | map(.id)" },
  {
    name: "the mock's default query",
    program: DEFAULT_QUERY,
    // jq has no `year`: the date's JSON text starts with it.
    jq: DEFAULT_QUERY.replace("(.status.value.date | year) == 2026", "(.status.value.date | .[0:4]) == \"2026\""),
  },
];

/**
 * A value's JSON as jq reads it (`devdocs/QUERY.md` §2): East's own JSON, with
 * each Integer a number rather than its quoted digits, and each Dict an object
 * keyed by its String keys rather than a list of entries.
 *
 * @param type - the value's type
 * @param json - the value as East's JSON writes it
 * @returns the JSON jq sees
 */
function jqView(type: EastType, json: unknown): unknown {
  switch (type.type) {
    case "Integer":
      return JSON.parse(json as string);
    case "Array":
      return (json as unknown[]).map(x => jqView(type.value, x));
    case "Set":
      return (json as unknown[]).map(x => jqView(type.key, x));
    case "Dict":
      if (type.key.type !== "String") throw new Error("jq's objects are keyed by strings");
      return Object.fromEntries((json as { key: string; value: unknown }[]).map(e => [e.key, jqView(type.value, e.value)]));
    case "Struct":
      return Object.fromEntries(Object.entries(type.fields).map(([name, t]) => [name, jqView(t as EastType, (json as Record<string, unknown>)[name])]));
    case "Variant": {
      const payload = nullablePayload(type);
      if (payload !== undefined) return json === null ? null : jqView(payload, json);
      const { type: tag, value } = json as { type: string; value: unknown };
      return { type: tag, value: jqView((type.cases as Record<string, EastType>)[tag]!, value) };
    }
    case "Recursive":
      return jqView(type.node, json);
    default:
      return json;
  }
}

/** The median of some times. */
function median(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Times a run: once to warm the file cache, then {@link RUNS} times.
 *
 * @returns the median, in milliseconds
 */
function time(run: () => void): number {
  run();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  return median(times);
}

/**
 * Runs a process to its end, its output to a file.
 *
 * @throws {Error} When it exits other than 0.
 */
function run(command: string, args: string[], env: Record<string, string>, output: string, cwd?: string): void {
  const fd = openSync(output, "w");
  try {
    const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", fd, "pipe"] });
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}: ${result.stderr?.toString() ?? ""}`);
  } finally {
    closeSync(fd);
  }
}

/** The first line a runner prints for its version, or null when it cannot run. */
function versionOf(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  return result.status === 0 ? result.stdout.toString().trim().split("\n")[0]! : null;
}

mkdirSync(DIR, { recursive: true });
const fixture = queryFixture();
const orders = makeOrders(ORDERS);
const types = FixtureRoot.fields;
const files = { customers: join(DIR, "customers.beast2"), orders: join(DIR, "orders.beast2") };
writeFileSync(files.customers, encodeBeast2PagedFor(types.customers)(fixture.customers));
writeFileSync(files.orders, encodeBeast2PagedFor(types.orders)(orders));
const jsonFile = join(DIR, "root.json");
writeFileSync(jsonFile, JSON.stringify({
  customers: jqView(types.customers, toJSONFor(types.customers)(fixture.customers)),
  orders: jqView(types.orders, toJSONFor(types.orders)(orders)),
}));
const decoded = {
  customers: decodeBeast2For(types.customers)(readFileSync(files.customers)),
  orders: decodeBeast2For(types.orders)(readFileSync(files.orders)),
};

const eastNodeVersion = existsSync(EAST_NODE) ? versionOf(process.execPath, [EAST_NODE, "--version"]) : null;
const runners = {
  eastC: existsSync(EAST_C) ? versionOf(EAST_C, ["version"]) : null,
  eastNode: eastNodeVersion,
  jq: versionOf(JQ, ["--version"]),
};

const cell = (ms: number | null): string => ms === null ? "—" : ms < 1 ? ms.toFixed(2) : ms < 10 ? ms.toFixed(1) : ms.toFixed(0);
const rows: string[] = [];
for (const q of QUERIES) {
  const checked = checkJq(q.program, FixtureRoot, { root: true });
  const translation = translateJq(checked);
  const irFile = join(DIR, "query.beast2");
  writeFileSync(irFile, encodeEastIR(translation.fn().toIR()));
  const names = translation.inputs.map(input => input.name as keyof typeof files);
  const inputs = names.flatMap(name => ["-i", files[name]]);
  const equal = equalFor(translation.resultType);

  const compiled = East.compile(translation.fn(), []) as (...args: unknown[]) => unknown;
  const args = names.map(name => decoded[name]);
  const expected = compiled(...args);
  const typescript = time(() => { compiled(...args); });

  // A whole-process East run, its result held to TypeScript's.
  const east = (command: string, prefix: string[], options: string[], env: Record<string, string>, cwd?: string): number => {
    const out = join(DIR, "out.beast2");
    const ms = time(() => run(command, [...prefix, "run", irFile, ...inputs, "-o", out, ...options], env, join(DIR, "stdout.txt"), cwd));
    const result = decodeBeast2For(translation.resultType)(readFileSync(out));
    if (!equal(result, expected)) throw new Error(`${q.name}: ${command} gave another result than TypeScript`);
    return ms;
  };
  const eager = runners.eastC === null ? null : east(EAST_C, [], ["--decode", "whole"], {});
  const lazy = runners.eastC === null ? null : east(EAST_C, [], [], {});
  const node = runners.eastNode === null
    ? null
    // east-node finds its platform package from the working directory: the package's own resolves it.
    : east(process.execPath, [EAST_NODE], ["-p", "@elaraai/east-node-std", "--decode", "whole"], {}, EAST_NODE_STD);
  const jq = runners.jq === null ? null : time(() => run(JQ, ["-c", q.jq ?? q.program, jsonFile], {}, join(DIR, "jq.json")));
  rows.push(`| ${q.name} | ${cell(eager)} | ${cell(lazy)} | ${cell(node)} | ${cell(typescript)} | ${cell(jq)} |`);
  console.error(`[+] ${q.name}`);
}

const cpu = cpus();
const megabytes = (file: string): string => (statSync(file).size / 1e6).toFixed(1);
console.log([
  `${ORDERS.toLocaleString("en")} orders (${megabytes(files.orders)} MB as beast2, ${megabytes(jsonFile)} MB of JSON with the customers); ` +
    `the median of ${RUNS} runs after one to warm the file cache, in milliseconds.`,
  "",
  "| Query | east-c | east-c, lazy | east-node | TypeScript, compiled | jq |",
  "|---|--:|--:|--:|--:|--:|",
  ...rows,
  "",
  `${cpu[0]?.model ?? "unknown CPU"} (${cpu.length} threads), ${Math.round(totalmem() / 2 ** 30)} GiB, ${platform()} ${release()}; ` +
    `node ${process.version}; ${runners.eastC ?? "east-c absent"}; east-node ${runners.eastNode ?? "absent"}; ${runners.jq ?? "jq absent"}; ` +
    `${printFor(DateTimeType)(new Date()).slice(0, 10)}.`,
].join("\n"));
