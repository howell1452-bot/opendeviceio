import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/CodeBlock";

export const metadata: Metadata = {
  title: "Manufacturer authoring guide",
  description:
    "How to produce a conformant .odio: by hand, with @opendeviceio/sdk, or via the Genie importer — the connector/link/signals model, the id slug rule, the x- extension rule, and how to validate."
};

const TOC = [
  ["what", "What you are producing"],
  ["model", "Connector / link / signals"],
  ["worked", "A worked example"],
  ["id", "The id slug rule"],
  ["extensions", "The x- extension rule"],
  ["sdk", "Authoring with the SDK"],
  ["genie", "Authoring with Genie"],
  ["validate", "Validating your file"]
] as const;

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              On this page
            </div>
            <nav className="mt-3 space-y-1.5 text-sm">
              {TOC.map(([id, label]) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="block text-slate-600 hover:text-brand-700"
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <article className="prose-odio max-w-none">
          <p className="text-sm font-medium uppercase tracking-wide text-brand-700">
            Authoring guide
          </p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">
            Producing a conformant <code>.odio</code>
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            This guide shows three ways to author an ODIO device file — by hand,
            with the TypeScript SDK, or via the Genie importer — and how to validate
            the result. A file is conformant if and only if it validates against the
            canonical schema for its kind.
          </p>

          <h2 id="what">What you are producing</h2>
          <p>
            One <code>.odio</code> file per orderable model. It is a single
            JSON object with a required <code>odioVersion</code>, <code>id</code>,{" "}
            <code>device</code> identity, and <code>ports</code> array, plus optional{" "}
            <code>power</code>, <code>physical</code>, <code>standards</code>,{" "}
            <code>parameters</code>, and <code>provenance</code> blocks. Start every
            file by pointing <code>$schema</code> at the canonical URL so editors and
            validators resolve it:
          </p>
          <CodeBlock language="skeleton">{`{
  "$schema": "https://opendeviceio.org/schema/v0.1/device.schema.json",
  "odioVersion": "0.1.0",
  "id": "acme/widget-100",
  "device": { "manufacturer": "Acme", "model": "Widget 100" },
  "ports": []
}`}</CodeBlock>

          <h2 id="model">The connector / link / signals model</h2>
          <p>
            Each port separates three things. Get this right and the rest follows:
          </p>
          <ul>
            <li>
              <strong>connector</strong> — the physical jack only, from the
              controlled vocabulary (<code>rj45</code>, <code>hdmi-type-a</code>,{" "}
              <code>usb-c</code>, <code>phoenix</code>, <code>xlr-3-f</code>…).
              Unknown connectors use <code>&quot;connector&quot;: &quot;other&quot;</code>{" "}
              plus free text so a missing term never blocks a file. A multi-pole
              terminal block records its physical <code>poleCount</code>.
            </li>
            <li>
              <strong>link</strong> — the physical pipe: <code>type</code>,{" "}
              <code>standard</code>, <code>speed</code>/<code>bandwidthGbps</code>,
              and link-level facts such as PoE (
              <code>{`{ standard, role, classWatts }`}</code>) or USB{" "}
              <code>powerDeliveryWatts</code>. State it once per port.
            </li>
            <li>
              <strong>signals</strong> — the concurrent logical flows. One connector
              may carry several: an HDMI port carries <code>video</code> +{" "}
              <code>audio</code> + <code>control</code> (CEC); one RJ45 can carry{" "}
              <code>dante</code> + <code>aes67</code> + LAN. Keep the physical pole
              count (on the connector) separate from the number of logical circuits
              (<code>signal.channels</code>).
            </li>
          </ul>
          <p>
            The canonical worked example of that last point: a 3-pole Phoenix RS-232
            port is one connector with one control circuit, whereas an 8-pole Phoenix
            GPIO header is one connector carrying eight independent control circuits
            (<code>channels: 8</code>).
          </p>

          <h2 id="worked">A worked example</h2>
          <p>
            An HDMI input that carries video and embedded audio, plus a phoenix GPIO
            header showing the pole-count-vs-channels distinction:
          </p>
          <CodeBlock language="ports">{`"ports": [
  {
    "id": "hdmi-in-1", "label": "HDMI INPUT 1", "direction": "input",
    "connector": "hdmi-type-a", "count": 1,
    "link": { "type": "hdmi", "standard": "hdmi-2.0", "bandwidthGbps": 18 },
    "location": { "face": "rear", "group": "inputs", "order": 1 },
    "signals": [
      { "domain": "video", "transport": "hdmi",
        "maxResolution": "4096x2160", "maxRefreshHz": 60, "hdcp": "2.2" },
      { "domain": "audio", "transport": "lpcm", "maxChannelsPerCircuit": 8 }
    ]
  },
  {
    "id": "gpio", "label": "GPIO", "direction": "bidirectional",
    "connector": "phoenix", "poleCount": 8,
    "signals": [
      { "domain": "control", "transport": "gpio", "channels": 8 }
    ]
  },
  {
    "id": "lan", "label": "LAN", "direction": "bidirectional",
    "connector": "rj45",
    "link": {
      "type": "ethernet", "standard": "1000base-t", "speed": "1g",
      "poe": { "standard": "802.3at", "role": "pd", "classWatts": 30 }
    },
    "signals": [
      { "domain": "network", "transport": "control-network", "managed": true },
      { "domain": "control", "transport": "ip-control" }
    ]
  }
]`}</CodeBlock>

          <h2 id="id">The id slug rule</h2>
          <p>
            The <code>id</code> is the stable join key. It is derived as{" "}
            <code>slug(manufacturer)/slug(model)[@slug(revision)]</code>. The slug
            rule:
          </p>
          <ul>
            <li>lowercase everything;</li>
            <li>
              replace <code>+</code> with <code>-plus</code>;
            </li>
            <li>
              collapse runs of any other character outside{" "}
              <code>[a-z0-9._-]</code> into a single <code>-</code>.
            </li>
          </ul>
          <p>
            So <code>Lightware</code> / <code>UCX-4x2-HC60D</code> becomes{" "}
            <code>lightware/ucx-4x2-hc60d</code>, and{" "}
            <code>Extron</code> / <code>DTP2 T 211</code> revision <code>A</code>{" "}
            becomes <code>extron/dtp2-t-211@a</code>.
          </p>

          <h2 id="extensions">The <code>^x-</code> extension rule</h2>
          <p>
            The core schema sets <code>additionalProperties: false</code>, so an
            unrecognized non-extension key makes the file invalid — drift is caught,
            not silently accepted. To add vendor- or tool-specific data, use a key
            matching <code>^x-</code> at any object level; validators MUST ignore
            unknown <code>x-</code> keys.
          </p>
          <CodeBlock language="extension keys">{`{
  "id": "acme/widget-100",
  "device": { "manufacturer": "Acme", "model": "Widget 100" },
  "ports": [ /* ... */ ],
  "x-dtools": { "category": "Switchers" },
  "x-note": "Free-form note for reviewers; ignored by validators."
}`}</CodeBlock>

          <h2 id="sdk">Authoring with the SDK</h2>
          <p>
            <code>@opendeviceio/sdk</code> ships the generated TypeScript types, an
            Ajv 2020 validator, and convenience accessors. Author the object with
            full type-checking, then validate:
          </p>
          <CodeBlock language="typescript">{`import {
  type OdioDevice,
  validateDocument,
  formatErrors,
  inputPorts,
  poeBudget
} from "@opendeviceio/sdk";

const device: OdioDevice = {
  $schema: "https://opendeviceio.org/schema/v0.1/device.schema.json",
  odioVersion: "0.1.0",
  id: "acme/widget-100",
  device: { manufacturer: "Acme", model: "Widget 100" },
  ports: [
    {
      id: "lan", label: "LAN", direction: "bidirectional", connector: "rj45",
      link: { type: "ethernet", standard: "1000base-t", speed: "1g" },
      signals: [{ domain: "network", transport: "control-network" }]
    }
  ]
};

// validateDocument routes on \`kind\` (device | bundle | cable).
const result = validateDocument(device);
if (!result.valid) {
  console.error(formatErrors(result.errors));
  process.exit(1);
}

// Accessors derive useful facts straight from the document:
console.log(inputPorts(device).length, "input-capable ports");
console.log(poeBudget(device), "W of PoE source budget");`}</CodeBlock>
          <p>
            Other accessors include <code>outputPorts</code>,{" "}
            <code>signalsByDomain</code>, <code>signalsByTransport</code>,{" "}
            <code>estimatedBtuPerHour</code>, <code>rackUnits</code>, and — for kits
            — <code>flattenBundle</code> and <code>bundleBillOfMaterials</code>.
          </p>

          <h2 id="genie">Authoring with Genie</h2>
          <p>
            Genie is the reference importer: it reads a product PDF and emits a{" "}
            <code>draft</code> <code>.odio</code> plus a review report flagging
            low-confidence fields. The intended workflow is{" "}
            <strong>generate → human-review → publish</strong>, promoting the
            document&apos;s <code>provenance.validation.status</code> from{" "}
            <code>draft</code> to <code>reviewed</code> (or{" "}
            <code>manufacturer-verified</code>) as it is checked.
          </p>
          <CodeBlock language="shell">{`# Generate a draft from a datasheet, with a review report:
genie parse datasheet.pdf -o widget-100.odio --review-report review.md

# The Claude API key is supplied at runtime via an env var; Genie never ships one.`}</CodeBlock>

          <h2 id="validate">Validating your file</h2>
          <p>
            Validation is the whole contract. Use the SDK&apos;s{" "}
            <code>validateDocument</code> programmatically (above), or the repo&apos;s
            conformance runner to validate a directory of examples against the schema
            with Ajv 2020:
          </p>
          <CodeBlock language="shell">{`# From the repo root — validates every examples/*.odio.json and confirms the
# examples/invalid/* fixtures fail, exactly as CI does:
npm install
npm run validate:examples     # node tools/validate-examples.mjs`}</CodeBlock>
          <p>
            Once your file validates, you can{" "}
            <Link href="/registry">browse the registry</Link> to see how published
            devices, bundles, and cables render, or fetch the canonical{" "}
            <a href="/schema/v0.1/device.schema.json">device</a>,{" "}
            <a href="/schema/v0.1/bundle.schema.json">bundle</a>, and{" "}
            <a href="/schema/v0.1/cable.schema.json">cable</a> schemas directly.
          </p>
        </article>
      </div>
    </div>
  );
}
