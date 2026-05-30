import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import addFormatsImport from "ajv-formats";

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
import deviceSchema from "./schema.js";
import type { OpenDeviceIODevice as Device } from "./types.js";

/** A single schema validation failure, derived from an Ajv error. */
export interface ValidationError {
  /** JSON Pointer / dotted path to the offending location, e.g. "ports/0/connector". */
  path: string;
  /** Ajv keyword that failed, e.g. "required", "enum", "type". */
  keyword: string;
  /** Human-readable message. */
  message: string;
  /** Additional Ajv params for the failure (allowed enum values, missing prop, etc.). */
  params: Record<string, unknown>;
}

/** Result of validating an arbitrary value against the ODIO device schema. */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  allowUnionTypes: true
});
addFormats(ajv);

const compiled: ValidateFunction<Device> = ajv.compile<Device>(
  deviceSchema as unknown as object
);

/**
 * Map a raw Ajv {@link ErrorObject} to the package's {@link ValidationError}
 * shape. Exported so other validators (bundle/cable) share identical formatting.
 */
export function toValidationError(err: ErrorObject): ValidationError {
  const instancePath = err.instancePath || "";
  // For "required"/additionalProperties, surface the property in the path.
  let path = instancePath;
  if (err.keyword === "required" && typeof err.params?.missingProperty === "string") {
    path = `${instancePath}/${err.params.missingProperty}`;
  } else if (
    err.keyword === "additionalProperties" &&
    typeof err.params?.additionalProperty === "string"
  ) {
    path = `${instancePath}/${err.params.additionalProperty}`;
  }
  return {
    path: path === "" ? "(root)" : path,
    keyword: err.keyword,
    message: err.message ?? "validation failed",
    params: (err.params ?? {}) as Record<string, unknown>
  };
}

/**
 * Validate an arbitrary value against the bundled OpenDeviceIO v0.1 device
 * schema. Never throws; returns structured errors instead.
 */
export function validate(obj: unknown): ValidationResult {
  const valid = compiled(obj) as boolean;
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (compiled.errors ?? []).map(toValidationError);
  return { valid: false, errors };
}

/** Format validation errors into a single readable, multi-line string. */
export function formatErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return "no errors";
  return errors
    .map((e) => {
      const detail =
        e.keyword === "enum" && Array.isArray((e.params as { allowedValues?: unknown[] }).allowedValues)
          ? ` (allowed: ${((e.params as { allowedValues: unknown[] }).allowedValues).join(", ")})`
          : "";
      return `  - ${e.path}: ${e.message}${detail}`;
    })
    .join("\n");
}

/** Error thrown by {@link parse} when input is not a valid ODIO device. */
export class OdioValidationError extends Error {
  readonly errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super(`Invalid OpenDeviceIO document:\n${formatErrors(errors)}`);
    this.name = "OdioValidationError";
    this.errors = errors;
  }
}

/**
 * Parse a JSON string (or accept an already-parsed object) and validate it
 * against the schema. Returns a typed {@link Device} on success; throws
 * {@link OdioValidationError} with readable messages on failure, or a
 * SyntaxError if the input string is not valid JSON.
 */
export function parse(json: string | unknown): Device {
  const obj: unknown = typeof json === "string" ? JSON.parse(json) : json;
  const result = validate(obj);
  if (!result.valid) {
    throw new OdioValidationError(result.errors);
  }
  return obj as Device;
}

/** The bundled canonical schema object (frozen copy of the v0.1 source). */
export { deviceSchema };
