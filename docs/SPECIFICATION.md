# OpenDeviceIO (ODIO) — Specification, Version 0.1

**Status:** Normative · **Format version:** `0.1.0` ·
**Canonical schemas:** [`schema/v0.1/device.schema.json`](../schema/v0.1/device.schema.json)
(`$id`: `https://opendeviceio.org/schema/v0.1/device.schema.json`),
[`schema/v0.1/bundle.schema.json`](../schema/v0.1/bundle.schema.json),
[`schema/v0.1/cable.schema.json`](../schema/v0.1/cable.schema.json)

This document is the human-readable, normative specification of the OpenDeviceIO
(ODIO) format, version 0.1. It is written **from** the canonical JSON Schema, which is
the single source of truth. Where this prose and the schema disagree, **the schema
governs** and the discrepancy is a defect to be fixed in the prose.

ODIO defines three **document kinds** — *device* (the default, no `kind` field), *bundle*,
and *cable* — sharing one connector and signal vocabulary. §2–§13 specify the device
document; §14–§16 specify the bundle and cable documents and the `kind` discriminator.

This specification is licensed under the
[Creative Commons Attribution 4.0 International License (CC BY 4.0)](../LICENSE-docs).
The reference code and schema are licensed under [Apache-2.0](../LICENSE).

---

## 1. Conformance and notation

### 1.1 RFC 2119 keywords

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this document
are to be interpreted as described in RFC 2119 and RFC 8174 when, and only when, they
appear in all capitals.

### 1.2 Conformance

An ODIO document is a single JSON value (RFC 8259) that is a JSON object. It is one of
three **kinds** (§14): a *device*, a *bundle*, or a *cable*.

> A file is **conformant** to ODIO 0.1 if and only if it validates, under JSON Schema
> draft 2020-12, against the schema for its kind: a *device* against
> `schema/v0.1/device.schema.json`, a *bundle* against `schema/v0.1/bundle.schema.json`,
> and a *cable* against `schema/v0.1/cable.schema.json`.

There are no additional conformance requirements beyond schema validation. Any rule in
this prose that is not expressible in, or enforced by, the schema is **advisory** unless
it merely restates a schema constraint. Producers and consumers MUST treat the schema as
authoritative.

A **producer** is any tool or person that emits ODIO documents. A **consumer** is any
tool that reads them. Consumers MUST validate input against the schema before relying on
it, and MUST ignore unknown extension keys (see §4).

ODIO files use the extension **`.odio`** (the legacy **`.odio.json`** is also accepted);
the media type is **`application/vnd.odio+json`**. Content is JSON regardless. See §17.

### 1.3 The conformance corpus

The repository ships a corpus of valid example documents in `examples/*.odio.json` and
intentionally invalid documents in `examples/invalid/*.odio.json`. Every valid example
MUST validate; every invalid example MUST fail validation. The runner
`tools/validate-examples.mjs` (Ajv 2020 + `ajv-formats`) enforces this and is run in CI.
Any conformant implementation SHOULD be able to reproduce these pass/fail results.

---

## 2. Top-level document object

The root is an object. The schema fixes its required and optional members and forbids
unknown non-extension keys (`additionalProperties: false`, plus `patternProperties:
{ "^x-": {} }`).

**Required:** `odioVersion`, `id`, `device`, `ports`.

| Key | Type | Req. | Meaning |
|-----|------|------|---------|
| `$schema` | string (URI) | MAY | URI of the schema this document conforms to. SHOULD be the canonical `$id` for the targeted version. |
| `odioVersion` | string | MUST | Semantic version of the ODIO format this file conforms to. Pattern: `^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$`. For this version it is `"0.1.0"`. |
| `id` | string | MUST | Stable, URL-safe device identifier. See §3. |
| `device` | object | MUST | Device identity and classification. See §5. |
| `ports` | array of `port` | MUST | The device's externally accessible I/O ports. See §6. |
| `power` | object | MAY | Device-level power characteristics. See §9. |
| `physical` | object | MAY | Physical dimensions and mounting. See §10. |
| `standards` | array of `standard` | MAY | Device-level compliance/interoperability standards. See §11. |
| `parameters` | object | MAY | Free-form parametric data. See §12. |
| `provenance` | object | MAY | Source and trust metadata. See §13. |

Producers MAY include `x-*` keys at the root and at every object level (§4).

Minimal conformant skeleton:

```json
{
  "$schema": "https://opendeviceio.org/schema/v0.1/device.schema.json",
  "odioVersion": "0.1.0",
  "id": "acme/widget",
  "device": { "manufacturer": "Acme", "model": "Widget" },
  "ports": [
    {
      "id": "hdmi-in",
      "direction": "input",
      "connector": "hdmi-type-a",
      "signals": [{ "domain": "video", "transport": "hdmi" }]
    }
  ]
}
```

---

## 3. The `id` and slug rule

`id` is the stable join key consumers use to identify a device across catalogs. It is
derived from device identity as:

```
slug(manufacturer) "/" slug(model) [ "@" slug(revision) ]
```

The schema enforces the shape with the pattern:

```
^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*(?:@[a-z0-9][a-z0-9._-]*)?$
```

The **slug rule** producers MUST apply when constructing each segment:

1. Lowercase the text.
2. Replace each `+` character with the literal `-plus` (so `USB+` → `usb-plus`). This is
   special-cased because `+` is common and meaningful in product names (e.g. `sfp+`).
3. Replace each run of characters outside `[a-z0-9._-]` with a single `-`.
4. A segment MUST begin with `[a-z0-9]`. (The manufacturer segment is additionally
   restricted to `[a-z0-9-]` after the first character; model and revision segments also
   allow `.` and `_`.)

Examples: `"Extron"`, `"DTP2 T 211"`, revision `"A"` → `extron/dtp2-t-211@a`.
`"Netgear"`, `"M4250-10G2XF-PoE+"` → `netgear/m4250-10g2xf-poe-plus`.

`id` SHOULD be globally unique for an orderable model. v0.1 defines no central registry;
the manufacturer/model slug is the authority. A future MINOR version MAY add an optional
registry namespace; producers SHOULD NOT rely on collision avoidance beyond the slug.

---

## 4. Extensions and `additionalProperties`

Every core object in the schema sets `"additionalProperties": false` and
`"patternProperties": { "^x-": {} }`. This produces a **closed core with an open edge**:

- A key that is **not** a defined property and does **not** match `^x-` makes the
  document **non-conformant**. Drift (e.g. a misspelled `resolution` where
  `maxResolution` is meant) is therefore caught, not silently accepted.
