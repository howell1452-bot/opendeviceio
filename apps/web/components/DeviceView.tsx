import type { OdioDevice } from "@opendeviceio/sdk";
import { estimatedBtuPerHour, poeBudget, rackUnits } from "@opendeviceio/sdk";
import { Chip } from "@/components/Badge";

// Structural views over the schema shapes (the generated Signal/Port types are
// discriminated unions; we read the common fields the UI needs).
interface SignalLike {
  domain: string;
  transport?: string;
  direction?: string;
  channels?: number;
}
interface LinkLike {
  type?: string;
  standard?: string;
  speed?: string;
  bandwidthGbps?: number;
  poe?: { standard?: string; role?: string; classWatts?: number };
  powerDeliveryWatts?: number;
}
interface PortLike {
  id: string;
  label?: string;
  direction: string;
  connector: string;
  connectorOther?: string;
  count?: number;
  poleCount?: number;
  link?: LinkLike;
  notes?: string;
  signals?: SignalLike[];
}

const DOMAIN_COLOR: Record<string, string> = {
  video: "bg-rose-50 text-rose-700 ring-rose-200",
  audio: "bg-orange-50 text-orange-700 ring-orange-200",
  control: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  network: "bg-sky-50 text-sky-700 ring-sky-200",
  data: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  power: "bg-amber-50 text-amber-700 ring-amber-200"
};

function DirectionTag({ direction }: { direction: string }) {
  const arrow =
    direction === "input" ? "←" : direction === "output" ? "→" : "↔";
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      <span aria-hidden>{arrow}</span>
      {direction}
    </span>
  );
}

function SignalChip({ signal }: { signal: SignalLike }) {
  const color =
    DOMAIN_COLOR[signal.domain] ?? "bg-slate-50 text-slate-700 ring-slate-200";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${color}`}
    >
      <span className="font-semibold">{signal.domain}</span>
      {signal.transport ? <span className="opacity-70">· {signal.transport}</span> : null}
      {typeof signal.channels === "number" && signal.channels > 1 ? (
        <span className="opacity-70">×{signal.channels}</span>
      ) : null}
    </span>
  );
}

function LinkLine({ link }: { link: LinkLike }) {
  const parts: string[] = [];
  if (link.type) parts.push(link.type);
  if (link.standard) parts.push(link.standard);
  if (link.speed) parts.push(link.speed);
  if (typeof link.bandwidthGbps === "number") parts.push(`${link.bandwidthGbps} Gbps`);
  if (typeof link.powerDeliveryWatts === "number")
    parts.push(`USB-PD ${link.powerDeliveryWatts} W`);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span className="font-medium text-slate-500">link</span>
      {parts.length ? <Chip>{parts.join(" · ")}</Chip> : <span className="text-slate-400">—</span>}
      {link.poe ? (
        <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
          PoE {link.poe.standard ?? ""} {link.poe.role ?? ""}
          {typeof link.poe.classWatts === "number" ? ` · ${link.poe.classWatts} W` : ""}
        </span>
      ) : null}
    </div>
  );
}

function PortRow({ port }: { port: PortLike }) {
  const connectorLabel =
    port.connector === "other" && port.connectorOther
      ? port.connectorOther
      : port.connector;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">
            {port.label ?? port.id}
          </span>
          <DirectionTag direction={port.direction} />
          {port.count && port.count > 1 ? (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
              ×{port.count}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Chip>{connectorLabel}</Chip>
          {typeof port.poleCount === "number" ? (
            <span className="text-xs text-slate-500">{port.poleCount}-pole</span>
          ) : null}
        </div>
      </div>

      {port.link ? <div className="mt-2"><LinkLine link={port.link} /></div> : null}

      {port.signals && port.signals.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {port.signals.map((s, i) => (
            <SignalChip key={i} signal={s} />
          ))}
        </div>
      ) : null}

      {port.notes ? (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">{port.notes}</p>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 font-semibold text-slate-900">{value}</div>
    </div>
  );
}

export function DeviceView({ device }: { device: OdioDevice }) {
  const ports = (device.ports ?? []) as unknown as PortLike[];
  const inputs = ports.filter(
    (p) => p.direction === "input" || p.direction === "bidirectional"
  );
  const outputs = ports.filter(
    (p) => p.direction === "output" || p.direction === "bidirectional"
  );

  const btu = estimatedBtuPerHour(device);
  const poe = poeBudget(device);
  const ru = rackUnits(device);
  const maxW = device.power?.consumptionWatts?.max;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Ports" value={String(ports.length)} />
        <Stat
          label="In · Out"
          value={`${inputs.length} · ${outputs.length}`}
        />
        {typeof maxW === "number" ? (
          <Stat label="Max power" value={`${maxW} W`} />
        ) : null}
        {btu > 0 ? (
          <Stat label="Heat" value={`${Math.round(btu)} BTU/h`} />
        ) : null}
        {poe > 0 ? <Stat label="PoE budget" value={`${poe} W`} /> : null}
        {ru > 0 ? <Stat label="Rack units" value={`${ru} U`} /> : null}
      </div>

      <h2 className="mt-10 text-xl font-bold text-slate-900">Ports</h2>
      <p className="mt-1 text-sm text-slate-500">
        Each port shows its connector, link, and the signal flows it carries.
      </p>
      <div className="mt-4 space-y-3">
        {ports.map((port) => (
          <PortRow key={port.id} port={port} />
        ))}
      </div>
    </div>
  );
}
