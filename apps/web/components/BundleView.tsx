import type { Bundle } from "@opendeviceio/sdk";
import { flattenBundle, bundleBillOfMaterials } from "@opendeviceio/sdk";
import { KindBadge, Chip } from "@/components/Badge";

const KIND_LABEL: Record<string, string> = {
  device: "device",
  cable: "cable",
  accessory: "accessory"
};

export function BundleView({ bundle }: { bundle: Bundle }) {
  const flat = flattenBundle(bundle);
  const bom = bundleBillOfMaterials(bundle);
  const totalDevices = flat.devices.reduce((n, d) => n + d.quantity, 0);
  const totalCables = flat.cables.reduce((n, c) => n + c.quantity, 0);

  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Devices</div>
          <div className="mt-1 font-semibold text-slate-900">{totalDevices}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Cables</div>
          <div className="mt-1 font-semibold text-slate-900">{totalCables}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Accessories</div>
          <div className="mt-1 font-semibold text-slate-900">
            {flat.accessories.length}
          </div>
        </div>
      </div>

      {/* Contained devices */}
      {flat.devices.length ? (
        <section className="mt-10">
          <h2 className="text-xl font-bold text-slate-900">Contained devices</h2>
          <div className="mt-4 space-y-3">
            {flat.devices.map((d, i) => {
              const ports = (d.device.ports ?? []) as unknown[];
              return (
                <div
                  key={i}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <KindBadge kind="device" />
                      <span className="font-semibold text-slate-900">
                        {d.device.device?.model ?? "device"}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      {d.device.device?.manufacturer ?? ""}
                      {d.path.length ? (
                        <span className="ml-2 font-mono text-xs text-slate-400">
                          {d.path.join(" › ")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 whitespace-nowrap text-sm text-slate-600">
                    <span className="font-medium">×{d.quantity}</span>
                    <span className="text-xs text-slate-400">
                      {ports.length} {ports.length === 1 ? "port" : "ports"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Cables */}
      {flat.cables.length ? (
        <section className="mt-10">
          <h2 className="text-xl font-bold text-slate-900">Cables</h2>
          <div className="mt-4 space-y-3">
            {flat.cables.map((c, i) => {
              const cable = c.cable as unknown as {
                model?: string;
                manufacturer?: string;
                lengthLabel?: string;
                ends?: Array<{ connector?: string }>;
                carries?: Array<{ domain?: string; transport?: string }>;
              };
              return (
                <div
                  key={i}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <KindBadge kind="cable" />
                      <span className="font-semibold text-slate-900">
                        {cable.model ?? "cable"}
                      </span>
                      {cable.lengthLabel ? (
                        <span className="text-xs text-slate-500">
                          {cable.lengthLabel}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {(cable.ends ?? []).map((e, j) => (
                        <span key={j} className="flex items-center gap-1">
                          {j > 0 ? <span className="text-slate-400">↔</span> : null}
                          <Chip>{e.connector ?? "?"}</Chip>
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="whitespace-nowrap text-sm font-medium text-slate-600">
                    ×{c.quantity}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Bill of materials */}
      <section className="mt-10">
        <h2 className="text-xl font-bold text-slate-900">Bill of materials</h2>
        <p className="mt-1 text-sm text-slate-500">
          Flattened from the bundle tree with effective quantities.
        </p>
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Type</th>
                <th className="px-4 py-2 font-semibold">Model</th>
                <th className="px-4 py-2 text-right font-semibold">Qty</th>
              </tr>
            </thead>
            <tbody>
              {bom.map((line, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-500">
                    {KIND_LABEL[line.kind] ?? line.kind}
                  </td>
                  <td className="px-4 py-2 font-medium text-slate-900">
                    {line.model}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                    {line.quantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {flat.unresolvedRefs.length ? (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {flat.unresolvedRefs.length} component reference(s) point to external
          documents not yet resolved in this view.
        </p>
      ) : null}
    </div>
  );
}