- A key matching `^x-` (e.g. `x-dtools`, `x-avcad`, `x-note`) is permitted at any object
  level and may hold any JSON value. Consumers MUST ignore `x-*` keys they do not
  understand and MUST NOT treat their presence or absence as affecting validity of the
  core data.

Vendor- and tool-specific data **MUST** live under `x-` namespaces and **MUST NOT** be
proposed for the core unless it is vendor-neutral and broadly useful (see
`GOVERNANCE.md`).

---

## 5. `device` — identity and classification

`type: object`. **Required:** `manufacturer`, `model`. `additionalProperties: false` (+ `x-`).

| Key | Type | Notes |
|-----|------|-------|
| `manufacturer` | string (minLength 1) | REQUIRED. |
| `model` | string (minLength 1) | REQUIRED. |
| `revision` | string | Hardware revision, if applicable. |
| `category` | string | Dotted taxonomy path, e.g. `av/extender/transmitter`, `it/network/switch`. Pattern `^[a-z0-9]+(?:/[a-z0-9-]+)*$`. |
| `productLine` | string | e.g. `DTP2`. |
| `gtin` | string | GTIN/UPC/EAN, pattern `^\d{8,14}$`. |
| `sku` | string | Manufacturer SKU / part number. |
| `productUrl` | string (`format: uri`) | Canonical product page. |
| `datasheetUrl` | string (`format: uri`) | |
| `releaseDate` | string (`format: date`) | ISO 8601 calendar date. |

`manufacturer` and `model` are the basis of `id` (§3). Producers SHOULD keep `id`
consistent with `device.manufacturer`/`model`/`revision`, but the schema does not enforce
that relationship.

---

## 6. `ports` — the three-layer model

`ports` is an array of `port` objects. The port is the heart of ODIO and uses a
**three-layer model** that separates *what the jack is* from *what pipe it provides* from
*what flows ride that pipe*:

1. **Connector** (`port.connector`) — the physical jack only (an RJ45, an XLR-3-F, a
   3.5 mm Euroblock). It says nothing about protocol or speed.
2. **Link** (`port.link`) — the physical transmission layer / "pipe" the connector
   provides (Ethernet at 1 Gb/s with 802.3at PoE; USB with a 60 W PD budget; single-mode
   fiber). Link-level facts that would otherwise be duplicated across flows (PoE, link
   speed, USB power delivery, fiber characteristics) live here **once per port**.
3. **Signals** (`port.signals`) — one or more concurrent **logical flows** the port
   carries (HDMI video + embedded audio + CEC control; or Dante + AES67 + general LAN on
   one RJ45).

This separation is what lets ODIO model real devices accurately: a single network or USB
connector commonly carries several flows at once, and the same connector type can provide
very different links.

### 6.1 `port` object

`type: object`. **Required:** `id`, `direction`, `connector`, `signals`.
`additionalProperties: false` (+ `x-`).

| Key | Type | Req. | Notes |
|-----|------|------|-------|
| `id` | string | MUST | Unique **within this device**. Pattern `^[a-z0-9][a-z0-9._-]*$`. |
| `label` | string | MAY | Human-facing label as silkscreened, e.g. `HDMI INPUT 1`. |
| `direction` | enum | MUST | `input` \| `output` \| `bidirectional`. Overall port direction; individual flows MAY override via `signal.direction`. |
| `connector` | enum | MUST | Controlled connector (physical jack) vocabulary — see the `connector` `$def` in the canonical schema for the full enumeration. Describes the jack only; use `"other"` with `connectorOther` when the jack is not listed. |
| `connectorOther` | string | cond. | Free-text connector name. **REQUIRED when `connector` is `"other"`** (schema `if/then`). |
| `count` | integer ≥ 1 | MAY | Number of **identical, separately addressable** connectors collapsed into this entry. Default 1. |
| `poleCount` | integer ≥ 1 | MAY | Physical poles/pins on a terminal-block-style connector. See §6.2. |
| `poles` | array | MAY | Optional pole-to-function map (pin-level detail). See §6.1.1. |
| `link` | object | MAY | The physical link layer (§8). |
| `signals` | array of `signal` | MUST | One or more concurrent logical flows. `minItems: 1`. See §6.3. |
| `location` | object | MAY | Layout hint for rendering: `face` (`front`/`rear`/`top`/`bottom`/`left`/`right`), `group` (string), `order` (integer ≥ 0). |
| `notes` | string | MAY | |

**`count` vs. individual entries.** Use `count > 1` only when the connectors are
identical *and* their labels/positions do not need to be distinguished. When labels or
positions differ, producers SHOULD emit individual port entries so each can carry its own
`label` and `location`.

#### 6.1.1 `poles` items

Each `poles` entry is an object, **required** `pole`; `additionalProperties: false`
(+ `x-`):

| Key | Type | Notes |
|-----|------|-------|
| `pole` | integer ≥ 1 | The physical pole/pin number. |
| `function` | string | e.g. `tx`, `rx`, `gnd`, `audio-l+`, `gpio-1`. |
| `label` | string | |

### 6.2 `poleCount` vs. `signal.channels` (worked example)

These two numbers answer different questions and **MUST NOT** be conflated:

- **`port.poleCount`** = how many *physical poles/pins* the connector has.
- **`signal.channels`** = how many *independent, separately-routable circuits of one
  flow* the port carries (§6.4).

> **Worked example — RS-232 vs. 8× GPIO on the same physical connector style.**
>
> A **3-pole Phoenix/Euroblock carrying RS-232** has `poleCount: 3` (TX, RX, GND) but
> carries a single logical control circuit, so the control flow has `channels: 1`:
>
> ```json
> {
>   "id": "rs232", "label": "RS-232", "direction": "bidirectional",
>   "connector": "phoenix", "poleCount": 3,
>   "poles": [
>     { "pole": 1, "function": "tx" },
>     { "pole": 2, "function": "rx" },
>     { "pole": 3, "function": "gnd" }
>   ],
>   "signals": [{ "domain": "control", "transport": "rs-232", "channels": 1 }]
> }
> ```
>
> An **8-circuit GPIO block** might be a single 10-pole terminal block (8 GPIO + a
> reference + a +5 V pin). Here `poleCount: 10`, but there are **8** independent control
> circuits, so the control flow has `channels: 8` — and the +5 V pin is a *separate
> power flow* on the same connector:
>
> ```json
> {
>   "id": "gpio", "label": "GPIO", "direction": "bidirectional",
>   "connector": "euroblock-3.5mm", "poleCount": 10,
>   "signals": [
>     { "domain": "control", "transport": "gpio", "channels": 8 },
>     { "domain": "power", "transport": "dc", "role": "source",
>       "nominalVoltage": 5, "maxWatts": 2.5 }
>   ]
> }
> ```
>
> A tool may therefore draw up to 8 separate GPIO connections from one connector. ODIO
> reports the facts (`poleCount`, `channels`); the consuming tool decides how to group or
> render them.

