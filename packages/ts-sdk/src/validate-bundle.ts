import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import addFormatsImport from "ajv-formats";

import deviceSchema from "./schema.js";
import { bundleSchema, cableSchema } from "./bundle-schema.js";
import type { OpenDeviceIOBundle as Bundle } from "./bundle-types.js";
import type { OpenDeviceIOCable as Cable } from "./cable-types.js";
import type { OpenDeviceIODevice as Device } from "./types.js";
import {
  type ValidationError,
  type ValidationResult,
  validate as validateDevice,
  toValidationError,
  OdioValidationError
} from "./validate.js";

type AjvInstance = InstanceType<typeof Ajv2020>;

// ajv-formats ships as CJS with `module.exports = formatsPlugin` plus a
// `.default`. Under NodeNext the default import may resolve to a namespace
// object, so normalize to the callable plugin.
type AddFormatsFn = (ajv: AjvInstance) => AjvInstance;
const addFormatsCandidate = addFormatsImport as unknown as
  | AddFormatsFn
  | { default: AddFormatsFn };
const addFormats: AddFormatsFn =
  typeof addFormatsCandidate === "function"
    ? addFormatsCandidate
    : addFormatsCandidate.default;

// A single Ajv instance with all three schemas registered, so the cross-document
// `$ref`s (bundle -> device, bundle -> cable, cable -> device) resolve by their
// canonical $id URLs.
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  allowUnionTypes: true
});
addFormats(ajv);

ajv.addSchema(deviceSchema as unknown as object);
ajv.addSchema(cableSchema as unknown as object);
ajv.addSchema(bundleSchema as unknown as object);

const compiledBundle = ajv.getSchema(
  "https://opendeviceio.org/schema/v0.1/bundle.schema.json"
) as ValidateFunction<Bundle>;
const compiledCable = ajv.getSchema(
  "https://opendeviceio.org/schema/v0.1/cable.schema.json"
) as ValidateFunction<Cable>;

function runValidator(
  fn: ValidateFunction<unknown>,
  obj: unknown
): ValidationResult {
  const valid = fn(obj) as boolean;
  if (valid) return { valid: true, errors: [] };
  const errors = (fn.errors ?? []).map(toValidationError);
  return { valid: false, errors };
}

/**
 * Validate an arbitrary value against the bundled OpenDeviceIO v0.1 bundle
 * schema. Never throws; returns structured errors instead.
 */
export function validateBundle(obj: unknown): ValidationResult {
  return runValidator(compiledBundle, obj);
}

/**
 * Validate an arbitrary value against the bundled OpenDeviceIO v0.1 cable
 * schema. Never throws; returns structured errors instead.
 */
export function validateCable(obj: unknown): ValidationResult {
  return runValidator(compiledCable, obj);
}

/** The document kind a value was routed to. */
export type DocumentKind = "device" | "bundle" | "cable";

/** Result of {@link validateDocument}: a {@link ValidationResult} plus the routed kind. */
export interface DocumentValidationResult extends ValidationResult {
  kind: DocumentKind;
}

function kindOf(obj: unknown): DocumentKind {
  const k = (obj as { kind?: unknown } | null)?.kind;
  if (k === "bundle") return "bundle";
  if (k === "cable") return "cable";
  return "device";
}

/**
 * Validate any ODIO document, routing by its top-level `kind`:
 * "bundle" -> bundle schema, "cable" -> cable schema, otherwise the device
 * schema (device documents have no `kind`). Never throws.
 */
export function validateDocument(obj: unknown): DocumentValidationResult {
  const kind = kindOf(obj);
  const result =
    kind === "bundle"
      ? validateBundle(obj)
      : kind === "cable"
        ? validateCable(obj)
        : validateDevice(obj);
  return { ...result, kind };
}

/**
 * Parse a JSON string (or accept an already-parsed object) and validate it as a
 * bundle. Returns a typed {@link Bundle}; throws {@link OdioValidationError} on
 * schema failure or a SyntaxError on malformed JSON.
 */
export function parseBundle(json: string | unknown): Bundle {
  const obj: unknown = typeof json === "string" ? JSON.parse(json) : json;
  const result = validateBundle(obj);
  if (!result.valid) throw new OdioValidationError(result.errors);
  return obj as Bundle;
}

/**
 * Parse a JSON string (or accept an already-parsed object) and validate it as a
 * cable. Returns a typed {@link Cable}; throws {@link OdioValidationError} on
 * schema failure or a SyntaxError on malformed JSON.
 */
export function parseCable(json: string | unknown): Cable {
  const obj: unknown = typeof json === "string" ? JSON.parse(json) : json;
  const result = validateCable(obj);
  if (!result.valid) throw new OdioValidationError(result.errors);
  return obj as Cable;
}

/** A parsed ODIO document of any kind. */
export type OdioDocument = Device | Bundle | Cable;

/**
 * Parse a JSON string (or accept an already-parsed object), route by `kind`,
 * and validate against the matching schema. Returns the parsed document; throws
 * {@link OdioValidationError} on schema failure or a SyntaxError on malformed
 * JSON.
 */
export function parseDocument(json: string | unknown): OdioDocument {
  const obj: unknown = typeof json === "string" ? JSON.parse(json) : json;
  const result = validateDocument(obj);
  if (!result.valid) throw new OdioValidationError(result.errors);
  return obj as OdioDocument;
}

export type { ValidationError };
export { bundleSchema, cableSchema };
