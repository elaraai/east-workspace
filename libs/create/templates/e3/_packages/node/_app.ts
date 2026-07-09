import e3 from "@elaraai/e3";
import { East, IntegerType, FloatType } from "@elaraai/east";

// TS-East mirror of @__PROJECT_NAME__/__PACKAGE_NAME__'s platform function —
// same dotted "__PACKAGE_NAME__.example" name + signature. Keep this in lockstep
// with packages/node/__PACKAGE_NAME__/src/platform.ts.
const example = East.platform("__PACKAGE_NAME__.example", [IntegerType, FloatType], IntegerType);

const value = e3.input("__PACKAGE_IDENT___value", IntegerType, 21n);
const factor = e3.input("__PACKAGE_IDENT___factor", FloatType, 2.0);

// No `environment` — e3 derives it from the `{ custom: "@__PROJECT_NAME__/__PACKAGE_NAME__" }`
// platform reference below, capturing packages/node/__PACKAGE_NAME__'s npm
// workspace closure into the bundle. Editing that package re-runs only this
// task; sibling packages stay cached.
export const __PACKAGE_IDENT___task = e3.task(
  "__PACKAGE_IDENT___example",
  [value, factor],
  East.function([IntegerType, FloatType], IntegerType, ($, v, f) => {
    $.return(example(v, f));
  }),
  {
    runner: { runtime: "east-node", platforms: [{ custom: "@__PROJECT_NAME__/__PACKAGE_NAME__" }] },
  },
);
