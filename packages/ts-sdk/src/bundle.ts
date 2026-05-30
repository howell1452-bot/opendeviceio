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
  Cable
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
            ...(dc.parameters !== undefined ? { parameters: dc.parameters } : {})
          },
          quantity: effective,
          designators: nextDesignators,
          path: [...path, deviceLabel(dc)]
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
      out.devices.push({
        device: {
          device: r.device as Device,
          ports: (r.ports as Port[] | undefined) ?? [],
          ...(r.power !== undefined ? { power: r.power as Power } : {}),
          ...(r.physical !== undefined ? { physical: r.physical as Physical } : {}),
          ...(r.standards !== undefined ? { standards: r.standards as Standard[] } : {}),
          ...(r.parameters !== undefined ? { parameters: r.parameters as Parameters } : {})
        },
        quantity: factor,
        designators,
        path: [...path, designator ?? (r.device as Device)?.model ?? "device"]
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
