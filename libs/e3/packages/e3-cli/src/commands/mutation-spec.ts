/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A mutation call as the command line writes it: `<record>.<mutation>`, then
 * the mutation's arguments. `e3 mutate` takes one, and each `--draft` of
 * `e3 call` is one that is laid over its record and never saved. And a
 * record's source as `e3 load` names it: `<record>.<source>`.
 */

/**
 * Split a `<record>.<name>` spec on its final dot: a mutation's, as `e3 mutate`
 * writes it, or a source's, as `e3 load` does.
 *
 * @param spec - The spec as written
 * @param part - What follows the dot, as a refusal names it
 * @returns The record's name and the part's
 * @throws {Error} When either side of the dot is empty, or there is none
 */
export function parseRecordSpec(spec: string, part: 'mutation' | 'source'): { record: string; name: string } {
  const dot = spec.lastIndexOf('.');
  if (dot <= 0 || dot === spec.length - 1) {
    throw new Error(`Invalid ${part} specifier '${spec}'. Expected '<record>.<${part}>'.`);
  }
  return { record: spec.slice(0, dot), name: spec.slice(dot + 1) };
}

/**
 * Split a `<record>.<mutation>` spec on its final dot.
 *
 * @param spec - The spec as written
 * @returns The record's name and the mutation's
 * @throws {Error} When either side of the dot is empty, or there is none
 */
export function parseMutationSpec(spec: string): { record: string; mutation: string } {
  const { record, name } = parseRecordSpec(spec, 'mutation');
  return { record, mutation: name };
}

/**
 * Why a mutation call of the wrong number of arguments is refused, saying what
 * the one argument of a `patch` mutation is: the state's patch, which is the
 * thing people reach for a row instead.
 *
 * @param mutation - The mutation's name
 * @param mut - Its form and the types of the arguments it declares
 * @param got - How many arguments the call was written with
 * @returns The refusal's words, or `null` for the number the mutation takes
 */
export function arityRefusal(mutation: string, mut: { form: string; argTypes: readonly unknown[] }, got: number): string | null {
  if (got === mut.argTypes.length) return null;
  const what = mut.form === 'patch'
    ? " — a patch mutation takes one argument, the record's patch (a .beast2/.json/.east file, or an .east literal)"
    : '';
  return `Mutation '${mutation}' expects ${mut.argTypes.length} argument(s), got ${got}${what}`;
}
