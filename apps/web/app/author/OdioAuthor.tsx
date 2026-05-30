"use client";

import { useMemo, useState } from "react";
import { deviceSchema, validate } from "@opendeviceio/sdk";
import { buildIoTable, renderTableSvg, renderTableHtml } from "@opendeviceio/adapters";

// Form-based ODIO authoring: fill in identity, ports, and power; get a validated
// .odio file plus a live I/O-table preview — no JSON by hand, nothing uploaded.

const DOMAINS = ["video", "audio", "control", "network", "data", "power"] as const;
const DIRECTIONS = ["input", "output", "bidirectional"] as const;
const POWER_TYPES = ["ac", "dc", "poe", "usb-pd"] as const;

const CONNECTORS: string[] = (() => {
  try {
    const defs = (deviceSchema as unknown as { $defs?: { connector?: { enum?: string[] } } }).$defs;
    return defs?.connector?.enum ?? ["other"];
  } catch {
    return ["other"];
  }
})();

function slugId(s: string): string {
  return s
    .toLowerCase()
    .replace(/\+/g, "-plus")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^([^a-z0-9])/, "p$1") || "x";
}

interface SignalForm {
  domain: string;
  transport: string;
}
interface PortForm {
  key: number;
  label: string;
  direction: string;
  connector: string;
  connectorOther: string;
  count: number;
  signals: SignalForm[];
}
interface PowerForm {
  key: number;
  type: string;
  voltageRange: string;
  nominalVoltage: string;
  standard: string;
}

let nextKey = 1;
const k = () => nextKey++;

function newPort(): PortForm {
  return {
    key: k(),
    label: "",
    direction: "input",
    connector: "hdmi-type-a",
    connectorOther: "",
    count: 1,
    signals: [{ domain: "video", transport: "" }]
  };
}

/** Build the ODIO document object from the form state (omitting empty fields). */
function buildDoc(
  device: { manufacturer: string; model: string; category: string; productLine: string; sku: string },
  ports: PortForm[],
  power: PowerForm[]
): Record<string, unknown> {
  const usedIds = new Set<string>();
  const builtPorts = ports.map((p) => {
    let id = slugId(p.label || p.connector);
    while (usedIds.has(id)) id = `${id}-2`;
    usedIds.add(id);
    const port: Record<string, unknown> = {
      id,
      direction: p.direction,
      connector: p.connector,
      signals: p.signals.map((s) => {
        const sig: Record<string, unknown> = { domain: s.domain };
        if (s.transport.trim()) sig.transport = s.transport.trim();
        return sig;
      })
    };
    if (p.label.trim()) port.label = p.label.trim();
    if (p.connector === "other" && p.connectorOther.trim()) port.connectorOther = p.connectorOther.trim();
    if (p.count > 1) port.count = p.count;
    return port;
  });

  const inputs = power
    .map((pw) => {
      const inp: Record<string, unknown> = { type: pw.type };
      if (pw.voltageRange.trim()) inp.voltageRange = pw.voltageRange.trim();
      if (pw.nominalVoltage.trim() && !Number.isNaN(Number(pw.nominalVoltage)))
        inp.nominalVoltage = Number(pw.nominalVoltage);
      if (pw.standard.trim()) inp.standard = pw.standard.trim();
      return inp;
    });

  const doc: Record<string, unknown> = {
    $schema: "https://opendeviceio.org/schema/v0.1/device.schema.json",
    odioVersion: "0.1.0",
    id: `${slugId(device.manufacturer || "mfr")}/${slugId(device.model || "model")}`,
    device: {
      manufacturer: device.manufacturer,
      model: device.model,
      ...(device.category.trim() ? { category: device.category.trim() } : {}),
      ...(device.productLine.trim() ? { productLine: device.productLine.trim() } : {}),
      ...(device.sku.trim() ? { sku: device.sku.trim() } : {})
    },
    ports: builtPorts,
    ...(inputs.length ? { power: { inputs } } : {}),
    provenance: { generator: "opendeviceio.org/author", method: "manual" }
  };
  return doc;
}

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const inputCls =
  "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
const labelCls = "block text-xs font-medium text-slate-500";

