import { demoResetResponseSchema } from "@anonlimit/contracts";

const baseUrl = (process.argv[2] ?? "http://localhost:4000").replace(/\/$/u, "");

async function main(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/demo/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch {
    throw new Error("DEMO_RESET_UNAVAILABLE");
  }
  const body = (await response.json()) as unknown;
  if (!response.ok) throw new Error("DEMO_RESET_REJECTED");
  process.stdout.write(`${JSON.stringify(demoResetResponseSchema.parse(body))}\n`);
}

void main().catch(() => {
  process.stderr.write("DEMO_RESET_FAILED\n");
  process.exitCode = 1;
});
