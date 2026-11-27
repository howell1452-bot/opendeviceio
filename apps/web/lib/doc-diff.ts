// Path-level diff of two .odio documents for the moderation queue. Pure;
// tested in test/doc-diff.test.ts.

export interface DiffLine {
  op: "+" | "-" | "~";
  path: string;
  before?: string;
  after?: string;
}

export interface DocSummary {
  portCount: number | null;
  connectors: string[];
  transports: string[];
}

function show(v: unknown): string {
  const s = JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 157)}...` : s;
}

/** Flatten a JSON value into "a.b[0].c" -> leaf value. Nested empty objects/arrays are leaves; an empty root has no paths. */
export function flatten(value: unknown, prefix = "", out = new Map<string, unknown>()) {
  if (Array.isArray(value)) {
    if (value.length === 0 && prefix) out.set(prefix, value);
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0 && prefix) out.set(prefix, value);
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix || "(root)", value);
  }
  return out;
}

/** Added (+), removed (-) and changed (~) leaf paths, sorted by path, capped at `limit`. */
export function diffDocuments(
  before: unknown,
  after: unknown,
  limit = 200
): { lines: DiffLine[]; total: number } {
  const a = flatten(before ?? {});
  const b = flatten(after ?? {});
  const lines: DiffLine[] = [];
  for (const [path, v] of a) {
    if (!b.has(path)) lines.push({ op: "-", path, before: show(v) });
    else if (JSON.stringify(b.get(path)) !== JSON.stringify(v)) {
      lines.push({ op: "~", path, before: show(v), after: show(b.get(path)) });
    }
  }
  for (const [path, v] of b) if (!a.has(path)) lines.push({ op: "+", path, after: show(v) });
  lines.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  return { lines: lines.slice(0, limit), total: lines.length };
}

function collect(node: unknown, key: string, acc = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((v) => collect(v, key, acc));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === key && typeof v === "string") acc.add(v);
      else collect(v, key, acc);
    }
  }
  return acc;
}

/** Port count, connectors and transports of a document (the queue's headline numbers). */
export function summarize(doc: unknown): DocSummary {
  const ports = (doc as { ports?: unknown } | null)?.ports;
  return {
    portCount: Array.isArray(ports) ? ports.length : null,
    connectors: [...collect(doc, "connector")].sort(),
    transports: [...collect(doc, "transport")].sort()
  };
}

/** Values only in `after` (+) and only in `before` (-). */
export function setChange(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: after.filter((x) => !b.has(x)),
    removed: before.filter((x) => !a.has(x))
  };
}