export function OdioAuthor({
  signedIn = false,
  brands = []
}: {
  signedIn?: boolean;
  brands?: string[];
}) {
  const [device, setDevice] = useState({
    manufacturer: "",
    model: "",
    category: "",
    productLine: "",
    sku: ""
  });
  const [ports, setPorts] = useState<PortForm[]>([newPort()]);
  const [power, setPower] = useState<PowerForm[]>([]);
  const [publishState, setPublishState] = useState<{ status: "idle" | "busy" | "ok" | "error"; message?: string }>({ status: "idle" });

  const { doc, errors, svg, json } = useMemo(() => {
    const d = buildDoc(device, ports, power);
    const json = JSON.stringify(d, null, 2);
    let errors: string[] = [];
    try {
      const res = validate(d as never);
      errors = res.valid ? [] : res.errors.map((e) => `${e.path || "(root)"}: ${e.message}`);
    } catch (e) {
      errors = [e instanceof Error ? e.message : String(e)];
    }
    let svg: string | null = null;
    if (errors.length === 0) {
      try {
        svg = renderTableSvg(buildIoTable(d as never)).replace(/^<\?xml[^>]*\?>\s*/, "");
      } catch {
        svg = null;
      }
    }
    return { doc: d, errors, svg, json };
  }, [device, ports, power]);

  const setPort = (i: number, patch: Partial<PortForm>) =>
    setPorts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const setSignal = (pi: number, si: number, patch: Partial<SignalForm>) =>
    setPorts((ps) =>
      ps.map((p, j) =>
        j === pi ? { ...p, signals: p.signals.map((s, x) => (x === si ? { ...s, ...patch } : s)) } : p
      )
    );

  const fileBase = slugId(`${device.manufacturer || "device"}-${device.model || ""}`);

  // Publishing is gated to signed-in manufacturers and scoped to their approved
  // brands. The button is convenience over POST /api/v1/devices, which re-checks
  // auth + brand server-side (RLS), so this can't be bypassed from the client.
  const trimmedMfr = device.manufacturer.trim();
  const brandOk = trimmedMfr.length > 0 && brands.includes(trimmedMfr);
  const canPublish = signedIn && errors.length === 0 && brandOk && publishState.status !== "busy";

  const publish = async () => {
    setPublishState({ status: "busy" });
    try {
      const res = await fetch("/api/v1/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: json
      });
      if (res.ok) {
        setPublishState({ status: "ok", message: String((doc as { id?: string }).id ?? "") });
      } else {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setPublishState({ status: "error", message: e.error ?? `HTTP ${res.status}` });
      }
    } catch (e) {
      setPublishState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* ---- Form ---- */}
      <div className="space-y-8">
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Identity</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Manufacturer *</label>
              <input
                className={inputCls}
                value={device.manufacturer}
                onChange={(e) => setDevice({ ...device, manufacturer: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>Model *</label>
              <input
                className={inputCls}
                value={device.model}
                onChange={(e) => setDevice({ ...device, model: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>Category</label>
              <input
                className={inputCls}
                placeholder="av/switcher/matrix"
                value={device.category}
                onChange={(e) => setDevice({ ...device, category: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>Product line</label>
              <input
                className={inputCls}
                value={device.productLine}
                onChange={(e) => setDevice({ ...device, productLine: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>SKU</label>
              <input
                className={inputCls}
                value={device.sku}
                onChange={(e) => setDevice({ ...device, sku: e.target.value })}
              />
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Ports</h2>
            <button
              onClick={() => setPorts((ps) => [...ps, newPort()])}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              + Add port
            </button>
          </div>
          <div className="mt-3 space-y-4">
            {ports.map((p, i) => (
              <div key={p.key} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className={labelCls}>Label</label>
                    <input
                      className={inputCls}
                      placeholder="HDMI IN 1"
                      value={p.label}
                      onChange={(e) => setPort(i, { label: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Direction</label>
                    <select
                      className={inputCls}
                      value={p.direction}
                      onChange={(e) => setPort(i, { direction: e.target.value })}
                    >
                      {DIRECTIONS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Count</label>
                    <input
                      type="number"
                      min={1}
                      className={inputCls}
                      value={p.count}
                      onChange={(e) => setPort(i, { count: Math.max(1, Number(e.target.value) || 1) })}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Connector</label>
                    <select
                      className={inputCls}
                      value={p.connector}
                      onChange={(e) => setPort(i, { connector: e.target.value })}
                    >
                      {CONNECTORS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  {p.connector === "other" ? (
                    <div className="col-span-2">
                      <label className={labelCls}>Connector name (other)</label>
                      <input
                        className={inputCls}
                        value={p.connectorOther}
                        onChange={(e) => setPort(i, { connectorOther: e.target.value })}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <label className={labelCls}>Signals</label>
                    <button
                      onClick={() =>
                        setPort(i, { signals: [...p.signals, { domain: "control", transport: "" }] })
                      }
                      className="text-xs font-medium text-brand-700 hover:text-brand-900"
                    >
                      + signal
                    </button>
                  </div>
                  <div className="mt-1 space-y-2">
                    {p.signals.map((s, si) => (
                      <div key={si} className="flex gap-2">
                        <select
                          className={inputCls}
                          value={s.domain}
                          onChange={(e) => setSignal(i, si, { domain: e.target.value })}
                        >
                          {DOMAINS.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                        <input
                          className={inputCls}
                          placeholder="transport (e.g. hdmi, dante)"
                          value={s.transport}
                          onChange={(e) => setSignal(i, si, { transport: e.target.value })}
                        />
                        {p.signals.length > 1 ? (
                          <button
                            onClick={() =>
                              setPort(i, { signals: p.signals.filter((_, x) => x !== si) })
                            }
                            className="shrink-0 px-2 text-slate-400 hover:text-red-600"
                            aria-label="remove signal"
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 text-right">
                  <button
                    onClick={() => setPorts((ps) => ps.filter((_, j) => j !== i))}
                    className="text-xs font-medium text-slate-400 hover:text-red-600"
                  >
                    Remove port
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Power</h2>
            <button
              onClick={() =>
                setPower((p) => [
                  ...p,
                  { key: k(), type: "ac", voltageRange: "", nominalVoltage: "", standard: "" }
                ])
              }
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-brand-400"
            >
              + Add power input
            </button>
          </div>
          <div className="mt-3 space-y-3">
            {power.map((pw, i) => (
              <div key={pw.key} className="grid grid-cols-4 gap-2 rounded-lg border border-slate-200 bg-white p-3">
                <select
                  className={inputCls}
                  value={pw.type}
                  onChange={(e) => setPower((p) => p.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
                >
                  {POWER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  className={inputCls}
                  placeholder="100-240V"
                  value={pw.voltageRange}
                  onChange={(e) => setPower((p) => p.map((x, j) => (j === i ? { ...x, voltageRange: e.target.value } : x)))}
                />
                <input
                  className={inputCls}
                  placeholder="V (DC)"
                  value={pw.nominalVoltage}
                  onChange={(e) => setPower((p) => p.map((x, j) => (j === i ? { ...x, nominalVoltage: e.target.value } : x)))}
                />
                <div className="flex gap-1">
                  <input
                    className={inputCls}
                    placeholder="std (802.3at)"
                    value={pw.standard}
                    onChange={(e) => setPower((p) => p.map((x, j) => (j === i ? { ...x, standard: e.target.value } : x)))}
                  />
                  <button
                    onClick={() => setPower((p) => p.filter((_, j) => j !== i))}
                    className="shrink-0 px-1 text-slate-400 hover:text-red-600"
                    aria-label="remove power input"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ---- Live preview ---- */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Preview</h2>
          <div className="flex gap-2">
            <button
              disabled={errors.length > 0}
              onClick={() => download(`${fileBase}.odio`, json, "application/vnd.odio+json")}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white enabled:hover:bg-brand-700 disabled:opacity-40"
            >
              Download .odio
            </button>
            <button
              disabled={errors.length > 0}
              onClick={() => download(`${fileBase}.io-table.html`, renderTableHtml(doc as never), "text/html")}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 enabled:hover:border-brand-400 disabled:opacity-40"
            >
              HTML
            </button>
          </div>
        </div>

        {errors.length > 0 ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <strong className="font-semibold">{errors.length} issue(s) to resolve:</strong>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              {errors.slice(0, 8).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            ✓ Valid ODIO document.
          </div>
        )}

        {/* Publish (gated to signed-in manufacturers, scoped to approved brands). */}
        <div className="mt-3">
          {signedIn ? (
            <>
              <button
                onClick={publish}
                disabled={!canPublish}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white enabled:hover:bg-emerald-700 disabled:opacity-40"
              >
                {publishState.status === "busy" ? "Publishing…" : "Publish to registry"}
              </button>
              {errors.length === 0 && !brandOk ? (
                <p className="mt-2 text-xs text-amber-700">
                  Your account isn&apos;t approved to publish for{" "}
                  <strong>{trimmedMfr || "(no manufacturer)"}</strong>. Approved:{" "}
                  {brands.length ? brands.join(", ") : "none"}.{" "}
                  <a className="underline" href="/contribute">
                    Request access
                  </a>
                  .
                </p>
              ) : null}
              {publishState.status === "ok" ? (
                <p className="mt-2 text-xs text-emerald-700">
                  Published as <code className="font-mono">{publishState.message}</code> —{" "}
                  <a className="underline" href={`/registry/${publishState.message}`}>
                    view in registry
                  </a>{" "}
                  (manufacturer-verified).
                </p>
              ) : null}
              {publishState.status === "error" ? (
                <p className="mt-2 text-xs text-red-700">Publish failed: {publishState.message}</p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-slate-500">
              <a className="underline" href="/contribute">
                Sign in as a manufacturer
              </a>{" "}
              to publish this to the registry, or just download it above.
            </p>
          )}
        </div>

        {svg ? (
          <div
            className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : null}

        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-slate-500">View .odio JSON</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
            {json}
          </pre>
        </details>
      </div>
    </div>
  );
}