### 6.3 `signals` and the `signal` object

`port.signals` is a non-empty array of `signal` objects. A `signal` is a logical flow.
The **`domain`** member discriminates which attribute set applies; the schema requires a
signal to match **exactly one** of the six domain sub-schemas (`oneOf`):

| `domain` | Sub-schema | §  |
|----------|-----------|----|
| `video` | `signalVideo` | §7.1 |
| `audio` | `signalAudio` | §7.2 |
| `control` | `signalControl` | §7.3 |
| `network` | `signalNetwork` | §7.4 |
| `data` | `signalData` | §7.5 |
| `power` | `signalPower` | §7.6 |

`domain` is REQUIRED on every signal. Each domain object sets
`additionalProperties: false` (+ `x-`).

### 6.4 Shared signal members: `transport`, `direction`, `channels`

Every domain object carries a domain-specific **`transport`** enum naming the
protocol/standard, plus a **`transportOther`** escape and a conditional rule: when
`transport` is `"other"`, `transportOther` is **REQUIRED** (schema `if/then`).

Two members are shared across all domains via reusable `$def`s:

- **`direction`** (`$defs/signalDirection`): `input` \| `output` \| `bidirectional`.
  Direction of *this specific flow*; overrides `port.direction` when present.
- **`channels`** (`$defs/channels`): integer ≥ 1, default 1. Number of independent,
  separately-routable circuits of this flow (see §6.2).

### 6.5 Cross-cutting flows — one port, many transports

Because `signals` is an array, **one physical port carries many concurrent flows**, each
modeled in its natural domain. This is the recommended way to represent rich connectors:

- An **HDMI** port: a `video` flow (`transport: hdmi`) plus an embedded `audio` flow
  (`transport: lpcm`) plus, if applicable, a `control` flow (`transport: cec`).
- A single **RJ45** carrying audio-over-IP and general connectivity: separate `audio`
  flows for `dante` and `aes67`, plus a `network` flow for the management/LAN traffic.
  Link-level facts (1 GbE, PoE) live once on `port.link`, not repeated per flow.

Service-specific media that happens to ride Ethernet (Dante, AES67, SDVoE, NDI, …) is
modeled under its **own media domain** (`audio`/`video`) with the matching `transport`,
**not** as a `network` flow. The `network` domain is for general IP connectivity
(LAN/control/management). A `network` flow MAY additionally list co-carried protocols in
`protocols` when they are not broken out as their own flows.

---

## 7. Signal domains

Across all six domains: `transport` is an enum (with `transportOther` when `"other"`),
and `direction` and `channels` are available (§6.4). Below, only the **domain-specific**
attributes are tabulated.

### 7.1 `video` (`signalVideo`)

`transport` enum: `hdmi`, `displayport`, `dvi`, `vga`, `component`, `composite`,
`s-video`, `sdi-3g`, `sdi-6g`, `sdi-12g`, `hdbaset`, `sdvoe`, `ndi`, `ndi-hx`, `ipmx`,
`dante-av`, `av-over-ip`, `usb-uvc`, `h.264`, `h.265`, `mjpeg`, `other`.

| Key | Type | Notes |
|-----|------|-------|
| `maxResolution` | string | e.g. `4096x2160`, `3840x2160`. |
| `maxRefreshHz` | number > 0 | |
| `colorDepthBits` | integer ≥ 1 | |
| `chromaSubsampling` | enum | `4:4:4` \| `4:2:2` \| `4:2:0`. |
| `hdcp` | string | HDCP version, e.g. `1.4`, `2.2`, `2.3`, or `none`. |
| `hdr` | array of string | Supported HDR formats, e.g. `hdr10`, `hdr10+`, `dolby-vision`, `hlg`. |
| `scaling` | boolean | Port performs scaling/format conversion. |
| `edidManagement` | boolean | |

### 7.2 `audio` (`signalAudio`)

`transport` enum: `analog`, `lpcm`, `aes3`, `spdif`, `adat`, `madi`, `arc`, `earc`,
`dante`, `aes67`, `avb`, `milan`, `cobranet`, `livewire`, `usb-uac`, `bluetooth`, `other`.

| Key | Type | Notes |
|-----|------|-------|
| `maxChannelsPerCircuit` | integer ≥ 1 | Audio channels within one circuit (e.g. 2 for a stereo pair). |
| `networkChannels` | integer ≥ 1 | For audio-over-IP, number of network audio channels (e.g. Dante 64×64 → 64). |
| `levelDbu` | number | Nominal level in dBu (e.g. +4 line). |
| `impedanceOhms` | number > 0 | |
| `sampleRateHz` | integer > 0 | |
| `bitDepth` | integer ≥ 1 | |
| `phantomPower` | boolean | 48 V phantom available (typically mic inputs). |
| `balanced` | boolean | |
| `gainDbRange` | string | Adjustable gain range, e.g. `0-60`. |
| `maxSplDb` | number | Max SPL for a transducer, in dB. |

Note the distinction between **`channels`** (independent circuits on the port),
**`maxChannelsPerCircuit`** (audio channels within one circuit, e.g. a stereo pair), and
**`networkChannels`** (network audio channels for AoIP).

### 7.3 `control` (`signalControl`)

`transport` enum: `rs-232`, `rs-422`, `rs-485`, `ir`, `cec`, `gpio`, `contact-closure`,
`relay`, `usb-hid`, `usb-cdc`, `cresnet`, `knx`, `dali`, `dmx512`, `artnet`, `sacn`,
`onvif`, `sip`, `bacnet`, `modbus`, `mqtt`, `http`, `rest`, `telnet`, `ssh`,
`ip-control`, `other`.

| Key | Type | Notes |
|-----|------|-------|
| `baudRange` | string | e.g. `9600-115200`. |
| `irCarrierKhz` | number > 0 | IR carrier frequency, e.g. 38. |
| `roles` | array of string | e.g. `controller`, `controlled`. |
| `busAddressable` | boolean | Bus protocol where multiple devices share the line (RS-485, DMX, KNX, DALI). |
| `maxBusDevices` | integer ≥ 1 | |

