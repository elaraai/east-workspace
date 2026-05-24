import { East, IntegerType, ArrayType, FloatType } from "@elaraai/east";

export const f = East.function([], IntegerType, ($) => {
  const a = $.let([], ArrayType(FloatType));
  const total = $.let(a.size(), IntegerType);
  return total;
});
