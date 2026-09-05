const FORBIDDEN_KEY =
  /^(?:holder(?:Id|Identity)?|user(?:Id|Identity)?|subject(?:Id|Identity)?|account(?:Id)?|email|credential(?:Id|Serial|WideId)?|serial(?:Number)?|raw(?:Credential|Proof|Nullifier)|(?:opaque)?Proof|nullifier(?:Key)?|hiddenSlot|group(?:ing|Label)|credentialLabels)$/iu;
const FORBIDDEN_TEXT =
  /(?:holder[_-]?id|user[_-]?id|credential[_-]?(?:id|serial|wide[_-]?id)|raw[_-]?(?:credential|proof|nullifier)|hidden[_-]?slot|credential[_-]?labels)/iu;

export interface ForbiddenDataScanOptions {
  readonly markers?: readonly string[];
  /** Disable free-text matching when scanning compiled assets whose protocol field names are intentional. */
  readonly scanText?: boolean;
}

/** Scans untrusted evidence, logs, exports, or bundles without returning their contents. */
export function scanForbiddenData(
  value: unknown,
  options: ForbiddenDataScanOptions = {}
): readonly string[] {
  const findings: string[] = [];
  const markers = (options.markers ?? []).filter((marker) => marker.length > 0);
  const scanText = options.scanText ?? true;
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown, path: string): void => {
    if (typeof candidate === "string") {
      if (scanText && FORBIDDEN_TEXT.test(candidate)) findings.push(`${path}:forbidden-text`);
      for (const marker of markers)
        if (candidate.includes(marker)) findings.push(`${path}:secret-marker`);
      return;
    }
    if (candidate === null || typeof candidate !== "object") return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, item] of Object.entries(candidate)) {
      const next = path === "$" ? `$.${key}` : `${path}.${key}`;
      if (FORBIDDEN_KEY.test(key)) findings.push(`${next}:forbidden-key`);
      visit(item, next);
    }
  };
  visit(value, "$");
  return [...new Set(findings)].sort();
}

export function assertNoForbiddenData(
  value: unknown,
  options: ForbiddenDataScanOptions = {}
): void {
  const findings = scanForbiddenData(value, options);
  if (findings.length > 0) throw new Error("FORBIDDEN_DATA:" + findings.join(","));
}