### 7.4 `network` (`signalNetwork`)

General IP connectivity / infrastructure (LAN, control network, management). See §6.5 for
the rule that media-over-IP services are modeled under their own media domain.

`transport` enum: `ethernet`, `ip`, `control-network`, `av-network`, `management`,
`vlan-trunk`, `other`.

| Key | Type | Notes |
|-----|------|-------|
| `vlanCapable` | boolean | |
| `managed` | boolean | |
| `redundancy` | enum | `none` \| `lag` \| `smpte-2022-7` \| `parallel` \| `stp` \| `other`. |
| `protocols` | array of string | Additional transported AV/IT protocols not broken out as separate flows, e.g. `dante`, `ndi`, `sdvoe`. |

### 7.5 `data` (`signalData`)

Non-AV data payload (USB data, mass storage, generic file transfer).

`transport` enum: `usb-data`, `usb-mass-storage`, `thunderbolt`, `file-transfer`, `other`.

| Key | Type | Notes |
|-----|------|-------|
| `rateGbps` | number > 0 | |

### 7.6 `power` (`signalPower`)

Power delivery **as a port's function** (a DC output, 12 V trigger, PDU outlet, speaker
drive). PoE belongs on `link.poe` and USB-PD on `link.powerDeliveryWatts` (§8), **not**
here.

`transport` enum: `ac`, `dc`, `usb-pd`, `phantom`, `trigger`, `wireless-power`, `other`.

| Key | Type | Notes |
|-----|------|-------|
| `role` | enum | `source` (supplies power out of this port) \| `sink` (draws power in). |
| `nominalVoltage` | number | Volts. |
| `maxWatts` | number ≥ 0 | |
| `maxAmps` | number ≥ 0 | |

---

## 8. `link` — the physical transmission layer

`type: object`, all members OPTIONAL, `additionalProperties: false` (+ `x-`). Conditional
rule: when `type` is `"other"`, `typeOther` is REQUIRED.

| Key | Type | Notes |
|-----|------|-------|
| `type` | enum | `ethernet`, `usb`, `thunderbolt`, `sdi`, `hdmi`, `displayport`, `dvi`, `vga`, `analog-audio`, `aes3`, `fiber`, `coax`, `twisted-pair`, `wireless`, `mains`, `dc`, `other`. |
| `typeOther` | string | REQUIRED when `type` is `"other"`. |
| `standard` | string | Transmission standard/version, e.g. `hdmi-2.1`, `dp-1.4`, `12g-sdi`, `hdbaset-3`, `usb-3.2-gen2`, `1000base-t`. |
| `speed` | string | Link speed, e.g. `100m`, `1g`, `2.5g`, `5g`, `10g`, `25g`, `40g`, `100g`. |
| `bandwidthGbps` | number > 0 | Raw link bandwidth in Gbps. |
| `poe` | object | Power over Ethernet — see below. |
| `powerDeliveryWatts` | number ≥ 0 | USB Power Delivery budget, watts. |
| `usbRole` | enum | `host` \| `device` \| `dual-role`. Physical USB role of the connector. |
| `fiberMode` | enum | `single-mode` \| `multi-mode`. |
| `fiberStrands` | integer ≥ 1 | |
| `notes` | string | |

**`link.poe`** object (`additionalProperties: false` + `x-`):

| Key | Type | Notes |
|-----|------|-------|
| `standard` | enum | `802.3af` \| `802.3at` \| `802.3bt-type3` \| `802.3bt-type4` \| `passive` \| `other`. |
| `role` | enum | `pse` (sources power) \| `pd` (consumes power). |
| `classWatts` | number > 0 | |

> **Where power facts live.** PoE → `link.poe`. USB Power Delivery → `link.powerDeliveryWatts`.
> Power that *is* the port's payload (DC out, trigger, PDU outlet) → a `power` signal
> flow (§7.6). Device-level mains/DC input and consumption → the top-level `power`
> object (§9).

---

## 9. `power` — device-level power

`type: object`, all OPTIONAL, `additionalProperties: false` (+ `x-`).

| Key | Type | Notes |
|-----|------|-------|
| `inputs` | array | Power inputs — see below. |
| `consumptionWatts` | object | `typical`, `max`, `standby` (each number ≥ 0). |
| `heatBtuPerHour` | number ≥ 0 | Optional; derivable from watts (W × 3.412) if absent. |
| `redundant` | boolean | True if the device has redundant power supplies. |

Each **`inputs`** item is an object, **required** `type`, `additionalProperties: false` (+ `x-`):

| Key | Type | Notes |
|-----|------|-------|
| `type` | enum | `ac` \| `dc` \| `poe` \| `usb-pd`. |
| `voltageRange` | string | e.g. `100-240V`. |
| `nominalVoltage` | number | Volts (typically DC). |
| `frequencyHz` | string | e.g. `50/60`. |
| `connector` | string | A connector-vocabulary value, e.g. `iec-c14`, `barrel-dc`. |
| `standard` | string | For PoE inputs, e.g. `802.3at`. |

---

## 10. `physical` — dimensions and mounting

`type: object`, all OPTIONAL, `additionalProperties: false` (+ `x-`). **SI units:
dimensions in millimetres, mass in grams.**

| Key | Type | Notes |
|-----|------|-------|
| `dimensionsMm` | object | `width`, `height`, `depth` (each number > 0). |
| `weightGrams` | number > 0 | |
| `rackUnits` | number ≥ 0 | Height in rack units (U); 0 if not rack-mounted; 0.5 for half-U. |
| `rackMountable` | boolean | |
| `rackWidth` | enum | `full` \| `half` \| `third` \| `quarter`. |
| `mounting` | array of enum | `rack`, `surface`, `wall`, `under-table`, `pole`, `ceiling`, `din-rail`, `vesa`, `desktop`. |
| `ipRating` | string | e.g. `IP20`, `IP65`. |
| `color` | string | |

---

## 11. `standards` — device-level compliance

`standards` is an array of `standard` objects (`additionalProperties: false` + `x-`),
each **required** `name`. These are **device-level** compliance/interop standards
(safety, EMC, environmental). Per-signal interop standards (Dante, AES67, …) are
expressed as `signal.transport`, not here.

| Key | Type | Notes |
|-----|------|-------|
| `category` | enum | `safety` \| `emc` \| `env` \| `av` \| `network` \| `wireless` \| `other`. |
| `name` | string (minLength 1) | REQUIRED. e.g. `UL 62368-1`, `FCC Part 15 Class A`, `HDBaseT`, `AES67`, `RoHS`. |
| `detail` | string | |

