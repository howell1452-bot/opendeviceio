import type {
  OpenDeviceIOBundle as Bundle,
  Component,
  DeviceComponent,
  BundleComponent,
  CableComponent,
  AccessoryComponent,
  Ref,
  Device,
  Port,
  Power,
  Physical,
  Standard,
  Parameters,
  Cable,
  Slot,
  Card
} from "./bundle-types.js";

/**
 * The inline device-document fields of an expanded device leaf: the identity
 * (`device`) plus its ports and optional facets, mirroring a device component.
 */
export interface FlattenedDevice {
  device: Device;
  ports: Port[];
  power?: Power;
  physical?: Physical;
  standards?: Standard[];
  parameters?: Parameters;
  /** Modular-chassis frame slot topology, when this leaf is a frame. */
  slots?: Slot[];
  /** Card-fit block, when this leaf is a plug-in card. */
  card?: Card;
}

/** A device leaf produced by {@link flattenBundle}. */
export interface FlatDeviceEntry {
  /** The inline device document fields (identity + ports + optional facets). */
  device: FlattenedDevice;
  /** Effective quantity: the product of quantities down the bundle tree. */
  quantity: number;
  /** Designators of the components on the path to (and including) this leaf. */
  designators: string[];
  /** Designator/model chain from the root bundle down to this leaf. */
  path: string[];
  /** Frame slot id this card occupies (from the component's slot assignment). */
  slot?: string;
}

/** A cable leaf produced by {@link flattenBundle}. */
export interface FlatCableEntry {
  cable: Cable;
  quantity: number;
  designators: string[];
  path: string[];
}

/** An accessory leaf produced by {@link flattenBundle}. */
export interface FlatAccessoryEntry {
  accessory: AccessoryComponent;
  quantity: number;
  designators: string[];
  path: string[];
}

/** An unresolved reference recorded by {@link flattenBundle}. */
export interface UnresolvedRefEntry {
  type: "device" | "bundle" | "cable";
  ref: Ref;
  path: string[];
}

/** The fully-expanded contents of a bundle. */
export interface FlattenedBundle {
  devices: FlatDeviceEntry[];
  cables: FlatCableEntry[];
  accessories: FlatAccessoryEntry[];
  unresolvedRefs: UnresolvedRefEntry[];
}

/** A document a resolver may return for a {@link Ref}. */
export type ResolvedDocument =
  | ({ kind?: "device" } & Record<string, unknown>)
  | Bundle
  | ({ kind?: "cable"; cable?: Cable } & Record<string, unknown>);

export interface FlattenOptions {
  /**
   * Resolve a `ref` component to a full document (device, bundle, or cable).
   * Return `undefined` (or omit the resolver entirely) to leave the reference
   * unresolved; it is then recorded in {@link FlattenedBundle.unresolvedRefs}.
   */
  resolve?: (ref: Ref) => ResolvedDocument | undefined;
}

function qty(c: { quantity?: number }): number {
  const q = c.quantity;
  return typeof q === "number" && q >= 1 ? q : 1;
}

function bundleLabel(b: { bundle?: { model?: string } }): string {
  return b.bundle?.model ?? "bundle";
}

function deviceLabel(dc: DeviceComponent): string {
  return dc.designator ?? dc.device?.model ?? "device";
}

function cableLabel(cc: CableComponent): string {
  return cc.designator ?? cc.cable?.model ?? "cable";
}

/**
 * Recursively expand a bundle into its leaf contents.
 *
 * Quantities multiply down the tree: a device with quantity 2 inside a
 * sub-bundle included with quantity 3 yields an effective quantity of 6. Nested
 * bundle components are recursed into; `ref` components are resolved via
 * `opts.resolve` when provided, otherwise (or when the resolver returns
 * undefined) recorded in `unresolvedRefs` without throwing. `path` records the
 * designator/model chain from the root bundle to each leaf.
 */
