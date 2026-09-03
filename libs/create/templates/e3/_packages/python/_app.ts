import e3 from "@elaraai/e3";
import { East, ArrayType, FloatType, FunctionType } from "@elaraai/east";

// Two ways of crossing the language boundary into packages/python/__PACKAGE_NAME__:
//
// 1. A PLATFORM function — native python East cannot express. This TS-East
//    declaration mirrors packages/python/__PACKAGE_NAME__/src/__PACKAGE_NAME__/example.py
//    (same dotted "__PACKAGE_NAME__.example" name, same signature — keep the two in
//    lockstep), and the task calling it runs on east-py with the package installed.
const example = East.platform("__PACKAGE_NAME__.example", [ArrayType(FloatType)], FloatType);

// 2. An EAST function — East IR authored in python (…/functions.py, listed in the
//    package's `east_functions`), referred to by package, name and type. At export
//    e3 finds the package in the uv workspace, exports its functions (east-py
//    export-functions) and embeds the IR in the task: the deployed program is pure
//    IR, so the task runs on the DEFAULT runner (east-node) with no python at run
//    time. The type must equal the exported one exactly — e3 checks it at export.
const scale = East.importFunction(
  "__PACKAGE_NAME__",
  "scale",
  FunctionType([ArrayType(FloatType), FloatType], ArrayType(FloatType)),
);

const values = e3.input("__PACKAGE_IDENT___values", ArrayType(FloatType), [1.0, 2.0, 3.0]);
const factor = e3.input("__PACKAGE_IDENT___factor", FloatType, 2.0);

// No `environment` needed: e3 derives it from the `{ custom: "__PACKAGE_NAME__" }`
// platform reference below — at export it captures packages/python/__PACKAGE_NAME__'s
// dependency closure into the bundle. Editing anything under that package re-runs
// only this task; sibling packages stay cached. (To override — e.g. pin a
// container image, or add prebuilt `tools` binaries — add an explicit
// `environment:` here.)
export const __PACKAGE_IDENT___task = e3.task(
  "__PACKAGE_IDENT___example",
  [values],
  East.function([ArrayType(FloatType)], FloatType, ($, v) => {
    $.return(example(v));
  }),
  {
    runner: { runtime: "east-py", platforms: [{ custom: "__PACKAGE_NAME__" }, "east-py-std"] },
  },
);

// The imported East function needs no runner, platform or environment: its IR is
// embedded here at export, and the default runner executes it.
export const __PACKAGE_IDENT___scaled_task = e3.task(
  "__PACKAGE_IDENT___scaled",
  [values, factor],
  East.function([ArrayType(FloatType), FloatType], ArrayType(FloatType), ($, v, f) => {
    $.return(scale(v, f));
  }),
);

// Every task this package contributes to the app's dataflow (collected by
// src/packages/index.ts).
export const __PACKAGE_IDENT___tasks = [__PACKAGE_IDENT___task, __PACKAGE_IDENT___scaled_task];
