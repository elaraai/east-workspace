import { East, ArrayType, FloatType } from "@elaraai/east";

// Type-safe declaration mirroring `platform_module/__init__.py`'s
// `forecast_demand` — same dotted "<project>.<fn>" name, same signature.
// Hand-written (no codegen): keep it in lockstep with the Python
// @platform_function. East code calls this; the impl runs on the east-py
// runtime, resolved from the project's own `.venv` (see the `forecast` task in
// the index).
export const forecastDemand = East.platform(
  "__PROJECT_NAME__.forecast_demand",
  [ArrayType(FloatType)],
  FloatType,
);