---

## 12. `parameters` — free-form parametric data

`type: object`. This is the pressure-relief valve for data with no typed home (operating
temperature, latency, MTBF, warranty, …). Keys are arbitrary strings. Each **value**
must match `oneOf`:

- a string,
- a number,
- a boolean, or
- an object with **required** `value` (string/number/boolean) and optional `unit`
  (string); `additionalProperties: false` (+ `x-`).

```json
"parameters": {
  "operatingTemperature": { "value": "0 to 40", "unit": "C" },
  "dspChannels": 64,
  "latency": { "value": 1.5, "unit": "ms" }
}
```

Producers SHOULD prefer typed core fields where one exists and reserve `parameters` for
genuinely uncovered attributes.

---

## 13. `provenance` — source and trust

`type: object`, all OPTIONAL, `additionalProperties: false` (+ `x-`). Provenance is what
makes a file trustworthy: a consumer can distinguish a hand-keyed draft from a
manufacturer-verified file and see which fields a generator was unsure about.

| Key | Type | Notes |
|-----|------|-------|
| `generator` | string | Tool that produced the file, e.g. `genie/0.1.0`, or `manual`. |
| `method` | enum | `llm-extraction` \| `manual` \| `manufacturer`. |
| `sourceDocuments` | array | See below. |
| `validation` | object | `status` (`draft` \| `reviewed` \| `manufacturer-verified`), `by` (string), `date` (`format: date`). |
| `confidence` | object | `overall` (number 0–1), `lowConfidenceFields` (array of JSON paths the generator was unsure about). |

Each **`sourceDocuments`** item (`additionalProperties: false` + `x-`): `title` (string),
`url` (`format: uri`), `sha256` (string, pattern `^[a-f0-9]{64}$`), `retrieved`
(`format: date`).

---

## 14. Document kinds and the `kind` discriminator

ODIO defines **three document kinds**, distinguished by the top-level `kind` member:

| Kind | `kind` value | Required top-level members | Canonical schema |
|------|--------------|----------------------------|------------------|
| Device | *absent* | `odioVersion`, `id`, `device`, `ports` | `device.schema.json` |
| Bundle | `"bundle"` | `odioVersion`, `kind`, `id`, `bundle`, `components` | `bundle.schema.json` |
| Cable | `"cable"` | `odioVersion`, `kind`, `id`, `cable` | `cable.schema.json` |

A **device** document has **no** `kind` member; it is the default kind and is specified by
§2–§13, **unchanged** by the addition of bundles and cables. A **bundle** document MUST set
`kind` to `"bundle"`; a **cable** document MUST set `kind` to `"cable"`.

A consumer **MUST** route on `kind`: a document with no `kind` is a device and MUST be
validated against `device.schema.json`; `kind: "bundle"` selects `bundle.schema.json`;
`kind: "cable"` selects `cable.schema.json`. Consumers MUST validate against the schema for
the resolved kind before relying on the document (§1.2).

All three kinds share the slug-based `id` (§3, identical pattern), the
**`additionalProperties: false`** closed core, and the **`^x-`** extension rule (§4) on
every object. Bundle and cable documents reuse the device schema's `connector` and `signal`
`$def`s by reference, so a connector or signal that is valid in a device is valid,
identically, in a bundle component or a cable.

---

## 15. `bundle` — kits and assemblies

A **bundle** is one orderable part number that contains multiple component devices, nested
sub-assemblies, factory-terminated cables, and non-I/O accessories. Component devices remain
full ODIO devices (a consumer renders each as its own block); the bundle groups and bills
them under the kit part number. The device schema is **not** overloaded — the
"one file = one device" promise (§2) is preserved.

### 15.1 Top-level bundle object

`type: object`. **Required:** `odioVersion`, `kind`, `id`, `bundle`, `components`.
`additionalProperties: false` (+ `x-`).

| Key | Type | Req. | Meaning |
|-----|------|------|---------|
| `$schema` | string | MAY | SHOULD be the canonical `$id` `https://opendeviceio.org/schema/v0.1/bundle.schema.json`. |
| `odioVersion` | string | MUST | Same pattern and value (`"0.1.0"`) as a device document (§2). |
| `kind` | const | MUST | `"bundle"`. The discriminator (§14). |
| `id` | string | MUST | Stable, URL-safe identifier. **Same slug rule and pattern as a device `id`** (§3); for a kit the model segment is the orderable kit part number. |
| `bundle` | object | MUST | Kit identity. See §15.2. |
| `components` | array of `component` | MUST | The kit contents. `minItems: 1`. See §15.3. |
| `standards` | array of `standard` | MAY | Reuses the device `standard` object (§11). |
| `parameters` | object | MAY | Reuses the device `parameters` object (§12). |
| `provenance` | object | MAY | Reuses the device `provenance` object (§13). |

### 15.2 `bundle` — kit identity

`type: object`. **Required:** `manufacturer`, `model`. `additionalProperties: false` (+ `x-`).
The kit's `model` is the **orderable kit part number**.

| Key | Type | Notes |
|-----|------|-------|
| `manufacturer` | string (minLength 1) | REQUIRED. |
| `model` | string (minLength 1) | REQUIRED. Kit/assembly part number. |
| `revision` | string | |
| `category` | string | Dotted taxonomy path; same pattern as `device.category` (§5), e.g. `av/conferencing/kit`, `av/assembly`. |
| `productLine` | string | |
| `sku` | string | |
| `gtin` | string | Pattern `^\d{8,14}$`. |
| `productUrl` | string (`format: uri`) | |
| `datasheetUrl` | string (`format: uri`) | |
| `description` | string | Free-text kit description. |

### 15.3 `components` — kit contents

`components` is a non-empty array. Each component is an object whose **`type`** member
discriminates the shape; the schema requires each component to match **exactly one** of four
sub-schemas (`oneOf`):

| `type` | Meaning | Body |
|--------|---------|------|
| `"device"` | A component device (§15.4). | inline `device`+`ports` **or** `ref`. |
| `"bundle"` | A nested sub-assembly (§15.5). | inline `bundle`+`components` **or** `ref`. |
| `"cable"` | A cable in the kit (§15.6). | inline `cable` **or** `ref`. |
| `"accessory"` | A non-I/O BOM line item (§15.7). | `name` (+ optional model/manufacturer/description). |

**Inline vs. `ref` (§15.8).** For the `device`, `bundle`, and `cable` types, a component
MUST supply **exactly one** of an inline body or a `ref` (enforced by `oneOf` in the schema).
An inline body embeds the full device/bundle/cable; a `ref` `{ id?, url? }` points at an
external document (§15.8). The `accessory` type has no inline-vs-`ref` choice.

