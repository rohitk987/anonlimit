import { spawn } from "node:child_process";

interface TaskCommand {
  readonly program: string;
  readonly args: readonly string[];
}

const windows = process.platform === "win32";

function spawnTask(command: TaskCommand): Promise<void> {
  const executable =
    windows && command.program === "pnpm" ? (process.env.ComSpec ?? "cmd.exe") : command.program;
  const args =
    windows && command.program === "pnpm"
      ? ["/d", "/s", "/c", "pnpm", ...command.args]
      : [...command.args];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: process.cwd(), stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command.program.toUpperCase()}_FAILED`));
    });
  });
}

async function main(): Promise<void> {
  const compose: TaskCommand = { program: "docker", args: ["compose"] };
  try {
    await spawnTask({ ...compose, args: [...compose.args, "config", "--quiet"] });
    await spawnTask({ ...compose, args: [...compose.args, "down", "--remove-orphans"] });
    await spawnTask({
      ...compose,
      args: [...compose.args, "up", "-d", "--build", "--wait", "--wait-timeout", "120"],
    });
    await spawnTask({ program: "pnpm", args: ["wait:services"] });
    await spawnTask({ program: "pnpm", args: ["check:release"] });
    await spawnTask({ program: "pnpm", args: ["demo:golden:soak"] });
    process.stdout.write("RELEASE_REHEARSAL_PASSED\n");
  } catch {
    process.stderr.write("RELEASE_REHEARSAL_FAILED\n");
    process.exitCode = 1;
  } finally {
    try {
      await spawnTask({ ...compose, args: [...compose.args, "down", "--remove-orphans"] });
    } catch {
      process.stderr.write("RELEASE_CLEANUP_FAILED\n");
      process.exitCode = 1;
    }
  }
}

void main();
