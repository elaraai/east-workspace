// Prints what an e3 package declares, and for each ui() task the manifest e3-ui
// derived from its IR: the datasets it binds, the functions and records it uses.
// Usage: npx tsx check.ts [file]   (default export: e3.package(...))
const file = new URL(process.argv[2] ?? "./src/index.tsx", `file://${process.cwd()}/`).href;
const pkg = (await import(file)).default as any;
if (pkg?.kind !== "package") throw new Error(`${process.argv[2] ?? "./src/index.tsx"}: the default export is not an e3.package`);

const path = (p: any[]) => p.map((s) => s.value).join(".");
const names = (xs: any[]) => (xs ?? []).map((x) => (typeof x === "string" ? x : x?.name ?? path(x?.path ?? []) ?? JSON.stringify(x))).join(",");

console.log(`package ${pkg.name}@${pkg.version}`);
for (const r of Object.values(pkg.records ?? {}) as any[]) console.log(`record ${r.name ?? JSON.stringify(r)}`);
for (const f of Object.values(pkg.functions ?? {}) as any[]) console.log(`function ${f.name ?? JSON.stringify(f)}`);
for (const item of pkg.contents) {
  if (item.kind === "dataset" && path(item.path).startsWith("inputs.")) console.log(`input ${path(item.path)}`);
  if (item.kind !== "task") continue;
  const role = item.role;
  if (role?.type === "ui") {
    const m = role.value;
    console.log(`ui ${item.name} binds=[${(m.paths ?? []).map(path).join(",")}] functions=[${names(m.functions)}] records=[${names(m.records)}] pages=[${(m.pages ?? []).map((x: any) => Array.isArray(x) ? path(x) : Array.isArray(x?.path) ? path(x.path) : JSON.stringify(x)).join(",")}]`);
  } else {
    console.log(`task ${item.name} inputs=[${(item.inputs ?? []).map((i: any) => path(i.path ?? [])).join(",")}]`);
  }
}