**Quantity.** The `device`, `bundle`, `cable`, and `accessory` components each carry an
optional `quantity` (integer ≥ 1, **default 1**). Quantities are **per-component**: when a
consumer flattens a bundle into a flat BOM or block list, it **multiplies quantities down the
tree** (a component appearing `q` times inside a sub-assembly that itself appears `n` times
contributes `n × q`).

**Expansion.** Importers expand a bundle into separate device blocks plus
cables-as-connections, all keyed by the kit part number (`bundle.model`). A nested bundle is
expanded recursively.

### 15.4 `device` component

`type: "device"`. `additionalProperties: false` (+ `x-`). MUST provide **either** an inline
device (`device` **and** `ports`) **or** a `ref` — exactly one (`oneOf`).

| Key | Type | Notes |
|-----|------|-------|
| `type` | const | `"device"`. |
| `quantity` | integer ≥ 1 | Default 1. |
| `designator` | string | MAY. Role/label within the kit, e.g. `Wall Mount Touch Screen`, `UC Engine`. |
| `id` | string | MAY. Optional component-local id; pattern `^[a-z0-9][a-z0-9._-]*$` (the device `port.id` pattern, not the document slug). |
| `device` | object | The device identity object (§5). Part of the inline form. |
| `ports` | array of `port` | The device ports (§6). Part of the inline form. |
| `power` | object | MAY (inline form). Device-level power (§9). |
| `physical` | object | MAY (inline form). Dimensions/mounting (§10). |
| `standards` | array of `standard` | MAY (inline form). |
| `parameters` | object | MAY (inline form). |
| `ref` | object | The reference form (§15.8). |

The inline `device`/`ports`/`power`/`physical`/`standards`/`parameters` members are the same
`$def`s as a top-level device document, so a component device carries the full three-layer
port model (§6).

### 15.5 `bundle` component (nested sub-assembly)

`type: "bundle"`. `additionalProperties: false` (+ `x-`). A bundle within a bundle. MUST
provide **either** an inline sub-assembly (`bundle` **and** `components`) **or** a `ref` —
exactly one (`oneOf`).

| Key | Type | Notes |
|-----|------|-------|
| `type` | const | `"bundle"`. |
| `quantity` | integer ≥ 1 | Default 1. |
| `designator` | string | MAY. |
| `id` | string | MAY. Pattern `^[a-z0-9][a-z0-9._-]*$`. |
| `bundle` | object | Kit identity (§15.2). Part of the inline form. |
| `components` | array of `component` | `minItems: 1`. The sub-assembly's own components, recursively. Part of the inline form. |
| `ref` | object | The reference form (§15.8). |

Nesting is how a kit models a preassembled sub-assembly (e.g. a bracket carrying several
devices). The inline `components` array uses the same `component` schema as §15.3, so
sub-assemblies may themselves nest to any depth.

### 15.6 `cable` component

`type: "cable"`. `additionalProperties: false` (+ `x-`). MUST provide **either** an inline
`cable` **or** a `ref` — exactly one (`oneOf`).

| Key | Type | Notes |
|-----|------|-------|
| `type` | const | `"cable"`. |
| `quantity` | integer ≥ 1 | Default 1. |
| `designator` | string | MAY. Role, e.g. `Primary display`, `UC Engine LAN`. |
| `id` | string | MAY. Pattern `^[a-z0-9][a-z0-9._-]*$`. |
| `cable` | object | The cable body (§16.2). Part of the inline form. |
| `ref` | object | The reference form (§15.8). |

The inline `cable` is exactly the `cable` body specified in §16.2 (the same `$def` the
standalone cable document wraps).

### 15.7 `accessory` component

`type: "accessory"`. **Required:** `type`, `name`. `additionalProperties: false` (+ `x-`).
A non-I/O BOM line item — mounting hardware, brackets, screws — with no ports and no inline
device. There is no `ref` form.

| Key | Type | Notes |
|-----|------|-------|
| `type` | const | `"accessory"`. |
| `name` | string (minLength 1) | REQUIRED. |
| `quantity` | integer ≥ 1 | Default 1. |
| `designator` | string | MAY. |
| `model` | string | Part number, if any. |
| `manufacturer` | string | |
| `description` | string | |

### 15.8 References (`ref`)

A `ref` points at an external device, bundle, or cable document instead of embedding it.

`type: object`. `additionalProperties: false` (+ `x-`). At least one of `id` or `url` is
REQUIRED (`anyOf`).

| Key | Type | Notes |
|-----|------|-------|
| `id` | string | Document id of the referenced device/bundle/cable, e.g. `crestron/tsw-1070-b-s-t-v`. |
| `url` | string (`format: uri`) | Location of the referenced document. |

A `ref` lets standalone products be cited without duplication. **Full by-reference
resolution awaits the device registry** (a future addition; see §3 and `DESIGN.md` §10/§11);
inline components work today and are the recommended form for self-contained kit files.

### 15.9 Bundle example (trimmed)

A trimmed `crestron/uc-cx100-t-wm` showing one of each component type — a device, a nested
sub-assembly (itself containing a device and an accessory), a cable, and a top-level
accessory:

```json
{
  "$schema": "https://opendeviceio.org/schema/v0.1/bundle.schema.json",
  "odioVersion": "0.1.0",
  "kind": "bundle",
  "id": "crestron/uc-cx100-t-wm",
  "bundle": {
    "manufacturer": "Crestron",
    "model": "UC-CX100-T-WM",
    "category": "av/conferencing/kit",
    "productLine": "Crestron Flex"
  },
  "components": [
    {
      "type": "device",
      "designator": "Wall Mount Touch Screen",
      "device": { "manufacturer": "Crestron", "model": "TSW-1070-B-S-T-V", "category": "av/control/touch-panel" },
      "ports": [
        {
          "id": "lan", "label": "LAN", "direction": "bidirectional", "connector": "rj45",
          "link": { "type": "ethernet", "speed": "1g", "poe": { "standard": "802.3at", "role": "pd", "classWatts": 30 } },
          "signals": [{ "domain": "network", "transport": "control-network", "managed": true }]
        }
      ]
    },
    {
      "type": "bundle",
      "designator": "UC Bracket Assembly",
      "bundle": { "manufacturer": "Crestron", "model": "UC-BRKT-260-P-T-ASSY", "category": "av/assembly" },
      "components": [
        {
          "type": "device",
          "designator": "UC Engine",
          "device": { "manufacturer": "Crestron", "model": "UC-ENGINE", "category": "it/compute/uc-engine" },
          "ports": [
            {
              "id": "display", "label": "DISPLAY", "direction": "output", "connector": "hdmi-type-a", "count": 2,
              "link": { "type": "hdmi" },
              "signals": [{ "domain": "video", "transport": "hdmi", "maxResolution": "1920x1080", "maxRefreshHz": 60 }]
            }
          ]
        },
        { "type": "accessory", "name": "Mounting hardware", "description": "Bracket mounting hardware (no I/O)." }
      ]
    },
    {
      "type": "cable",
      "designator": "Primary display",
      "quantity": 1,
      "cable": {
        "manufacturer": "Crestron", "model": "CBL-HD-6", "factoryTerminated": true,
        "lengthMeters": 1.8, "lengthLabel": "6 ft (1.8 m)",
        "carries": [{ "domain": "video", "transport": "hdmi" }],
        "ends": [
          { "connector": "hdmi-type-a", "gender": "male" },
          { "connector": "hdmi-type-a", "gender": "male" }
        ]
      }
    },
    { "type": "accessory", "name": "Mounting hardware" }
  ]
}
```

