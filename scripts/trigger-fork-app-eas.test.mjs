import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { selectAppReleaseTag } from "./trigger-fork-app-eas.mjs";

test("requires exactly one app release tag for the version", () => {
  assert.equal(
    selectAppReleaseTag(["v0.5.0-fork.2", "app-v0.5.0-fork.2"], "0.5.0"),
    "app-v0.5.0-fork.2",
  );
  assert.throws(() => selectAppReleaseTag([], "0.5.0"), /found: none/);
  assert.throws(
    () => selectAppReleaseTag(["app-v0.5.0-fork.2", "app-v0.5.0-fork.3"], "0.5.0"),
    /Expected exactly one/,
  );
});

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-eas-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, "repo");
  const origin = path.join(dir, "origin.git");
  const put = (name, contents) => {
    const file = path.join(repo, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  };
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("branch", "-M", "downstream/patch-build");
  git("remote", "add", "origin", origin);
  return { dir, repo, origin, put, git };
}

function triggerFixture(t, annotated = false) {
  const f = fixture(t);
  f.put("package.json", JSON.stringify({ name: "upstream", version: "0.5.0" }));
  f.put(".gitignore", ".dev/\nnode_modules/\n");
  f.put(
    "packages/app/upstream-identity.js",
    'module.exports = { projectId: "fbf5a457-e6af-4dce-a36e-6b79b413f734", bundleIdentifier: "com.yooztech.paseo" };\n',
  );
  f.put(
    "packages/app/app.config.js",
    'const identity = require("./upstream-identity.js"); module.exports = { expo: { extra: { eas: { projectId: identity.projectId } }, ios: { bundleIdentifier: identity.bundleIdentifier } } };\n',
  );
  f.git("add", ".");
  f.git("commit", "-qm", "upstream base");
  const pin = f.git("rev-parse", "HEAD");
  f.put("package.json", JSON.stringify({ name: "thin-control", version: "9.9.9" }));
  f.git("rm", "-q", "packages/app/upstream-identity.js");
  f.put(
    "scripts/fork/upstream/series.json",
    JSON.stringify({ ref: "refs/tags/upstream-fixture", commit: pin }),
  );
  for (const name of ["01-app.patch", "02-runtime.patch", "03-tooling.patch"])
    f.put(`scripts/fork/upstream/${name}`, "");
  mkdirSync(path.join(f.repo, "scripts"), { recursive: true });
  copyFileSync(
    new URL("./trigger-fork-app-eas.mjs", import.meta.url),
    path.join(f.repo, "scripts/trigger-fork-app-eas.mjs"),
  );
  mkdirSync(path.join(f.repo, "scripts/fork"), { recursive: true });
  copyFileSync(
    new URL("./fork/source.mjs", import.meta.url),
    path.join(f.repo, "scripts/fork/source.mjs"),
  );
  copyFileSync(
    new URL("./fork/upstream.mjs", import.meta.url),
    path.join(f.repo, "scripts/fork/upstream.mjs"),
  );
  mkdirSync(path.join(f.repo, "scripts/fork/release"), { recursive: true });
  copyFileSync(
    new URL("./fork/release/launch.mjs", import.meta.url),
    path.join(f.repo, "scripts/fork/release/launch.mjs"),
  );
  f.git("add", ".");
  f.git("commit", "-qm", "release");
  f.git(
    "tag",
    ...(annotated ? ["-a", "app-v0.5.0-fork.2", "-m", "release"] : ["app-v0.5.0-fork.2"]),
  );
  f.git("push", "-qu", "origin", "downstream/patch-build", "--tags");
  const bin = path.join(f.dir, "bin");
  mkdirSync(bin);
  const output = path.join(f.dir, "dispatch.json");
  writeFileSync(path.join(bin, "npm"), `#!${process.execPath}\nprocess.exit(0);\n`);
  chmodSync(path.join(bin, "npm"), 0o755);
  writeFileSync(
    path.join(bin, "npx"),
    `#!${process.execPath}\nrequire('fs').writeFileSync(process.env.DISPATCH, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),noVcs:process.env.EAS_NO_VCS ?? null,projectRoot:process.env.EAS_PROJECT_ROOT ?? null}));\n`,
  );
  chmodSync(path.join(bin, "npx"), 0o755);
  const run = () =>
    spawnSync(process.execPath, ["scripts/trigger-fork-app-eas.mjs"], {
      cwd: f.repo,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        DISPATCH: output,
        EAS_NO_VCS: "",
        EAS_PROJECT_ROOT: "",
      },
    });
  return { ...f, run, output };
}

