interface ServiceProbe {
  readonly name: string;
  readonly url: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_INTERVAL_MS = 500;

function boundedInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 300_000) {
    throw new Error(`${name.toUpperCase()}_INVALID`);
  }
  return parsed;
}

async function probe(service: ServiceProbe): Promise<boolean> {
  try {
    const response = await fetch(service.url, { signal: AbortSignal.timeout(4_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const apiBaseUrl = process.env.RELEASE_API_BASE_URL ?? "http://localhost:4000";
  const webBaseUrl = process.env.RELEASE_WEB_BASE_URL ?? "http://localhost:5173";
  const timeoutMs = boundedInteger(
    "release_timeout_ms",
    process.env.RELEASE_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );
  const intervalMs = boundedInteger(
    "release_interval_ms",
    process.env.RELEASE_INTERVAL_MS,
    DEFAULT_INTERVAL_MS
  );
  const services: readonly ServiceProbe[] = [
    { name: "api", url: `${apiBaseUrl.replace(/\/$/u, "")}/health/ready` },
    { name: "web", url: webBaseUrl },
  ];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const results = await Promise.all(
      services.map(async (service) => [service.name, await probe(service)] as const)
    );
    if (results.every(([, ready]) => ready)) {
      process.stdout.write(
        `Services ready: ${services.map((service) => service.name).join(", ")}\n`
      );
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  process.stderr.write("SERVICES_NOT_READY\n");
  process.exitCode = 1;
}

void main().catch(() => {
  process.stderr.write("SERVICE_WAIT_FAILED\n");
  process.exitCode = 1;
});
