import { DomainError } from "./errors.js";

/**
 * JSON keys use UTF-16 code-unit order, numbers use ECMAScript JSON encoding,
 * and Unicode is preserved without normalization. This is shared by both ends.
 * Reject values JSON.stringify would silently omit, coerce, or execute.
 */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(input: unknown, depth: number): string {
    if (depth > 64) throw new DomainError("INVALID_CANONICAL_VALUE");
    if (input === null) return "null";
    if (typeof input === "string") {
      if (!input.isWellFormed()) throw new DomainError("INVALID_CANONICAL_VALUE");
      return JSON.stringify(input);
    }
    if (typeof input === "boolean") return input ? "true" : "false";
    if (typeof input === "number" && Number.isFinite(input)) return JSON.stringify(input);
    if (typeof input !== "object" || ancestors.has(input))
      throw new DomainError("INVALID_CANONICAL_VALUE");
    const prototype: unknown = Object.getPrototypeOf(input);
    if (
      Array.isArray(input)
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    )
      throw new DomainError("INVALID_CANONICAL_VALUE");
    if (Object.getOwnPropertySymbols(input).length > 0)
      throw new DomainError("INVALID_CANONICAL_VALUE");
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Object.keys(descriptors);
    ancestors.add(input);
    let output: string;
    if (Array.isArray(input)) {
      if (keys.length !== input.length + 1) throw new DomainError("INVALID_CANONICAL_VALUE");
      const values: string[] = [];
      for (let index = 0; index < input.length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
          throw new DomainError("INVALID_CANONICAL_VALUE");
        values.push(encode(descriptor.value, depth + 1));
      }
      output = `[${values.join(",")}]`;
    } else {
      const entries: string[] = [];
      for (const key of keys.sort()) {
        const descriptor = descriptors[key];
        if (!key.isWellFormed() || !descriptor?.enumerable || !("value" in descriptor))
          throw new DomainError("INVALID_CANONICAL_VALUE");
        entries.push(`${JSON.stringify(key)}:${encode(descriptor.value, depth + 1)}`);
      }
      output = `{${entries.join(",")}}`;
    }
    ancestors.delete(input);
    return output;
  }
  try {
    return encode(value, 0);
  } catch {
    throw new DomainError("INVALID_CANONICAL_VALUE");
  }
}