export function flattenBundle(
  bundle: Bundle,
  opts: FlattenOptions = {}
): FlattenedBundle {
  const out: FlattenedBundle = {
    devices: [],
    cables: [],
    accessories: [],
    unresolvedRefs: []
  };
  const resolve = opts.resolve;

  function walkComponents(
    components: Component[],
    factor: number,
    path: string[],
    designators: string[]
  ): void {
    for (const component of components) {
      walk(component, factor, path, designators);
    }
  }

  function walk(
    component: Component,
    factor: number,
    path: string[],
    designators: string[]
  ): void {
    const effective = factor * qty(component);
    const designator = (component as { designator?: string }).designator;
    const nextDesignators = designator ? [...designators, designator] : designators;

    switch (component.type) {
      case "device": {
        const dc = component as DeviceComponent;
        if (dc.ref) {
          handleRef("device", dc.ref, effective, path, nextDesignators, dc);
          return;
        }
        out.devices.push({
          device: {
            device: dc.device as Device,
            ports: dc.ports ?? [],
            ...(dc.power !== undefined ? { power: dc.power } : {}),
            ...(dc.physical !== undefined ? { physical: dc.physical } : {}),
            ...(dc.standards !== undefined ? { standards: dc.standards } : {}),
            ...(dc.parameters !== undefined ? { parameters: dc.parameters } : {}),
            ...(dc.slots !== undefined ? { slots: dc.slots } : {}),
            ...(dc.card !== undefined ? { card: dc.card } : {})
          },
          quantity: effective,
          designators: nextDesignators,
          path: [...path, deviceLabel(dc)],
          ...(typeof dc.slot === "string" ? { slot: dc.slot } : {})
        });
        return;
      }
      case "bundle": {
        const bc = component as BundleComponent;
        if (bc.ref) {
          handleRef("bundle", bc.ref, effective, path, nextDesignators, bc);
          return;
        }
        const childPath = [...path, bc.designator ?? bundleLabel(bc)];
        walkComponents(
          (bc.components ?? []) as Component[],
          effective,
          childPath,
          nextDesignators
        );
        return;
      }
      case "cable": {
        const cc = component as CableComponent;
        if (cc.ref) {
          handleRef("cable", cc.ref, effective, path, nextDesignators, cc);
          return;
        }
        out.cables.push({
          cable: cc.cable as Cable,
          quantity: effective,
          designators: nextDesignators,
          path: [...path, cableLabel(cc)]
        });
        return;
      }
      case "accessory": {
        const ac = component as AccessoryComponent;
        out.accessories.push({
          accessory: ac,
          quantity: effective,
          designators: nextDesignators,
          path: [...path, ac.designator ?? ac.name]
        });
        return;
      }
    }
  }

  function handleRef(
    type: "device" | "bundle" | "cable",
    ref: Ref,
    factor: number,
    path: string[],
    designators: string[],
    component: Component
  ): void {
    const resolved = resolve?.(ref);
    if (resolved === undefined) {
      out.unresolvedRefs.push({ type, ref, path: [...path, refLabel(ref)] });
      return;
    }
    const designator = (component as { designator?: string }).designator;
    const r = resolved as Record<string, unknown>;
    if (type === "device") {
      const dc = component as DeviceComponent;
      out.devices.push({
        device: {
          device: r.device as Device,
          ports: (r.ports as Port[] | undefined) ?? [],
          ...(r.power !== undefined ? { power: r.power as Power } : {}),
          ...(r.physical !== undefined ? { physical: r.physical as Physical } : {}),
          ...(r.standards !== undefined ? { standards: r.standards as Standard[] } : {}),
          ...(r.parameters !== undefined ? { parameters: r.parameters as Parameters } : {}),
          // Frame slots / card-fit may come from the resolved doc or the component.
          ...((r.slots ?? dc.slots) !== undefined ? { slots: (r.slots ?? dc.slots) as Slot[] } : {}),
          ...((r.card ?? dc.card) !== undefined ? { card: (r.card ?? dc.card) as Card } : {})
        },
        quantity: factor,
        designators,
        path: [...path, designator ?? (r.device as Device)?.model ?? "device"],
        ...(typeof dc.slot === "string" ? { slot: dc.slot } : {})
      });
    } else if (type === "cable") {
      out.cables.push({
        cable: r.cable as Cable,
        quantity: factor,
        designators,
        path: [...path, designator ?? (r.cable as Cable)?.model ?? "cable"]
      });
    } else {
      // bundle ref: recurse into the resolved bundle's components.
      const resolvedBundle = resolved as Bundle;
      const childPath = [
        ...path,
        designator ?? resolvedBundle.bundle?.model ?? "bundle"
      ];
      walkComponents(
        (resolvedBundle.components ?? []) as Component[],
        factor,
        childPath,
        designators
      );
    }
  }

  function refLabel(ref: Ref): string {
    return (ref.id as string | undefined) ?? (ref.url as string | undefined) ?? "ref";
  }

  const rootPath = [bundle.bundle?.model ?? "bundle"];
  walkComponents((bundle.components ?? []) as Component[], 1, rootPath, []);
  return out;
}

