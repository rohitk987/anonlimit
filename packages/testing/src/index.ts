// Test-only support package. Production imports are prohibited by the boundary gate.
export function createFixedClock(iso: string): () => Date {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid fixed clock.");
  return () => new Date(timestamp);
}

export * from "./scenarios/golden-scenario.js";
