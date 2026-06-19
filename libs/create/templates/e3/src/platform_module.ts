import { East, ArrayType, FloatType } from "@elaraai/east";

// Type-safe declaration mirroring `platform_module/example.py`'s
// `example_python` — same dotted "<project>.<fn>" name, same signature.
// Hand-written (no codegen): keep it in lockstep with the Python
// @platform_function. East code calls this; the impl runs on the east-py
// runtime, resolved from the project's own `.venv` (see the `example_python`
// task in the index).
export const examplePython = East.platform(
  "__PROJECT_NAME__.example_python",
  [ArrayType(FloatType)],
  FloatType,
);
