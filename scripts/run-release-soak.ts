import { spawn } from "node:child_process";

const requested = Number(process.env.GOLDEN_SOAK_RUNS ?? "100");
if (!Number.isSafeInteger(requested) || requested < 1 || requested > 100) {
  process.stderr.write("GOLDEN_SOAK_RUNS_INVALID\n");
  process.exitCode = 1;
} else {
  const args = [
    "exec",
    "vitest",
    "run",
    "--project",
    "integration",
    "tests/integration/phase6-golden-scenario.test.ts",
    "-t=Phase9GoldenVariant",
  ];
  const windows = process.platform === "win32";
  const command = windows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const child = spawn(command, windows ? ["/d", "/s", "/c", "pnpm", ...args] : args, {
    cwd: process.cwd(),
    env: { ...process.env, GOLDEN_SOAK_RUNS: String(requested) },
    stdio: "inherit",
  });
  child.on("error", () => {
    process.stderr.write("GOLDEN_SOAK_FAILED\n");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
