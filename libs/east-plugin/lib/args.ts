// The one command-line convention of this package's scripts: `--flag value`.

/**
 * The value after `flag` in `args`, if the flag is given.
 *
 * @param args - The command line, without the program
 * @param flag - The flag, `--out` say
 * @returns The value after the flag, or undefined when the flag is absent
 * @throws {Error} When the flag is given with no value after it
 */
export function argument(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx === -1) return undefined;
    const value = args[idx + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    return value;
}
