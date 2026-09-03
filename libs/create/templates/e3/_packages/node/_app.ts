import e3 from "@elaraai/e3";
import { East, ArrayType, IntegerType, FloatType, FunctionType } from "@elaraai/east";

// Two ways of crossing the package boundary into packages/node/__PACKAGE_NAME__
// (@__PROJECT_NAME__/__PACKAGE_NAME__):
//
// 1. A PLATFORM function — native Node code East cannot express. This TS-East
//    declaration mirrors packages/node/__PACKAGE_NAME__/src/platform.ts (same
//    dotted "__PACKAGE_NAME__.example" name + signature — keep the two in lockstep),
//    and the task calling it runs on east-node with the package installed.
const example = East.platform("__PACKAGE_NAME__.example", [IntegerType, FloatType], IntegerType);

// 2. An EAST function — East IR authored in the package (…/src/functions.ts,
//    listed in its `eastFunctions`), referred to by package, name and type. At
//    export e3 finds the package in the npm workspace, exports its functions from
//    the built ./functions entry (east-node export-functions) and embeds the IR in
//    the task: the deployed program is pure IR, so the task needs no platform and
//    no environment. The type must equal the exported one exactly — e3 checks it
//    at export.
const scale = East.importFunction(
  "@__PROJECT_NAME__/__PACKAGE_NAME__",
  "scale",
  FunctionType([ArrayType(FloatType), FloatType], ArrayType(FloatType)),
);

const value = e3.input("__PACKAGE_IDENT___value", IntegerType, 21n);
const factor = e3.input("__PACKAGE_IDENT___factor", FloatType, 2.0);
const series = e3.input("__PACKAGE_IDENT___series", ArrayType(FloatType), [1.0, 2.0, 3.0]);

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

// The imported East function needs no runner, platform or environment: its IR is
// embedded here at export, and the default runner executes it.
export const __PACKAGE_IDENT___scaled_task = e3.task(
  "__PACKAGE_IDENT___scaled",
  [series, factor],
  East.function([ArrayType(FloatType), FloatType], ArrayType(FloatType), ($, s, f) => {
    $.return(scale(s, f));
  }),
);

// Every task this package contributes to the app's dataflow (collected by
// src/packages/index.ts).
export const __PACKAGE_IDENT___tasks = [__PACKAGE_IDENT___task, __PACKAGE_IDENT___scaled_task];
