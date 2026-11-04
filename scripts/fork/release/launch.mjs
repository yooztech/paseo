import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export async function launchInForkRuntime(script) {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const child = spawn(
    process.execPath,
    ["scripts/fork/upstream.mjs", "run", "--", process.execPath, script, "--fork-runtime"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = new Map(signals.map((signal) => [signal, () => child.kill(signal)]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    const { code, signal } = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
    });
    for (const [name, handler] of handlers) process.off(name, handler);
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code ?? 1;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}
