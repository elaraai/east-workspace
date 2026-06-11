import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import east from "@elaraai/eslint-plugin-east";

export default [
  { ignores: ["dist/", "node_modules/", ".venv/"] },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      // Type-aware linting: the East rules read the TypeScript program, so the
      // parser must build it (`projectService` discovers the nearest tsconfig).
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tseslint, east },
    // One rule runs the whole East idiom diagnostic set (prefer some()/none, no
    // hand-rolled variants, prefer the <Tag> over Tag.Root(...), etc.).
    rules: { "east/east-rules": "warn" },
  },
];
