// Friendly registry status filter values (URL `?status=`) and the validation
// statuses each maps to. Shared by the server page and the client filter UI.
export const STATUS_FILTERS = [
  { value: "verified", label: "Manufacturer-verified", statuses: ["manufacturer-verified"] },
  { value: "reviewed", label: "Reviewed", statuses: ["reviewed"] },
  { value: "unverified", label: "Unverified draft", statuses: ["draft"] }
] as const;
