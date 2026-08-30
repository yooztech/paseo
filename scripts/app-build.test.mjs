import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "..");
const appBuildScript = await readFile(join(repoRoot, "app-build.sh"), "utf8");

async function createHarness(t, submitFailures) {
  const root = await mkdtemp(join(tmpdir(), "paseo-app-build-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const appDir = join(root, "packages", "app");
  const binDir = join(root, "bin");
  const submitCountFile = join(root, "submit-count");
  const sleepLogFile = join(root, "sleep-log");
  await mkdir(appDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await writeFile(join(root, "app-build.sh"), appBuildScript);
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
    ["app-build.sh", "bin/git", "bin/npx", "bin/sleep"].map((path) =>
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
  return spawnSync("bash", ["app-build.sh"], {
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