for (const annotated of [false, true]) {
  test(`dispatches remote workflow by exact SHA with ${annotated ? "annotated" : "lightweight"} tag`, (t) => {
    const f = triggerFixture(t, annotated);
    const head = f.git("rev-parse", "HEAD");
    assert.equal(existsSync(path.join(f.repo, "packages/app/upstream-identity.js")), false);
    assert.equal(
      JSON.parse(readFileSync(path.join(f.repo, "package.json"), "utf8")).version,
      "9.9.9",
    );
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      existsSync(path.join(f.repo, ".dev/fork-build/packages/app/upstream-identity.js")),
      true,
    );
    const dispatch = JSON.parse(readFileSync(f.output, "utf8"));
    assert.deepEqual(dispatch.args, [
      "--yes",
      "eas-cli@27.4.1",
      "workflow:run",
      ".eas/workflows/release-mobile.yml",
      "--ref",
      head,
      "-F",
      "release_tag=app-v0.5.0-fork.2",
      "-F",
      `source_commit=${head}`,
      "--non-interactive",
    ]);
    assert.equal(dispatch.cwd, path.join(f.repo, ".dev/fork-build/packages/app"));
    assert.notEqual(dispatch.noVcs, "1");
    assert.equal(dispatch.projectRoot, "");
  });
}
test("exported trigger refuses an unmanaged source checkout", (t) => {
  const f = triggerFixture(t);
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { triggerForkAppEas } from "./scripts/trigger-fork-app-eas.mjs"; triggerForkAppEas();',
    ],
    {
      cwd: f.repo,
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /require a managed fork runtime/);
});

