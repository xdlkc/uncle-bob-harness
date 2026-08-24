/**
 * Shared predicates and closed-union exhaustiveness.
 * @module uncle-bob-harness/util
 */

/**
 * Throw when a closed union was not handled.
 * @param value - the unhandled discriminant value.
 * @param message - optional diagnostic.
 * @returns never
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `unexpected value: ${String(value)}`)
}

/**
 * Whether `value` is a non-null, non-array object.
 * @param value - candidate.
 * @returns true when `value` is a record.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether `value` is a non-empty trimmed string (already normalized).
 * @param value - candidate.
 * @returns true when the string is non-empty and equals its trim.
 */
export function normalizedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

/**
 * Whether `value` is an array of non-empty trimmed strings.
 * @param value - candidate.
 * @returns true when every element is a normalized string.
 */
export function normalizedList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(normalizedText)
}
