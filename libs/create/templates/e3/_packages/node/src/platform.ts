import { East, IntegerType, FloatType } from "@elaraai/east";

// The east-node platform function owned by @__PROJECT_NAME__/__PACKAGE_NAME__.
// Platform functions let East call native TS/Node code East can't express. Its
// dotted "__PACKAGE_NAME__.example" name + signature mirror the TS-East
// declaration the app calls (src/packages/__PACKAGE_NAME__.ts) — keep the two
// in lockstep. Add native dependencies to this package's package.json and use
// them in the implementation below.
const example = East.platform("__PACKAGE_NAME__.example", [IntegerType, FloatType], IntegerType);

const exampleImpl = example.implement(
  (value: bigint, factor: number): bigint => BigInt(Math.ceil(Number(value) * factor)),
);

// The PlatformFunction[] the east-node runner loads via the package's
// `@__PROJECT_NAME__/__PACKAGE_NAME__/platform` export.
export default [exampleImpl];