test("release helper dispatches from the effective managed runtime on the patch branch", (t) => {
  const f = triggerFixture(t);
  const head = f.git("rev-parse", "HEAD");
  const runtime = path.join(f.dir, "runtime");
  f.git("worktree", "add", "--detach", runtime, head);
  writeFileSync(
    path.join(runtime, "packages/app/upstream-identity.js"),
    f.git("show", `${head}^:packages/app/upstream-identity.js`),
  );
  mkdirSync(path.join(runtime, "scripts/fork/release"), { recursive: true });
  mkdirSync(path.join(runtime, ".dev"), { recursive: true });
  for (const name of [
    "release-fork-app.mjs",
    "fork/release/launch.mjs",
    "fork/release/release.mjs",
  ]) {
    copyFileSync(new URL(`./${name}`, import.meta.url), path.join(runtime, "scripts", name));
  }
  const marker = path.join(runtime, ".dev/fork-build-state.json");
  const env = {
    ...process.env,
    PATH: `${path.join(f.dir, "bin")}${path.delimiter}${process.env.PATH}`,
    DISPATCH: f.output,
    EAS_NO_VCS: "",
    EAS_PROJECT_ROOT: "",
  };
  writeFileSync(marker, JSON.stringify({ sourceRoot: f.repo, sourceHead: "0".repeat(40) }));
  const stale = spawnSync(
    process.execPath,
    ["scripts/trigger-fork-app-eas.mjs", "--fork-runtime"],
    {
      cwd: runtime,
      encoding: "utf8",
      env,
    },
  );
  assert.match(stale.stderr, /HEAD changed since the fork build was materialized/);
  writeFileSync(marker, JSON.stringify({ sourceRoot: f.repo, sourceHead: head }));
  const runtimeConfig = path.join(runtime, "packages/app/app.config.js");
  writeFileSync(
    runtimeConfig,
    'module.exports = { expo: { extra: { eas: { projectId: "wrong" } }, ios: { bundleIdentifier: "com.yooztech.paseo" } } };\n',
  );
  const wrongConfig = spawnSync(
    process.execPath,
    ["scripts/trigger-fork-app-eas.mjs", "--fork-runtime"],
    {
      cwd: runtime,
      encoding: "utf8",
      env,
    },
  );
  assert.notEqual(wrongConfig.status, 0);
  assert.match(wrongConfig.stderr, /Effective app configuration/);
  copyFileSync(path.join(f.repo, "packages/app/app.config.js"), runtimeConfig);
  const result = spawnSync(process.execPath, ["scripts/release-fork-app.mjs", "--fork-runtime"], {
    cwd: runtime,
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const dispatch = JSON.parse(readFileSync(f.output, "utf8"));
  assert.equal(dispatch.cwd, path.join(runtime, "packages/app"));
  assert.deepEqual(dispatch.args, [
    "--yes",
    "eas-cli@27.4.1",
    "workflow:run",
    ".eas/workflows/release-mobile.yml",
    "--ref",
    head,
    "-F",
    "release_tag=app-v0.5.0-fork.2",
    "-F",
    `source_commit=${head}`,
    "--non-interactive",
  ]);
});

test("refuses a non-patch branch and dirty worktree", (t) => {
  const f = triggerFixture(t);
  f.git("checkout", "-qb", "other");
  assert.match(f.run().stderr, /must run from downstream\/patch-build/);
  f.git("checkout", "-q", "downstream/patch-build");
  f.put("dirty", "not committed");
  assert.match(f.run().stderr, /clean worktree/);
});

test("refuses a stale patch branch and moved remote tag", (t) => {
  const f = triggerFixture(t);
  const head = f.git("rev-parse", "HEAD");
  f.git("commit", "--allow-empty", "-qm", "ahead");
  assert.match(f.run().stderr, /HEAD must match origin\/downstream\/patch-build/);
  const moved = f.git("rev-parse", "HEAD");
  f.git("push", "-q", "--force", "origin", `${moved}:refs/tags/app-v0.5.0-fork.2`);
  f.git("reset", "--hard", head);
  assert.notEqual(f.run().status, 0);
});

test("cloud bootstrap validates identity and applies real patches in a shallow no-tags checkout", (t) => {
  const f = fixture(t);
  const version = "0.5.0";
  const tag = `app-v${version}-fork.2`;
  f.put(".gitignore", ".dev/\nnode_modules/\n");
  f.put("package.json", JSON.stringify({ name: "upstream", version }));
  f.put("packages/app/package.json", JSON.stringify({ name: "fixture", version }));
  for (const name of ["app.config.js", "eas.json", "native-release-version.js"]) {
    mkdirSync(path.join(f.repo, "packages/app"), { recursive: true });
    copyFileSync(
      new URL(`../packages/app/${name}`, import.meta.url),
      path.join(f.repo, "packages/app", name),
    );
  }
  f.put("packages/app/view.txt", "upstream\n");
  f.git("add", ".");
  f.git("commit", "-qm", "upstream base");
  const base = f.git("rev-parse", "HEAD");
  f.put("package.json", JSON.stringify({ name: "thin-control", version: "9.9.9" }));
  f.put("packages/app/view.txt", "fork patched\n");
  const patch = execFileSync("git", ["diff", "--binary", "--", "packages/app/view.txt"], {
    cwd: f.repo,
  });
  f.git("rm", "-qf", "packages/app/view.txt");
  f.put(
    "scripts/fork/upstream/series.json",
    JSON.stringify({ ref: "upstream-base", commit: base }),
  );
  f.put("scripts/fork/upstream/01-app.patch", patch);
  f.put("scripts/fork/upstream/02-runtime.patch", "");
  f.put("scripts/fork/upstream/03-tooling.patch", "");
  for (const name of ["upstream.mjs", "eas-build.mjs", "source.mjs"]) {
    copyFileSync(
      new URL(`./fork/${name}`, import.meta.url),
      path.join(f.repo, "scripts/fork", name),
    );
  }
  f.git("add", ".");
  f.git("commit", "-qm", "fork release");
  f.git("tag", "-a", tag, "-m", "release");
  f.git("tag", `app-v${version}-fork.1000`);
  f.git("tag", "app-v0.5.1-fork.2");
  f.git("push", "-qu", "origin", "downstream/patch-build", "--tags");
  execFileSync("git", [
    "--git-dir",
    f.origin,
    "symbolic-ref",
    "HEAD",
    "refs/heads/downstream/patch-build",
  ]);
  const checkout = path.join(f.dir, "checkout");
  execFileSync("git", ["clone", "-q", "--depth=1", "--no-tags", `file://${f.origin}`, checkout]);
  const git = (...args) => execFileSync("git", args, { cwd: checkout, encoding: "utf8" }).trim();
  git("config", `url.file://${f.origin}.insteadOf`, "https://github.com/getpaseo/paseo.git");
  git("config", "protocol.file.allow", "always");
  const head = git("rev-parse", "HEAD");
  assert.notEqual(
    spawnSync("git", ["cat-file", "-e", `${base}^{commit}`], { cwd: checkout }).status,
    0,
  );
  assert.equal(git("tag", "-l"), "");
  const env = {
    ...process.env,
    CI: "1",
    EAS_BUILD_PROJECT_ID: "fbf5a457-e6af-4dce-a36e-6b79b413f734",
    APP_VARIANT: "production",
    PASEO_RELEASE_TAG: tag,
    PASEO_SOURCE_COMMIT: head,
  };
  const run = (extra = {}) => {
    git("reset", "--hard", head);
    git("clean", "-fdx");
    return spawnSync(process.execPath, ["scripts/fork/eas-build.mjs"], {
      cwd: checkout,
      encoding: "utf8",
      env: { ...env, ...extra },
    });
  };
  assert.match(run({ PASEO_SOURCE_COMMIT: "0".repeat(40) }).stderr, /HEAD does not match/);
  assert.match(run({ PASEO_RELEASE_TAG: `app-v${version}-fork.1000` }).stderr, /PASEO_RELEASE_TAG/);
  assert.match(run({ PASEO_RELEASE_TAG: "app-v0.5.1-fork.2" }).stderr, /PASEO_RELEASE_TAG/);
  assert.match(run({ EAS_BUILD_PROJECT_ID: "wrong" }).stderr, /CI environment/);
  const result = run();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(
    readFileSync(path.join(checkout, "packages/app/view.txt"), "utf8"),
    "fork patched\n",
  );
});
