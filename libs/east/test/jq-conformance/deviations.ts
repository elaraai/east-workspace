/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The cases of jq 1.8's suites that East answers otherwise, each with the
 * deviation of `devdocs/QUERY.md` §13 that says so and why; and those it
 * skips, with the reason. A case the checker's diagnostics already place (an
 * excluded builtin, one §13.8 or §13.17 lists) is not repeated here.
 */

/** A deviation of §13, and why a case differs by it. */
type Deviation = readonly [deviation: number, why: string];

/** Each case's deviation, by id (`file:line`), grouped by deviation. */
const BY_DEVIATION: readonly (readonly [string, Deviation])[] = [
  // §13.1 A missing Struct field is an error.
  ["jq.test:609", [1, ".b on Struct{a} is unknown_field, where jq reads null"]],
  ["jq.test:1168", [1, "del(.baz…) reads .baz, which the input's struct lacks"]],
  ["man.test:33", [1, ".foo on a struct without foo is unknown_field, where jq reads null"]],
  ["man.test:162", [1, ".a on {} is unknown_field, where jq reads null"]],
  ["man.test:805", [1, ".foo on {} is unknown_field, where jq reads null"]],

  // §13.2 Dict keys have any East type.
  ["jq.test:127", [2, "{(0): 1} builds a Dict<Integer, Integer>, where jq refuses a number key"]],
  ["jq.test:2044", [2, ".[{}] = 0 on null builds a dict keyed by the empty struct, where jq raises"]],

  // §13.3 Integers are exact to 64 bits.
  ["jq.test:2169", [3, "13911860366432393 - 10 is exact, where jq rounds to a double"]],
  ["jq.test:2177", [3, "13911860366432393 - 10 is exact, where jq rounds to a double"]],

  // §13.4 DateTime is a type.
  ["jq.test:1805", [4, "strftime takes a DateTime or epoch seconds, not jq's broken-down time"]],
  ["jq.test:1813", [4, "strftime takes a DateTime or epoch seconds, not jq's broken-down time"]],
  ["jq.test:1817", [4, "mktime reads jq's broken-down time, which a DateTime replaces; not yet available"]],
  ["jq.test:1821", [4, "gmtime gives jq's broken-down time, which a DateTime replaces; not yet available"]],
  ["jq.test:1847", [4, "strptime gives a DateTime, not broken-down time, and mktime is not yet available"]],
  ["jq.test:1851", [4, "strptime gives a DateTime, not broken-down time, and mktime is not yet available"]],
  ["jq.test:1857", [4, "mktime is not yet available"]],
  ["man.test:742", [4, "fromdate gives a DateTime, not epoch seconds"]],
  ["man.test:746", [4, "strptime gives a DateTime, not broken-down time"]],
  ["man.test:750", [4, "mktime is not yet available"]],
  ["optional.test:4", [4, "fromdate gives a DateTime, not epoch seconds"]],
  ["optional.test:9", [4, "%e is not one of the format codes East takes"]],

  // §13.5 A program's outputs share one element type.
  ["jq.test:213", [5, "the update gives a struct and the handler a string"]],
  ["jq.test:217", [5, "the update gives a struct and the handler a string"]],
  ["jq.test:229", [5, "the update gives a dict and the handler a string"]],
  ["jq.test:248", [5, "1 and [] have no common type"]],
  ["jq.test:269", [5, "the array would hold arrays, strings and numbers"]],
  ["jq.test:273", [5, "the array would hold numbers and an array"]],
  ["jq.test:315", [5, "the array would hold numbers and a string"]],
  ["jq.test:319", [5, "the array would hold numbers and a string"]],
  ["jq.test:405", [5, "the array would hold numbers and a string"]],
  ["jq.test:440", [5, "the array would hold numbers and arrays of numbers"]],
  ["jq.test:478", [5, "the updated array would hold numbers and strings"]],
  ["jq.test:524", [5, "the literal [1, {c:3, d:4}] holds a number and an object"]],
  ["jq.test:716", [5, "the literal array holds objects, numbers, booleans, null, a string and an array"]],
  ["jq.test:851", [5, "the outputs are arrays of arrays and arrays of numbers"]],
  ["jq.test:944", [5, "the literal [[3],[4],[5],6] holds arrays and a number"]],
  ["jq.test:948", [5, "the literal [[3],[4],[5],6] holds arrays and a number"]],
  ["jq.test:966", [5, "the literal [[3],[4],[5],6] holds arrays and a number"]],
  ["jq.test:973", [5, "the literal [[3],[4],[5],6] holds arrays and a number"]],
  ["jq.test:994", [5, "the literal [[3],[4],[5],6] holds arrays and a number"]],
  ["jq.test:1001", [5, "the literal [[3],[4],[5],6] holds arrays and a number"]],
  ["jq.test:1022", [5, "the literal [[3],[4],[5],6] holds arrays and a number"]],
  ["jq.test:1029", [5, "the literal [[3],[4],[5],6] holds arrays and a number"]],
  ["jq.test:1138", [5, "the path [\"foo\", 1] holds a string and a number"]],
  ["jq.test:1154", [5, "the path [\"foo\", 1] holds a string and a number"]],
  ["jq.test:1399", [5, "the literal array holds numbers, an object and a string"]],
  ["jq.test:1431", [5, "the outputs are strings and numbers"]],
  ["jq.test:1515", [5, "the array would hold numbers and an array of numbers"]],
  ["jq.test:1519", [5, "the array would hold numbers and an array of numbers"]],
  ["jq.test:1639", [5, "the outputs are arrays of objects and arrays of arrays of objects"]],
  ["jq.test:2004", [5, "the division gives a number and the handler a string"]],
  ["jq.test:2008", [5, "the division gives a number and the handler a string"]],
  ["jq.test:2012", [5, "the division gives a number and the handler a string"]],
  ["jq.test:2016", [5, "the remainder gives a number and the handler a string"]],
  ["jq.test:2020", [5, "the remainder gives a number and the handler a string"]],
  ["jq.test:2047", [5, "each row [., \"foo\\(.)\"] holds a number and a string"]],
  ["jq.test:2194", [5, "the update gives a number and the handler a string"]],
  ["jq.test:2199", [5, "each row holds a number, a string and a boolean"]],
  ["man.test:104", [5, "the outputs are a number and a string"]],
  ["man.test:582", [5, "the literal array holds numbers and an object"]],
  ["man.test:586", [5, "the literal array holds numbers and an object"]],
  ["man.test:669", [5, "recurse gives the object, a number and an array"]],
  ["man.test:809", [5, "the outputs are a boolean, null and a number"]],
  ["man.test:813", [5, "the outputs are a boolean, null and a number"]],
  ["man.test:919", [5, "the accumulator is {x} from null and {x, y} from an object, which have no common type"]],

  // §13.6 Literal keys build Structs; computed keys build Dicts.
  ["jq.test:118", [6, "the object mixes names and a computed key"]],
  ["jq.test:122", [6, "the object mixes names and an interpolated key"]],
  ["jq.test:1663", [6, ".foo[.baz] reads a struct's field by a computed name, which needs a dict"]],
  ["jq.test:2266", [6, "the object mixes names and computed keys"]],

  // §13.8 Regular expressions are East's.
  ["onig.test:67", [8, "the flag n is not one East's regular expressions take"]],
  ["onig.test:104", [8, "the flag x is not one East's regular expressions take"]],
  ["onig.test:141", [8, "the replacement gives two strings, where it interpolates only named groups"]],
  ["onig.test:166", [8, "the replacement runs filters on the named groups, where it interpolates them"]],
  ["onig.test:170", [8, "the replacement runs a filter on a named group, where it interpolates it"]],
  ["onig.test:183", [8, "the replacement gives two strings, where it interpolates only named groups"]],
  ["onig.test:187", [8, "the replacement gives several strings and runs filters on a named group"]],
  ["onig.test:191", [8, "the replacement gives several strings and runs filters on a named group"]],

  // §13.9 tostring and tojson are East's.
  ["jq.test:1482", [9, "$__loc__ is interpolated as East text, where jq writes JSON"]],
  ["man.test:341", [9, "$__loc__ is interpolated as East text, where jq writes JSON"]],

  // §13.14 error(v)'s message is v's East text.
  ["jq.test:205", [14, "the caught error is [\"b\"]'s East text, a string, where jq gives the array"]],
  ["jq.test:1476", [14, "the caught error is the number's East text, a string, where jq gives the number"]],

  // §13.16 A value that can be null is checked where a value is needed.
  ["jq.test:329", [16, ".[0] - 1 on an index that can miss"]],
  ["jq.test:333", [16, ".[0] - 1 on an index that can miss"]],
  ["jq.test:341", [16, "$i - $j on array pattern elements that can be null"]],
  ["jq.test:898", [16, "$i * $j on array pattern elements that can be null"]],
  ["jq.test:1615", [16, "contains on .[0], an index that can miss"]],
  ["jq.test:1619", [16, "contains on .[0], an index that can miss"]],
  ["jq.test:2029", [16, "the difference of two indexes that can miss"]],
  ["jq.test:2123", [16, "tonumber on .[1], an index that can miss"]],
  ["jq.test:2173", [16, ".[0] - 10 on an index that can miss"]],
  ["man.test:658", [16, ".[0] - 1 on an index that can miss"]],
  ["man.test:915", [16, "$i * $j on array pattern elements that can be null"]],

  // §13.18 The string builtins are East's.
  ["jq.test:1531", [18, "trim removes JavaScript's whitespace: U+0085 stays"]],
  ["jq.test:1785", [18, "ascii_upcase maps é too"]],
  ["man.test:646", [18, "ascii_upcase maps é too"]],

  // §13.20 repeat(f) gives its input first.
  ["man.test:654", [20, "repeat gives the input, 1, before f of it"]],

  // §13.23 Paths are a subset of jq's, and keep types.
  ["jq.test:490", [23, "an index past the end of an array raises, where jq pads it with nulls"]],
  ["jq.test:1188", [23, "pick takes field reads"]],
  ["jq.test:1197", [23, "pick takes field reads"]],
  ["jq.test:1232", [23, "the update would make a number field a struct"]],
  ["jq.test:1236", [23, "a def in an update's path"]],
  ["jq.test:1261", [23, "an index in an update's path gives four keys"]],
  ["jq.test:1265", [23, "the update indexes a number, where jq pads with nulls"]],
  ["jq.test:1269", [23, "the update reads a field of a number, where jq pads with nulls"]],
  ["jq.test:1273", [23, "map(…) in an update's path"]],
  ["jq.test:1277", [23, "map(…) in an update's path"]],
  ["jq.test:1281", [23, "a def in an update's path"]],
  ["jq.test:1285", [23, "a def in an update's path"]],
  ["jq.test:2088", [23, "an as-binding in an update's path"]],
  ["man.test:248", [23, "map_values(f) on a struct needs an output of f for every field"]],
  ["man.test:252", [23, "pick takes field reads"]],
  ["man.test:256", [23, "pick takes field reads"]],
  ["man.test:706", [23, "an index past the end of an array raises, where jq pads it"]],
  ["man.test:985", [23, ", in an update's path"]],
  ["man.test:991", [23, ", in an update's path"]],

  // §13.25 A pattern's keys are names.
  ["jq.test:530", [25, "a computed key in a pattern"]],

  // §13.26 A number literal fits East's numbers.
  ["jq.test:661", [26, "9E999999999 is beyond a Float"]],
  ["jq.test:668", [26, "5E500000000 is beyond a Float"]],
  ["jq.test:674", [26, "1e999999999 is beyond a Float"]],
  ["jq.test:2190", [26, "1E+1000 is beyond a Float"]],
  ["jq.test:2229", [26, "1E+1000 is beyond a Float"]],
  ["jq.test:2233", [26, "1E+1000 is beyond a Float"]],
  ["man.test:9", [26, "12345678909876543212345 is beyond an Integer"]],
  ["man.test:25", [26, "10000000000000000000000000000000 is beyond an Integer"]],

  // §13.27 Values of two types do not compare.
  ["jq.test:1394", [27, "== compares structs of different fields"]],
  ["man.test:754", [27, "== compares null with a boolean"]],

  // §13.28 A runtime error's message is East's.
  ["jq.test:1464", [28, "East's message does not quote the value"]],
  ["jq.test:1537", [28, "East's message names what trim needs"]],
  ["jq.test:1801", [28, "East's message names what bsearch needs"]],
  ["jq.test:1959", [28, "East's message does not quote the value"]],
  ["jq.test:1963", [28, "East's message does not quote the values"]],
  ["jq.test:1967", [28, "East's message does not quote the value"]],

  // §13.29 An index or a slice bound is an Integer.
  ["jq.test:1695", [29, "has(nan) on an array"]],
  ["jq.test:2393", [29, "Float slice bounds"]],
  ["jq.test:2397", [29, "Float slice bounds"]],
  ["jq.test:2401", [29, "Float slice bounds"]],
  ["jq.test:2405", [29, "a Float slice bound"]],
  ["jq.test:2409", [29, "a Float slice bound"]],
  ["jq.test:2413", [29, "Float indexes"]],
  ["jq.test:2417", [29, "a Float index in an update"]],
  ["jq.test:2421", [29, "a NaN slice bound"]],
  ["jq.test:2425", [29, "a NaN slice bound"]],
  ["jq.test:2429", [29, "a NaN index"]],
  ["jq.test:2433", [29, "a NaN index in an update raises East's error"]],
  ["jq.test:2437", [29, "Float slice bounds in an update"]],
  ["jq.test:2441", [29, "Float slice bounds in an update"]],

  // §13.30 An argument of a type a builtin cannot take is found when the query is checked.
  ["jq.test:1839", [30, "strftime's format [] is refused when checked, where jq raises inside try"]],
  ["jq.test:2462", [30, "ltrimstr(1) is refused when checked, where jq raises inside try"]],
];

/** Cases that differ by a deviation, by id (`file:line`). */
export const DEVIATIONS: ReadonlyMap<string, { readonly deviation: number; readonly why: string }> = new Map(
  BY_DEVIATION.map(([id, [deviation, why]]) => [id, { deviation, why }]),
);

/** Cases skipped, by id, with the reason. */
export const SKIPS: ReadonlyMap<string, string> = new Map([
  ["jq.test:1603", "resource: its string is 3 GB, beyond what a runtime holds; East has no length limit to raise jq's error at"],
  ["jq.test:2317", "runner: jq's test runner ignores the error the program raises after its expected outputs; East's query raises it"],
]);
