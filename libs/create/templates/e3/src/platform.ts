import { East, IntegerType, FloatType } from "@elaraai/east";

// A project-owned TS-East platform function: declaration AND implementation
// co-located (no stub, no venv, no codegen). East code calls
// `applySafetyBuffer`; the impl runs on the east-node runtime, which loads it
// through this package's own `./platform` subpath export (see package.json) —
// resolved by east-node-cli's project-root fallback.
export const applySafetyBuffer = East.platform(
  "__PROJECT_NAME__.apply_safety_buffer",
  [IntegerType, FloatType],
  IntegerType,
);

// The `./platform` default export east-node-cli loads: a PlatformFunction[].
export default [
  applySafetyBuffer.implement(
    (quantity: bigint, factor: number): bigint => BigInt(Math.ceil(Number(quantity) * factor)),
  ),
];