### 15.10 Modular chassis — frames, cards, and slots

A **modular chassis** (a frame that accepts interchangeable cards) is modeled with two
additive device members plus a bundle slot assignment:

- A **card** is an ordinary `device` with its own `ports`, plus a `card` object:
  `slotType` (REQUIRED — the slot family it fits), `slotSpan` (physical slots occupied,
  default 1), optional `role` (`input`/`output`/`universal`) and `powerDrawW`.
- A **frame** is an ordinary `device` with its own fixed `ports` plus a `slots` array.
  Each slot is `{ id (REQUIRED), label?, accepts? (card `slotType` values; empty/omitted =
  universal), role?, face?, position?, powerBudgetW? }`. An empty frame is a valid device.
- A **populated chassis** is a `bundle` (§15): the frame and its cards are component
  devices, and each card component carries `slot` — the `id` of a frame slot (a
  `device.slots[].id` on the frame component in the same components scope) it occupies.

The aggregate I/O of a populated chassis is the frame's ports plus every populated card's
ports; the standardized I/O table (§18) renders one section per device, labeled by slot.
Beyond JSON Schema, a conforming tool SHOULD check (the SDK's `validateChassis` does): every
`slot` names a real frame slot in scope; no slot is occupied twice; an inline card's
`card.slotType` is in the slot's `accepts`; and `card.powerDrawW` ≤ the slot's `powerBudgetW`.
Internal routing/crosspoint behavior is out of scope (describe it in `parameters` if needed).

`examples/bundles/example-modular-frame-configured.odio.json` is a worked example.

---

## 16. `cable` — typed cables and connections

A **cable** describes a (usually factory-terminated) cable by its typed ends and the signals
it carries. A cable is both a **BOM line item** and, on a schematic, the **edge** between two
devices. A cable MAY be a standalone document (`kind: "cable"`) or embedded inline as a
bundle `cable` component (§15.6) — both use the same `cable` body (§16.2).

### 16.1 Standalone cable document

`type: object`. **Required:** `odioVersion`, `kind`, `id`, `cable`.
`additionalProperties: false` (+ `x-`).

| Key | Type | Req. | Meaning |
|-----|------|------|---------|
| `$schema` | string | MAY | SHOULD be the canonical `$id` `https://opendeviceio.org/schema/v0.1/cable.schema.json`. |
| `odioVersion` | string | MUST | As in a device document (§2). |
| `kind` | const | MUST | `"cable"`. The discriminator (§14). |
| `id` | string | MUST | Stable, URL-safe identifier; **same slug rule and pattern as a device `id`** (§3). |
| `cable` | object | MUST | The cable body. See §16.2. |
| `provenance` | object | MAY | Reuses the device `provenance` object (§13). |

### 16.2 `cable` body

`type: object`. **Required:** `ends`. `additionalProperties: false` (+ `x-`). This is the
shared body, identical whether wrapped as a standalone document (§16.1) or embedded in a
bundle component (§15.6).

| Key | Type | Notes |
|-----|------|-------|
| `manufacturer` | string | |
| `model` | string | Cable part number / model. |
| `sku` | string | |
| `label` | string | |
| `factoryTerminated` | boolean | True if terminated at the factory (vs. field-terminated). |
| `lengthMeters` | number > 0 | SI length. |
| `lengthLabel` | string | Length as printed, e.g. `6 ft (1.8 m)`. |
| `shielded` | boolean | |
| `plenum` | boolean | Plenum-rated jacket. |
| `carries` | array of `signal` | The signal(s) the cable conveys end to end. Reuses the device `signal` model (§6.3/§7) — e.g. a DisplayPort→HDMI cable carries a `video` signal. |
| `ends` | array of `cableEnd` | REQUIRED. The cable's terminations. `minItems: 1`. See §16.3. |
| `notes` | string | |

### 16.3 `cableEnd`

Each `ends` item is an object. **Required:** `connector`. `additionalProperties: false`
(+ `x-`). Conditional rule: when `connector` is `"other"`, `connectorOther` is REQUIRED
(schema `if/then`).

| Key | Type | Notes |
|-----|------|-------|
| `connector` | enum | REQUIRED. The **same `connector` vocabulary as device ports** (§6.1); use `"other"` with `connectorOther` when the jack is not listed. |
| `connectorOther` | string | REQUIRED when `connector` is `"other"`. |
| `gender` | enum | MAY. `male` \| `female`. |
| `id` | string | MAY. |
| `label` | string | MAY. e.g. `Display end`, `To RX`, `A`, `B`. |

A cable usually has **2** ends; **more are allowed** for breakout, snake, or Y-cables
(`minItems: 1`).

### 16.4 Standalone cable example

A DisplayPort-to-HDMI factory cable carrying a video signal:

```json
{
  "$schema": "https://opendeviceio.org/schema/v0.1/cable.schema.json",
  "odioVersion": "0.1.0",
  "kind": "cable",
  "id": "crestron/cbl-4k-dp-hd-6",
  "cable": {
    "manufacturer": "Crestron",
    "model": "CBL-4K-DP-HD-6",
    "factoryTerminated": true,
    "lengthMeters": 1.8,
    "lengthLabel": "6 ft (1.8 m)",
    "carries": [{ "domain": "video", "transport": "displayport" }],
    "ends": [
      { "label": "Source", "connector": "displayport", "gender": "male" },
      { "label": "Display", "connector": "hdmi-type-a", "gender": "male" }
    ]
  }
}
```

---

## 17. The `.odio` file (extension and media type)

An ODIO document is a JSON text (§2). Its on-disk form:

- The RECOMMENDED file extension is **`.odio`**. The extension **`.odio.json`** MAY be
  used and consumers SHOULD accept both. The byte content is identical either way —
  `.odio` is JSON, so any JSON tool can read it.
- The media type is **`application/vnd.odio+json`**. Servers SHOULD send this
  `Content-Type` when serving documents; the `+json` suffix means generic JSON tooling
  still applies.
- Tools MUST NOT require a particular extension to parse a document: routing is by the
  top-level `kind` discriminator (§14) and schema validation, never by filename.

The SDK exposes these as constants (`ODIO_MEDIA_TYPE`, `ODIO_EXTENSION`,
`ODIO_LEGACY_EXTENSION`) and helpers (`isOdioPath`, `odioFilename`).

## 18. The standardized I/O table

ODIO defines a single, deterministic **projection** of a document to a tabular view of
its I/O, so every producer's I/O table is structurally identical (and so a manufacturer
can author once and render the same table onto a spec sheet, a web page, or a report).
The table is **presentation-only**: it is fully derived from the document and has no
semantic effect; two conforming renderers MUST produce equivalent tables for the same
document.

