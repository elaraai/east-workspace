// Prints the outline of the UI an East function builds: one line per component,
// with its scalar props, a Table's columns and rows, a chart's layer kinds.
// Usage: npx tsx check.ts [file]   (default export: East.function([], UIComponentType, …))
import { East } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";

const file = new URL(process.argv[2] ?? "./src/view.tsx", `file://${process.cwd()}/`).href;
const fn = (await import(file)).default;
const value = East.compile(fn, [])();
const COMPONENTS = new Set(Object.keys((UIComponentType as any).node.cases));

const isVariant = (x: any) => x && typeof x === "object" && typeof x.type === "string" && "value" in x;
const scalar = (x: any): string | undefined => {
  if (typeof x === "string") return JSON.stringify(x.length > 40 ? x.slice(0, 40) + "…" : x);
  if (typeof x === "number" || typeof x === "bigint" || typeof x === "boolean") return String(x);
  if (isVariant(x) && x.type === "some") return scalar(x.value);
  if (isVariant(x) && ["String", "Float", "Integer", "Boolean"].includes(x.type)) return scalar(x.value);
  if (isVariant(x) && x.value === null && x.type !== "none") return x.type;
  return undefined;
};
const tags = (x: any, out: Set<string>) => {
  if (Array.isArray(x)) x.forEach((y) => tags(y, out));
  else if (x && typeof x === "object") {
    if (isVariant(x) && x.type !== "some" && x.type !== "none") out.add(x.type);
    Object.values(x).forEach((y) => tags(y, out));
  }
};

function walk(x: any, depth: number): void {
  if (Array.isArray(x)) return x.forEach((y) => walk(y, depth));
  if (!x || typeof x !== "object") return;
  if (isVariant(x) && COMPONENTS.has(x.type)) {
    const v = x.value ?? {};
    const props: string[] = [];
    for (const [k, p] of Object.entries(v)) {
      const s = scalar(p);
      if (s !== undefined) props.push(`${k}=${s}`);
    }
    if (x.type === "Table") {
      const rows = v.rows?.type === "inline" ? v.rows.value : undefined;
      props.push(`columns=[${(v.columns ?? []).map((c: any) => c.key).join(",")}]`);
      if (rows) props.push(`rows=${rows.length}`, `maxDepth=${Math.max(0, ...rows.map((r: any) => Number(r.depth ?? 0)))}`);
      else props.push(`rows=${v.rows?.type}`);
    }
    if (x.type === "VisxChart") {
      const frame = v.value ?? {};
      props.push(`xScale=${frame.xScale?.type} yScale=${frame.yScale?.type}`);
      for (const c of frame.children ?? []) {
        const cv = c.value ?? {};
        if (c.type === "series") props.push(`series[${(cv.data ?? []).map((d: any) => `${d.key}:${d.points?.length}`).join(",")}] mark=${cv.mark?.type}`);
        else if (c.type === "rule") props.push(`rule axis=${cv.axis?.type} at=${cv.at}`);
        else props.push(c.type);
      }
      console.log(`${"  ".repeat(depth)}${x.type} ${props.filter((p) => !p.startsWith("type=")).join(" ")}`);
      return;
    }
    console.log(`${"  ".repeat(depth)}${x.type}${props.length ? " " + props.join(" ") : ""}`);
    for (const p of Object.values(v)) walk(p, depth + 1);
    return;
  }
  for (const p of Object.values(x)) walk(p, depth);
}

walk(value, 0);
