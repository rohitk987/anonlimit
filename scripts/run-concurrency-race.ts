import { spawn } from "node:child_process";

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
  stdio: "inherit",
});

child.on("error", () => {
  process.stderr.write("CONCURRENCY_RACE_FAILED\n");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
