import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "..");
const appBuildScript = await readFile(join(repoRoot, "scripts/fork/app-build.sh"), "utf8");

async function createHarness(t, submitFailures) {
  const root = await mkdtemp(join(tmpdir(), "paseo-app-build-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const appDir = join(root, "packages", "app");
  const binDir = join(root, "bin");
  const submitCountFile = join(root, "submit-count");
  const sleepLogFile = join(root, "sleep-log");
  await mkdir(appDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(join(root, "scripts/fork"), { recursive: true });
  await mkdir(join(root, ".dev"), { recursive: true });
  await writeFile(
    join(root, ".dev/fork-build-state.json"),
    JSON.stringify({ sourceRoot: root, sourceHead: "app-v0.5.0-fork.2" }),
  );
  await writeFile(join(root, "scripts/fork/app-build.sh"), appBuildScript);
  await writeFile(join(appDir, "package.json"), JSON.stringify({ version: "0.5.0" }));
  await writeFile(join(binDir, "git"), '#!/usr/bin/env bash\nprintf "app-v0.5.0-fork.2\\n"\n');
  await writeFile(
    join(binDir, "sleep"),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$1" >> "$SLEEP_LOG_FILE"\n',
  );
  await writeFile(
    join(binDir, "npx"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "eas" && "$2" == "build" ]]; then
  while [[ "$#" -gt 0 ]]; do
    if [[ "$1" == "--output" ]]; then
      mkdir -p "$(dirname "$2")"
      : > "$2"
      exit 0
    fi
    shift
  done
  exit 2
fi
if [[ "$1" == "eas" && "$2" == "submit" ]]; then
  count=0
  if [[ -f "$SUBMIT_COUNT_FILE" ]]; then
    count="$(cat "$SUBMIT_COUNT_FILE")"
  fi
  count=$((count + 1))
  printf "%d" "$count" > "$SUBMIT_COUNT_FILE"
  if [[ "$count" -le "$SUBMIT_FAILURES" ]]; then
    exit 42
  fi
  exit 0
fi
exit 2
`,
  );
  await Promise.all(
    ["scripts/fork/app-build.sh", "bin/git", "bin/npx", "bin/sleep"].map((path) =>
      chmod(join(root, path), 0o755),
    ),
  );

  return {
    root,
    submitCountFile,
    sleepLogFile,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      SUBMIT_COUNT_FILE: submitCountFile,
      SUBMIT_FAILURES: String(submitFailures),
      SLEEP_LOG_FILE: sleepLogFile,
    },
  };
}

function runAppBuild(harness) {
  return spawnSync("bash", ["scripts/fork/app-build.sh"], {
    cwd: harness.root,
    env: harness.env,
    encoding: "utf8",
  });
}

test("retries a failed EAS submit with exponential backoff", async (t) => {
  const harness = await createHarness(t, 2);

  const result = runAppBuild(harness);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(harness.submitCountFile, "utf8"), "3");
  assert.equal(await readFile(harness.sleepLogFile, "utf8"), "15\n30\n");
  assert.match(result.stderr, /Submit attempt 1\/3 failed; retrying in 15 seconds/);
  assert.match(result.stderr, /Submit attempt 2\/3 failed; retrying in 30 seconds/);
  assert.match(result.stdout, /Submitted app-v0\.5\.0-fork\.2/);
});

test("fails after the final EAS submit attempt without another delay", async (t) => {
  const harness = await createHarness(t, 3);

  const result = runAppBuild(harness);

  assert.equal(result.status, 1);
  assert.equal(await readFile(harness.submitCountFile, "utf8"), "3");
  assert.equal(await readFile(harness.sleepLogFile, "utf8"), "15\n30\n");
  assert.match(result.stderr, /Failed to submit app-v0\.5\.0-fork\.2 after 3 attempts/);
});

test("wrapper builds in a materialized worktree while retaining the real source tag", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "paseo-app-wrapper-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "source");
  await mkdir(repo);
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  const put = async (name, content) => {
    const file = join(repo, name);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, content);
  };
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await put(".gitignore", ".dev/\nnode_modules/\n");
  await put("packages/app/package.json", '{"version":"0.5.0"}\n');
  await put("packages/app/config.txt", "official\n");
  await put("runtime.txt", "official\n");
  await put("tooling.txt", "official\n");
  await put("package.json", '{"name":"fixture","version":"1.0.0"}\n');
  await put(
    "package-lock.json",
    '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"fixture","version":"1.0.0"}}}\n',
  );
  git("add", ".");
  git("commit", "-qm", "base");
  git("tag", "upstream-base");
  const base = git("rev-parse", "HEAD");
  for (const file of ["packages/app/config.txt", "runtime.txt", "tooling.txt"])
    await put(file, "fork\n");
  const patches = ["packages/app/config.txt", "runtime.txt", "tooling.txt"].map(
    (file) => git("diff", "--binary", "--", file) + "\n",
  );
  git("restore", ".");
  for (const file of ["packages/app/config.txt", "runtime.txt", "tooling.txt"])
    await rm(join(repo, file));
  await put(
    "scripts/fork/upstream/series.json",
    JSON.stringify({ ref: "upstream-base", commit: base }),
  );
  for (const [index, name] of ["01-app.patch", "02-runtime.patch", "03-tooling.patch"].entries())
    await put(`scripts/fork/upstream/${name}`, patches[index]);
  for (const name of [
    "app-build.sh",
    "scripts/fork/app-build.sh",
    "scripts/fork/upstream.mjs",
    "scripts/fork/source.mjs",
  ]) {
    await mkdir(join(repo, name, ".."), { recursive: true });
    await copyFile(join(repoRoot, name), join(repo, name));
  }
  git("add", ".");
  git("commit", "-qm", "fork");
  git("tag", "app-v0.5.0-fork.2");
  const head = git("rev-parse", "HEAD");
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "npm"), "#!/bin/sh\nexit 0\n");
  await writeFile(
    join(bin, "npx"),
    '#!/bin/bash\nset -e\ntest "$(cat config.txt)" = fork\nif [[ "$2" == build ]]; then while [[ $# -gt 0 ]]; do if [[ "$1" == --output ]]; then touch "$2"; exit; fi; shift; done; fi\n',
  );
  await chmod(join(bin, "npm"), 0o755);
  await chmod(join(bin, "npx"), 0o755);
  const result = spawnSync("bash", [join(repo, "app-build.sh")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr);
  const workspace = join(repo, ".dev/fork-build");
  const state = JSON.parse(await readFile(join(workspace, ".dev/fork-build-state.json"), "utf8"));
  assert.equal(state.sourceRoot, repo);
  assert.equal(state.sourceHead, head);
  assert.equal(git("rev-parse", "HEAD"), head);
  await assert.rejects(readFile(join(repo, "packages/app/config.txt")), { code: "ENOENT" });
  assert.equal(await readFile(join(workspace, "packages/app/config.txt"), "utf8"), "fork\n");
  assert.ok((await stat(join(workspace, "packages/app/dist/app-v0.5.0-fork.2.ipa"))).isFile());
});
