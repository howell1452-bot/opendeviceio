import type { OpenDeviceIODevice as Device, Port, Signal } from "./types.js";

// The generated `Signal` is a discriminated union keyed on `domain`. For
// ergonomic, schema-faithful access we work with structurally-typed views that
// expose the fields the accessors care about. These mirror the schema's
// $defs/signal* shapes.

export type SignalDomain = "video" | "audio" | "control" | "network" | "data" | "power";

/** Direction values for ports and signal flows. */
export type Direction = "input" | "output" | "bidirectional";

interface SignalLike {
  domain: SignalDomain;
  transport?: string;
  direction?: Direction;
  channels?: number;
}

interface PortLike {
  direction: Direction;
  connector: string;
  count?: number;
  link?: {
    poe?: {
      role?: "pse" | "pd";
      classWatts?: number;
    };
  };
  signals: SignalLike[];
}

function asPort(port: Port): PortLike {
  return port as unknown as PortLike;
}

function asSignal(signal: Signal): SignalLike {
  return signal as unknown as SignalLike;
}

/** Number of physical connectors a port entry represents (count, default 1). */
export function portConnectorCount(port: Port): number {
  const c = asPort(port).count;
  return typeof c === "number" && c >= 1 ? c : 1;
}

/**
 * Ports usable as inputs: direction "input" or "bidirectional".
 * A bidirectional port can carry input flows, so it is included.
 */
export function inputPorts(device: Device): Port[] {
  return device.ports.filter((p) => {
    const d = asPort(p).direction;
    return d === "input" || d === "bidirectional";
  });
}

/**
 * Ports usable as outputs: direction "output" or "bidirectional".
 */
export function outputPorts(device: Device): Port[] {
  return device.ports.filter((p) => {
    const d = asPort(p).direction;
    return d === "output" || d === "bidirectional";
  });
}

/** Ports whose physical connector matches the given connector vocabulary value. */
export function portsByConnector(device: Device, connector: string): Port[] {
  return device.ports.filter((p) => asPort(p).connector === connector);
}

/**
 * Every signal flow across all ports, flattened. Each entry retains a
 * reference to its owning port so callers can relate a flow back to its
 * connector/link.
 */
export function allSignals(device: Device): { port: Port; signal: Signal }[] {
  const out: { port: Port; signal: Signal }[] = [];
  for (const port of device.ports) {
    for (const signal of port.signals) {
      out.push({ port, signal });
    }
  }
  return out;
}

/** All signal flows in the given domain (video, audio, control, ...). */
export function signalsByDomain(
  device: Device,
  domain: SignalDomain
): { port: Port; signal: Signal }[] {
  return allSignals(device).filter(({ signal }) => asSignal(signal).domain === domain);
}

/** All signal flows whose `transport` matches the given value (e.g. "dante"). */
export function signalsByTransport(
  device: Device,
  transport: string
): { port: Port; signal: Signal }[] {
  return allSignals(device).filter(({ signal }) => asSignal(signal).transport === transport);
}

/** The set of distinct signal domains present on a port. */
export function portSignalDomains(port: Port): SignalDomain[] {
  const seen = new Set<SignalDomain>();
  for (const s of port.signals) seen.add(asSignal(s).domain);
  return [...seen];
}

/** The set of distinct transports present on a port. */
export function portSignalTransports(port: Port): string[] {
  const seen = new Set<string>();
  for (const s of port.signals) {
    const t = asSignal(s).transport;
    if (typeof t === "string") seen.add(t);
  }
  return [...seen];
}

/** Total typical power consumption in watts (power.consumptionWatts.typical), or 0. */
export function totalTypicalWatts(device: Device): number {
  return device.power?.consumptionWatts?.typical ?? 0;
}

/** Total maximum power consumption in watts (power.consumptionWatts.max), or 0. */
export function totalMaxWatts(device: Device): number {
  return device.power?.consumptionWatts?.max ?? 0;
}

/**
 * Estimated thermal output in BTU/hour. Uses power.heatBtuPerHour when present;
 * otherwise derives it from the max consumption (watts * 3.412).
 */
export function estimatedBtuPerHour(device: Device): number {
  const explicit = device.power?.heatBtuPerHour;
  if (typeof explicit === "number") return explicit;
  return totalMaxWatts(device) * 3.412;
}

/**
 * Total PoE source budget in watts: the sum, across every port, of
 * link.poe.classWatts where the link sources power (role === "pse"),
 * multiplied by the port's connector count.
 *
 * A port entry with count=8 and a 30W PSE link contributes 8 * 30 = 240W.
 */
export function poeBudget(device: Device): number {
  let total = 0;
  for (const port of device.ports) {
    const poe = asPort(port).link?.poe;
    if (poe && poe.role === "pse" && typeof poe.classWatts === "number") {
      total += poe.classWatts * portConnectorCount(port);
    }
  }
  return total;
}

/** Height in rack units (physical.rackUnits), or 0 when not rack-mounted/unknown. */
export function rackUnits(device: Device): number {
  return device.physical?.rackUnits ?? 0;
}
