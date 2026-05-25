import e3 from "@elaraai/e3";
import { East, StringType } from "@elaraai/east";

export const nameInput = e3.input("name", StringType, "World!");

export const greetFn = East.function(
  [StringType],
  StringType,
  ($, name) => East.str`Hello, ${name}!`,
);

export const greet = e3.task("greet", [nameInput], greetFn);

export default e3.package("__PROJECT_NAME__", "1.0.0", greet);
