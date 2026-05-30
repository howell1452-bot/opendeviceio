import type { OdioDevice } from "@opendeviceio/sdk";
import { estimatedBtuPerHour, poeBudget, rackUnits } from "@opendeviceio/sdk";
import { IoTableView } from "@/components/IoTableView";

interface PortLike {
  direction: string;
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
        <Stat label="In · Out" value={`${inputs.length} · ${outputs.length}`} />
        {typeof maxW === "number" ? <Stat label="Max power" value={`${maxW} W`} /> : null}
        {btu > 0 ? <Stat label="Heat" value={`${Math.round(btu)} BTU/h`} /> : null}
        {poe > 0 ? <Stat label="PoE budget" value={`${poe} W`} /> : null}
        {ru > 0 ? <Stat label="Rack units" value={`${ru} U`} /> : null}
      </div>

      <div className="mt-10">
        <IoTableView document={device} />
      </div>
    </div>
  );
}
