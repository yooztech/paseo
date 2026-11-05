#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { isControlFile } from "./source.mjs";

// Git exports repository-specific variables to hooks; they must not leak into
// the separate worktree used by the fork runner.
const env = { ...process.env };
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"]) {
  delete env[name];
}

const [job, ...files] = process.argv.slice(2);
const scripts = { format: "format:check:files", lint: "lint", typecheck: "typecheck" };
if (!Object.hasOwn(scripts, job) || (job === "typecheck" && files.length)) {
  throw new Error("Usage: hook-check.mjs <format|lint|typecheck> [staged files...]");
}

const managed = existsSync(path.join(process.cwd(), ".dev", "fork-build-state.json"));
let command = process.execPath;
let args;
if (managed) {
  args = ["run", scripts[job], ...(files.length ? ["--", ...files] : [])];
  if (process.platform === "win32") {
    // Invoke npm's JavaScript entry point directly so filenames never pass through cmd.exe.
    const npm =
      process.env.npm_execpath ||
      process.env.PATH.split(path.delimiter)
        .map((dir) => path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"))
        .find(existsSync);
    if (!npm) throw new Error("Cannot locate npm-cli.js on PATH");
    args.unshift(npm);
  } else command = "npm";
} else {
  // The runner uses a shell on Windows. Carry filenames in the environment, not its command line.
  // Bootstrap controls are not runtime overlays; validate their canonical contents.
  env.PASEO_HOOK_FILES = JSON.stringify(
    files.map((file) =>
      isControlFile(path.normalize(file).split(path.sep).join("/")) ? path.resolve(file) : file,
    ),
  );
  args = ["scripts/fork/upstream.mjs", "run", "--", "node", "scripts/fork/hook-check.mjs", job];
}
if (managed && env.PASEO_HOOK_FILES !== undefined) {
  const forwarded = JSON.parse(env.PASEO_HOOK_FILES);
  delete env.PASEO_HOOK_FILES;
  if (forwarded.length) args.push("--", ...forwarded);
}
const result = spawnSync(command, args, { env, stdio: "inherit" });
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
else process.exitCode = result.status ?? 1;
