# @opendeviceio/sdk

TypeScript SDK for the **OpenDeviceIO** (`.odio.json`) format — generated types,
an [Ajv](https://ajv.js.org/) 2020 validator, and convenience accessors, built
against the canonical v0.1 device schema.

The schema is the single source of truth. This package **bundles a self-contained
copy** of `schema/v0.1/device.schema.json` at build time (`src/schema.ts`), so the
published package never depends on the location of the schema on disk. The TypeScript
`Device` interface in `src/types.ts` is generated from that same schema with
[`json-schema-to-typescript`](https://github.com/bcherny/json-schema-to-typescript)
and committed as source, so consumers get types without running codegen.

Ships as **ESM + CJS**, fully typed.

## Install

```sh
npm install @opendeviceio/sdk
```

## Usage

### Validate a document

```ts
import { validate } from "@opendeviceio/sdk";

const result = validate(JSON.parse(fileContents));
if (!result.valid) {
  for (const e of result.errors) {
    console.error(`${e.path}: ${e.message}`);
  }
}
```

`validate(obj)` never throws and returns:

```ts
{ valid: boolean; errors: ValidationError[] }
// ValidationError = { path, keyword, message, params }
```

### Parse with typed result (throws on invalid)

```ts
import { parse, OdioValidationError } from "@opendeviceio/sdk";

try {
  const device = parse(fileContents); // string or already-parsed object
  console.log(device.device.manufacturer, device.device.model);
} catch (err) {
  if (err instanceof OdioValidationError) {
    console.error(err.message); // readable, multi-line list of failures
  } else {
    throw err; // e.g. SyntaxError for malformed JSON
  }
}
```

### Accessors

All accessors operate on a validated `Device` and correctly handle the layered
model (`port.link`, `port.signals[]`, `signal.transport`, `signal.channels`,
`port.count` — a port with `count: 8` represents 8 connectors).

```ts
import {
  inputPorts,
  outputPorts,
  portsByConnector,
  allSignals,
  signalsByDomain,
  signalsByTransport,
  totalTypicalWatts,
  totalMaxWatts,
  estimatedBtuPerHour,
  poeBudget,
  rackUnits
} from "@opendeviceio/sdk";

inputPorts(device);                       // direction input | bidirectional
outputPorts(device);                      // direction output | bidirectional
portsByConnector(device, "rj45");         // ports by connector vocabulary value
allSignals(device);                       // [{ port, signal }, ...] flattened
signalsByDomain(device, "audio");         // flows in a domain
signalsByTransport(device, "dante");      // flows by transport
totalTypicalWatts(device);                // power.consumptionWatts.typical
totalMaxWatts(device);                    // power.consumptionWatts.max
estimatedBtuPerHour(device);              // heatBtuPerHour, else maxWatts * 3.412
poeBudget(device);                        // sum of link.poe.classWatts * count, role === "pse"
rackUnits(device);                        // physical.rackUnits
```

For example, a switch port `{ count: 8, link: { poe: { role: "pse", classWatts: 30 } } }`
contributes `8 * 30 = 240` W to `poeBudget(device)`.

## Scripts

| Command            | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `npm run gen-types`| Regenerate `src/schema.ts` and `src/types.ts` from the canonical schema.    |
| `npm run build`    | Run `gen-types`, then compile ESM + CJS with type declarations into `dist/`.|
| `npm test`         | Run the Vitest suite (conformance corpus + accessor unit tests).            |
| `npm run validate` | Validate `.odio.json` files (defaults to the repo example corpus) via CLI.  |

## Development

```sh
npm install     # inside packages/ts-sdk only
npm run build
npm test
```
