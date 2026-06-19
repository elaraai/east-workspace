import { East, IntegerType, FloatType } from "@elaraai/east";

// An example project-owned TS-East platform function — replace it with your own.
// Platform functions let East call native TS/Node code East can't express. The
// declaration (`exampleNode`) is what East code calls in a task; the
// implementation runs on the east-node runtime. To add another, create a sibling
// file in this folder and wire it into ./index.ts.
export const exampleNode = East.platform(
  "__PROJECT_NAME__.example_node",
  [IntegerType, FloatType],
  IntegerType,
);

export const exampleNodeImpl = exampleNode.implement(
  (value: bigint, factor: number): bigint => BigInt(Math.ceil(Number(value) * factor)),
);
