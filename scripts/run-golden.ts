import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(command, ["test:integration:phase6"], {
  cwd: process.cwd(),
  stdio: "inherit",
});

child.on("error", () => {
  process.stderr.write("GOLDEN_RUN_FAILED\n");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
