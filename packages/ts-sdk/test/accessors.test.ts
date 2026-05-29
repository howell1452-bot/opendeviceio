import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parse,
  inputPorts,
  outputPorts,
  portsByConnector,
  portConnectorCount,
  allSignals,
  signalsByDomain,
  signalsByTransport,
  portSignalDomains,
  portSignalTransports,
  totalTypicalWatts,
  totalMaxWatts,
  estimatedBtuPerHour,
  poeBudget,
  rackUnits,
  type OdioDevice,
  type Port
} from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(here, "..", "..", "..", "examples");

function loadDevice(name: string): OdioDevice {
  return parse(readFileSync(path.join(examplesDir, name), "utf8"));
}

const crosscutting = loadDevice("av-processor-crosscutting.odio.json");
const dsp = loadDevice("generic-dsp-8gpio.odio.json");
const netgear = loadDevice("netgear-m4250-poe.odio.json");
const extron = loadDevice("extron-dtp2-t-211.odio.json");

function portById(device: OdioDevice, id: string): Port {
  const p = device.ports.find((x) => (x as { id: string }).id === id);
  if (!p) throw new Error(`port ${id} not found`);
  return p;
}

describe("cross-cutting example: lan-a port", () => {
  const lanA = portById(crosscutting, "lan-a");

  it("carries 5 concurrent signal flows", () => {
    expect(lanA.signals).toHaveLength(5);
  });

  it("spans the expected domains", () => {
    expect(new Set(portSignalDomains(lanA))).toEqual(
      new Set(["audio", "video", "control", "network"])
    );
  });

  it("spans the expected transports", () => {
    expect(new Set(portSignalTransports(lanA))).toEqual(
      new Set(["dante", "aes67", "av-over-ip", "ip-control", "control-network"])
    );
  });
});

describe("DSP gpio port", () => {
  const gpio = portById(dsp, "gpio");

  it("gpio control signal has channels=8", () => {
    const gpioSignal = gpio.signals.find(
      (s) => (s as { transport?: string }).transport === "gpio"
    ) as { channels?: number } | undefined;
    expect(gpioSignal?.channels).toBe(8);
  });

  it("also carries a 5V DC power source flow", () => {
    const power = signalsByDomain(dsp, "power").find(
      ({ port }) => (port as { id: string }).id === "gpio"
    );
    expect(power).toBeDefined();
    expect((power!.signal as { nominalVoltage?: number }).nominalVoltage).toBe(5);
  });
});

describe("poeBudget", () => {
  it("netgear ge-poe contributes 8 * 30W = 240W (count multiplies classWatts)", () => {
    expect(poeBudget(netgear)).toBe(240);
  });

  it("ignores PD links (crosscutting lan-a is role=pd, not a source)", () => {
    expect(poeBudget(crosscutting)).toBe(0);
  });

  it("portConnectorCount reflects count=8 on ge-poe", () => {
    expect(portConnectorCount(portById(netgear, "ge-poe"))).toBe(8);
  });
});

describe("port direction filters", () => {
  it("inputPorts includes bidirectional ports", () => {
    // crosscutting: lan-a (bi), usb-c (bi) are inputs; hdmi-out (output) is not.
    const ids = inputPorts(crosscutting).map((p) => (p as { id: string }).id);
    expect(ids).toEqual(["lan-a", "usb-c-front"]);
  });

  it("outputPorts includes bidirectional and output ports", () => {
    const ids = outputPorts(crosscutting).map((p) => (p as { id: string }).id);
    expect(ids).toEqual(["lan-a", "usb-c-front", "hdmi-out"]);
  });

  it("extron has 3 pure inputs plus 1 bidirectional", () => {
    const ids = inputPorts(extron).map((p) => (p as { id: string }).id);
    expect(ids).toEqual(["hdmi-in", "vga-in", "analog-audio-in", "rs232"]);
  });
});

describe("connector and signal lookups", () => {
  it("portsByConnector finds all euroblock ports on the DSP", () => {
    const ids = portsByConnector(dsp, "euroblock-3.5mm").map(
      (p) => (p as { id: string }).id
    );
    expect(ids).toEqual(["mic-line-in", "line-out", "gpio", "rs485"]);
  });

  it("allSignals flattens every flow with its owning port", () => {
    const total = dsp.ports.reduce((n, p) => n + p.signals.length, 0);
    expect(allSignals(dsp)).toHaveLength(total);
  });

  it("signalsByTransport finds the two dante flows in crosscutting", () => {
    const dante = signalsByTransport(crosscutting, "dante");
    expect(dante).toHaveLength(1);
    expect((dante[0].port as { id: string }).id).toBe("lan-a");
  });

  it("signalsByDomain groups audio flows", () => {
    // crosscutting audio flows: dante, aes67 (lan-a); usb-uac (usb-c); lpcm, earc (hdmi-out)
    expect(signalsByDomain(crosscutting, "audio")).toHaveLength(5);
  });
});

describe("power and heat", () => {
  it("totalTypicalWatts / totalMaxWatts read consumptionWatts", () => {
    expect(totalTypicalWatts(crosscutting)).toBe(22);
    expect(totalMaxWatts(crosscutting)).toBe(45);
  });

  it("estimatedBtuPerHour derives from max watts when heatBtuPerHour absent", () => {
    expect(estimatedBtuPerHour(netgear)).toBeCloseTo(280 * 3.412, 5);
  });

  it("rackUnits reads physical.rackUnits", () => {
    expect(rackUnits(extron)).toBe(0.5);
    expect(rackUnits(netgear)).toBe(1);
  });
});
