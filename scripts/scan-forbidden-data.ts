import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { scanForbiddenData } from "@anonlimit/testing";

async function assetFiles(directory: string): Promise<readonly string[]> {
  try {
    return (await readdir(directory))
      .filter((name) => name.endsWith(".js"))
      .map((name) => join(directory, name));
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const files = await assetFiles("apps/web/dist/assets");
  const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));
  const markers: string[] = [];
  try {
    const env = parseEnv(await readFile(".env", "utf8"));
    for (const [key, value] of Object.entries(env))
      if (/_PASSWORD$|_TOKEN$|_HMAC_KEY$/u.test(key) && value) markers.push(value);
  } catch {
    // A clean checkout may not have a local environment file.
  }
  // Compiled browser code contains protocol field names such as hiddenSlot because the holder
  // must construct presentations locally. Scan the asset for actual secret markers while the
  // structured evidence/log scanners continue to reject forbidden field names and free text.
  const findings = scanForbiddenData(contents.join("\n"), { markers, scanText: false });
  process.stdout.write(JSON.stringify({ files: files.length, findings }) + "\n");
  if (findings.length > 0) process.exitCode = 1;
}

await main();