/** Sum of effective device quantities across the whole (flattened) bundle. */
export function bundleDeviceCount(bundle: Bundle): number {
  return flattenBundle(bundle).devices.reduce((n, d) => n + d.quantity, 0);
}

/** A single line in a bundle bill of materials. */
export interface BomLine {
  kind: "device" | "cable" | "accessory";
  /** Model number for devices/cables, or the accessory name. */
  model: string;
  quantity: number;
}

/**
 * A flat bill of materials from {@link flattenBundle}: one line per leaf device,
 * cable, and accessory, with effective quantities.
 */
export function bundleBillOfMaterials(bundle: Bundle): BomLine[] {
  const flat = flattenBundle(bundle);
  const lines: BomLine[] = [];
  for (const d of flat.devices) {
    lines.push({
      kind: "device",
      model: d.device.device?.model ?? "(unknown device)",
      quantity: d.quantity
    });
  }
  for (const c of flat.cables) {
    lines.push({
      kind: "cable",
      model: c.cable?.model ?? "(unknown cable)",
      quantity: c.quantity
    });
  }
  for (const a of flat.accessories) {
    lines.push({
      kind: "accessory",
      model: a.accessory.model ?? a.accessory.name,
      quantity: a.quantity
    });
  }
  return lines;
}

/** A modular-chassis slot-assignment problem found by {@link validateChassis}. */
export interface ChassisIssue {
  /** Designator/model path to the components scope where the issue was found. */
  path: string[];
  message: string;
}

/**
 * Validate modular-chassis slot assignments in a bundle (semantics beyond JSON
 * Schema). Within each components scope (the frame and its cards are siblings),
 * checks that every card's `slot` names a real frame slot, that no slot is
 * double-occupied, that an inline card's `card.slotType` is in the slot's
 * `accepts`, and that a card's `powerDrawW` fits the slot's `powerBudgetW`.
 * Returns an empty array when there is nothing to flag (incl. non-chassis bundles).
 */
export function validateChassis(bundle: Bundle): ChassisIssue[] {
  const issues: ChassisIssue[] = [];

  function check(components: Component[], path: string[]): void {
    // Collect frame slots declared by device components in this scope.
    const slots = new Map<string, Slot>();
    for (const c of components) {
      if (c.type !== "device") continue;
      const dc = c as DeviceComponent;
      for (const s of dc.slots ?? []) {
        if (!s?.id) continue;
        if (slots.has(s.id)) {
          issues.push({ path, message: `Duplicate slot id '${s.id}' across frames in this scope.` });
        }
        slots.set(s.id, s);
      }
    }

    // Validate card components assigned to slots.
    const occupied = new Map<string, string>();
    for (const c of components) {
      if (c.type === "bundle") {
        const bc = c as BundleComponent;
        if (Array.isArray(bc.components)) {
          check(bc.components as Component[], [...path, bc.designator ?? bc.bundle?.model ?? "bundle"]);
        }
        continue;
      }
      if (c.type !== "device") continue;
      const dc = c as DeviceComponent;
      if (typeof dc.slot !== "string") continue;
      const label = dc.designator ?? dc.device?.model ?? dc.id ?? "card";
      const slot = slots.get(dc.slot);
      if (!slot) {
        issues.push({ path, message: `Card '${label}' is assigned to slot '${dc.slot}', which no frame in this bundle defines.` });
        continue;
      }
      const prior = occupied.get(dc.slot);
      if (prior) {
        issues.push({ path, message: `Slot '${dc.slot}' is assigned to more than one card ('${prior}' and '${label}').` });
      } else {
        occupied.set(dc.slot, label);
      }
      const cardType = dc.card?.slotType;
      const accepts = slot.accepts ?? [];
      if (cardType && accepts.length > 0 && !accepts.includes(cardType)) {
        issues.push({ path, message: `Card '${label}' (slotType '${cardType}') does not fit slot '${dc.slot}' (accepts: ${accepts.join(", ")}).` });
      }
      const draw = dc.card?.powerDrawW;
      if (typeof draw === "number" && typeof slot.powerBudgetW === "number" && draw > slot.powerBudgetW) {
        issues.push({ path, message: `Card '${label}' draws ${draw} W but slot '${dc.slot}' budgets ${slot.powerBudgetW} W.` });
      }
    }
  }

  check((bundle.components ?? []) as Component[], [bundle.bundle?.model ?? "bundle"]);
  return issues;
}