**Rows.** One row per *physical connector instance*: each `port` is count-expanded into
`port.count` rows (default 1). Device-level `power.inputs` (§9) each contribute one
additional row.

**Grouping and order.** Rows are grouped, top to bottom, as **Input → Output →
Bidirectional → Power**, by `port.direction` (power rows last). Within a group, document
order is preserved.

**Columns** (left to right), each derived as follows:

| Column | Derivation |
| --- | --- |
| **Label** | `port.shortLabel` if present, else `port.label`, else `port.id`; a unit number is appended when `port.count > 1`. Power rows use the input `type` (upper-cased). |
| **Direction** | `In` / `Out` / `Bi` from `port.direction`; `Power` for power rows. |
| **Connector** | `port.connector` rendered as a human name (e.g. `hdmi-type-a` → "HDMI"); `port.connectorOther` when `connector` is `other`. |
| **Link** | A summary of `port.link` (§8) in order: `standard` (else `type`), then `speed`/`bandwidthGbps`, then PoE (`poe.standard` as PoE/PoE+/PoE++ with role/class), then USB-PD (`powerDeliveryWatts`), then fiber mode. Power rows summarize voltage/frequency/standard. |
| **Signals** | The distinct concurrent flows on the connector (§6.3), each shown by its `transport` (else `domain`). |

**Bundles** (§15) project to one table section per leaf device (headed by the device
title) plus a **Components** list (each device/cable/accessory with its effective
quantity). Standalone cables (§16) project to a single component row.

Presentation hints — `port.shortLabel`, `port.location.face`, `physical.rackUnits` — MAY
refine a rendering but MUST NOT be required: the table MUST render correctly without them.

A reference renderer is provided in `@opendeviceio/adapters` (`table-svg` for a vector
spec-sheet table, `table-html` for a self-contained viewable page).

## 19. Versioning policy

- **`odioVersion`** is a semantic version (`MAJOR.MINOR.PATCH`, with optional
  pre-release). For this specification it is `0.1.0`.
- **PATCH** releases make editorial or non-normative clarifications that do not change
  what validates.
- **MINOR** releases are additive and backward-compatible: new **optional** fields and
  new **vocabulary entries** (connectors, transports, link types, standards categories).
  A document valid under `X.Y` MUST remain valid under `X.(Y+1)`.
- **MAJOR** releases MAY change required fields or semantics in a backward-incompatible
  way.
- The **`$schema` URL is versioned by MAJOR.MINOR** (`/schema/v0.1/…`). Consumers SHOULD
  select behavior on the MAJOR.MINOR pair and MUST ignore unknown `x-` keys regardless of
  version.

Because every domain enum has an `other` + `*Other` free-text escape, a missing
vocabulary entry **never blocks** an otherwise-valid file; the term can be standardized in
a later MINOR release without breaking existing documents.

**Bundles and cables are additive.** The bundle and cable kinds (§14–§16) leave
`device.schema.json` **unchanged**, so every existing device document remains conformant.
While pre-1.0 the new schemas live under `schema/v0.1/` to avoid churn; at the first tagged
release the `$schema` URL **MAY** bump to `/v0.2/` per the MINOR-bump policy above. Bundle
examples live in `examples/bundles/` so the device conformance corpus (§1.3) is unaffected.

---

## 20. Worked references

The repository's `examples/` directory contains complete, conformant documents that
exercise the model end to end, including:

- `examples/generic-dsp-8gpio.odio.json` — the `poleCount`/`channels` distinction and
  audio-over-IP flows on one RJ45.
- `examples/av-processor-crosscutting.odio.json` — multiple cross-cutting flows on single
  ports.
- `examples/extron-dtp2-t-211.odio.json`, `examples/netgear-m4250-poe.odio.json` — real
  device shapes including HDBaseT links and PoE.
- `examples/bundles/crestron-uc-cx100-t-wm.odio.json` — a kit (§15) demonstrating a nested
  sub-assembly, device components, factory-terminated cable components (§16), and an
  accessory.

The `examples/invalid/` directory documents, by counter-example, the conformance rules in
§1–§7 (missing required field, unsatisfied `other`→`*Other` requirement, and an unknown
non-`x-` core field).

## 21. `network` — device networking class

An optional, device-level block (a sibling of `power` and `physical`) for **network
devices** (switches, routers, gateways). It is a coarse, queryable capability
classification — **not** a model of internal forwarding/routing behavior.

```jsonc
"network": {
  "osiLayers": [2, 3],   // OSI layers the device operates at
  "managed": "managed",  // managed | smart | unmanaged
  "routing": true        // performs L3 routing
}
```

- **`osiLayers`** — a non-empty array of OSI layers (integers 1–7). Use `[2]` for an
  L2-only switch, `[3]` for a router, and `[2, 3]` for an L2+/multilayer switch. This is
  the field that captures the practically important L2-vs-L3 distinction.
- **`managed`** — `managed`, `smart`, or `unmanaged` (for switches).
- **`routing`** — `true` when the device performs Layer-3 routing.

All members are OPTIONAL; omit `network` entirely for non-network devices. The block is
`additionalProperties: false` with the usual `^x-` extension escape hatch.
