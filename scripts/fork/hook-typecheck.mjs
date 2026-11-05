#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// Git exports repository-specific variables to hooks; they must not leak into
// the separate worktree used by the fork runner.
const env = { ...process.env };
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"]) {
  delete env[name];
}

const managed = existsSync(path.join(process.cwd(), ".dev", "fork-build-state.json"));
const command = managed ? "npm" : process.execPath;
const args = managed
  ? ["run", "typecheck"]
  : ["scripts/fork/upstream.mjs", "run", "--", "npm", "run", "typecheck"];
const result = spawnSync(command, args, {
  env,
  stdio: "inherit",
  shell: process.platform === "win32" && managed,
});
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
else process.exitCode = result.status ?? 1;
