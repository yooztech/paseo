#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { CONTROL_FILES, fetchLatestReleaseTag } from "./source.mjs";

const STORE = "scripts/fork/upstream";
const PATCHES = ["01-app.patch", "02-runtime.patch", "03-tooling.patch"];
const HELP = `Usage:
  node scripts/fork/upstream.mjs check [--upstream <ref>]
  node scripts/fork/upstream.mjs tree
  node scripts/fork/upstream.mjs materialize [--directory <path>]
  node scripts/fork/upstream.mjs run [--directory <path>] [--cwd <relative path>] [--no-install] -- <command...>
  node scripts/fork/upstream.mjs refresh --directory <patched worktree>
  node scripts/fork/upstream.mjs ci-apply
  node scripts/fork/upstream.mjs update [--upstream <tag>]

The patch branch contains only fork assets, direct overrides, bootstrap controls,
and exact official documentation snapshots. Runtime source is generated from the
pinned upstream tree and patches. npm commands route through the generated tree.
The default worktree and build outputs are in .dev/fork-build. The run command installs
dependencies with npm ci automatically when needed; --no-install skips installation.
The versioned Lefthook override checks staged control files in the canonical checkout;
other staged files are checked in the effective worktree.

Edit upstream files in the generated worktree, then run refresh --directory on that
worktree to update patches. Edit fork-only files in the canonical checkout instead.
Edit CI definitions and these three bootstrap files in the canonical checkout directly.
CI bootstrap alone may patch its disposable checkout. The pinned commit is
authoritative if its label is absent; moved labels are rejected.
Daily development and releases use downstream/patch-build. Update selects the latest
official release tag and commit, replays patches, and leaves changes for review and commit.

App releases use EAS Workflow remote checkout, not local source uploads:
  node scripts/fork/upstream.mjs run -- npm run release:fork:app
The fork Expo project must be linked to this GitHub repository. The release command
publishes the app tag and dispatches release-mobile.yml at its exact commit SHA;
each cloud checkout applies patches before building or submitting the same iOS build.
`;

function fail(message) {
  throw new Error(message);
}
function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
    ...options,
    env: { ...process.env, ...options.env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    fail(`git ${args.join(" ")} failed:\n${result.stderr.toString().trim()}`);
  }
  return result;
}
function git(...args) {
  return runGit(args).stdout.toString().trim();
}
function resolve(ref) {
  if (!ref || ref.startsWith("-")) fail("A valid Git ref is required");
  return git("rev-parse", "--verify", `${ref}^{commit}`);
}
function indexEnv(index) {
  return { GIT_INDEX_FILE: index };
}
function indexed(index, args, options = {}) {
  return runGit(args, { ...options, env: { ...options.env, ...indexEnv(index) } });
}
function initIndex(index, treeish) {
  indexed(index, ["read-tree", "--reset", treeish]);
}
function tree(index) {
  return indexed(index, ["write-tree"]).stdout.toString().trim();
}
function entries(treeish) {
  const out = runGit(["ls-tree", "-rz", "--full-tree", treeish]).stdout.toString();
  const result = new Map();
  for (const line of out.split("\0")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    const [mode, , oid] = line.slice(0, tab).split(" ");
    result.set(line.slice(tab + 1), { mode, oid });
  }
  return result;
}
function setEntries(index, changes) {
  if (!changes.length) return;
  const input = changes
    .map(([name, entry]) =>
      entry ? `${entry.mode} ${entry.oid}\t${name}\0` : `0 ${"0".repeat(40)}\t${name}\0`,
    )
    .join("");
  indexed(index, ["update-index", "-z", "--index-info"], { input });
}
function isStore(name) {
  return name === STORE || name.startsWith(`${STORE}/`);
}
function isCI(name) {
  return (
    !/\.md$/i.test(name) &&
    (name === ".github/ci-paths.yml" ||
      name.startsWith(".github/workflows/") ||
      name.startsWith(".github/actions/") ||
      name.startsWith("packages/app/.eas/workflows/"))
  );
}
function isOverride(name) {
  return (
    isCI(name) ||
    [
      "paseo.json",
      "packages/app/app.config.js",
      "packages/app/eas.json",
      "packages/app/native-release-version.js",
    ].includes(name)
  );
}
function isDirect(name) {
  return name === "AGENTS.md" || isOverride(name);
}
function group(name) {
  if (name.startsWith("packages/app/")) return 0;
  if (/^packages\/(server|client|protocol|cli|plugin)\//.test(name)) return 1;
  return 2;
}
function same(a, b) {
  return a?.mode === b?.mode && a?.oid === b?.oid;
}
function sourceTree(index) {
  initIndex(index, "HEAD");
  indexed(index, ["add", "-A", "--", "."]);
  return tree(index);
}
function patchesFor(base, snapshot, index) {
  const upstream = entries(base);
  const source = entries(snapshot);
  const changes = [[], [], []];
  for (const name of source.keys()) {
    if (!upstream.has(name) && !isStore(name) && /\.md$/i.test(name) && name !== "AGENTS.md")
      fail(`Fork Markdown difference is not allowed: ${name}`);
  }
  for (const [name, entry] of upstream) {
    if (isStore(name) || isDirect(name)) continue;
    const current = source.get(name);
    if (same(entry, current)) continue;
    if (/\.md$/i.test(name) && name !== "AGENTS.md")
      fail(`Fork Markdown difference is not allowed: ${name}`);
    changes[group(name)].push([name, current]);
  }
  return changes.map((items) => {
    initIndex(index, base);
    setEntries(index, items);
    const modified = tree(index);
    return runGit([
      "diff",
      "--binary",
      "--full-index",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--diff-algorithm=myers",
      "--unified=3",
      "--inter-hunk-context=0",
      "--no-indent-heuristic",
      base,
      modified,
      "--",
    ]).stdout;
  });
}
function parseManifest(content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch (error) {
    fail(`Cannot parse ${STORE}/series.json: ${error.message}`);
  }
  if (
    typeof data.ref !== "string" ||
    typeof data.commit !== "string" ||
    !/^[0-9a-f]{40,64}$/.test(data.commit)
  )
    fail("Invalid upstream manifest: expected ref and commit");
  resolve(data.commit);
  const ref = runGit(["rev-parse", "--verify", `${data.ref}^{commit}`], { allowFailure: true });
  if (ref.status === 0 && ref.stdout.toString().trim() !== data.commit)
    fail(
      `Pinned upstream ref ${data.ref} moved: expected ${data.commit}, got ${ref.stdout.toString().trim()}`,
    );
  return data;
}
function manifest() {
  let content;
  try {
    content = readFileSync(path.join(root, STORE, "series.json"), "utf8");
  } catch (error) {
    fail(`Cannot read ${STORE}/series.json: ${error.message}`);
  }
  return parseManifest(content);
}
function committedStore() {
  const read = (name) => runGit(["show", `HEAD:${STORE}/${name}`]).stdout;
  return { base: parseManifest(read("series.json").toString()), patches: PATCHES.map(read) };
}
function readPatches() {
  return PATCHES.map((name) => {
    try {
      const file = `${STORE}/${name}`;
      const content = readFileSync(path.join(root, file));
      // Undo checkout conversion using the same attributes and filters Git uses when staging.
      const oid = runGit(["hash-object", "-w", `--path=${file}`, "--stdin"], { input: content })
        .stdout.toString()
        .trim();
      return runGit(["cat-file", "blob", oid]).stdout;
    } catch (error) {
      fail(`Cannot read ${name}: ${error.message}`);
    }
  });
}
function replay(base, patches, index) {
  initIndex(index, base);
  const failures = [];
  for (let i = 0; i < patches.length; i++) {
    if (!patches[i].length) continue;
    const before = tree(index);
    const result = indexed(index, ["apply", "--cached", "--3way", "--whitespace=nowarn", "-"], {
      input: patches[i],
      allowFailure: true,
    });
    if (result.status !== 0) {
      const unmerged = indexed(index, ["diff", "--name-only", "--diff-filter=U", "-z"])
        .stdout.toString()
        .split("\0")
        .filter(Boolean);
      const detail = result.stderr.toString().trim();
      failures.push(`${PATCHES[i]}: ${unmerged.length ? `${unmerged.join(", ")}\n` : ""}${detail}`);
      initIndex(index, before);
    } else {
      const invalid = namesBetween(before, tree(index)).filter(isDirect);
      if (invalid.length) fail(`Patches modify disallowed paths:\n${invalid.join("\n")}`);
    }
  }
  if (failures.length) fail(`Patch replay failed:\n${failures.join("\n")}`);
  return tree(index);
}
function replayCI(base, snapshot, target, index) {
  const original = entries(base),
    source = entries(snapshot),
    destination = entries(target);
  const changes = [...new Set([...original.keys(), ...source.keys()])]
    .filter(
      (name) =>
        isOverride(name) &&
        !same(original.get(name), source.get(name)) &&
        !same(destination.get(name), source.get(name)),
    )
    .map((name) => [name, source.get(name)]);
  if (!changes.length) return target;
  initIndex(index, base);
  setEntries(index, changes);
  const modified = tree(index);
  const patch = runGit([
    "diff",
    "--binary",
    "--full-index",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    base,
    modified,
    "--",
  ]).stdout;
  initIndex(index, target);
  const result = indexed(index, ["apply", "--cached", "--3way", "--whitespace=nowarn", "-"], {
    input: patch,
    allowFailure: true,
  });
  if (result.status !== 0) {
    const conflicts = indexed(index, ["diff", "--name-only", "--diff-filter=U", "-z"])
      .stdout.toString()
      .split("\0")
      .filter(Boolean);
    fail(
      `CI/bootstrap override replay failed:\n${(conflicts.length ? conflicts : changes.map(([name]) => name)).join("\n")}\n${result.stderr.toString().trim()}`,
    );
  }
  return tree(index);
}
function writeStore(ref, commit, patches) {
  mkdirSync(path.join(root, STORE), { recursive: true });
  writeFileSync(
    path.join(root, STORE, "series.json"),
    `${JSON.stringify({ ref, commit }, null, 2)}\n`,
  );
  PATCHES.forEach((name, i) => writeFileSync(path.join(root, STORE, name), patches[i]));
}
function namesBetween(a, b) {
  return runGit(["diff", "--name-only", "-z", "--no-renames", a, b, "--"])
    .stdout.toString()
    .split("\0")
    .filter(Boolean);
}
function cleanForUpdate(snapshot) {
  const staged = runGit(["diff", "--cached", "--name-only", "-z", "--no-renames", "HEAD", "--"])
    .stdout.toString()
    .split("\0")
    .filter(Boolean);
  const dirty = [...new Set([...namesBetween("HEAD", snapshot), ...staged])].filter(
    (name) => !isStore(name) && !isOverride(name),
  );
  if (dirty.length)
    fail(
      `update requires a clean source and index (patch store changes are allowed); refresh and commit source and patch store before update:\n${dirty.join("\n")}`,
    );
}
function forkAdditions(snapshot, target) {
  const source = entries(snapshot);
  const targetEntries = entries(target);
  const targetDirectories = new Set();
  for (const name of targetEntries.keys()) {
    let slash = name.indexOf("/");
    while (slash !== -1) {
      targetDirectories.add(name.slice(0, slash));
      slash = name.indexOf("/", slash + 1);
    }
  }
  const additions = [];
  for (const [name, entry] of source) {
    if (
      isStore(name) ||
      isDirect(name) ||
      CONTROL_FILES.has(name) ||
      name === "LICENSE" ||
      /\.md$/i.test(name)
    )
      continue;
    const official = targetEntries.get(name);
    if (official && !same(official, entry))
      fail(`Fork addition collides with upstream path: ${name}`);
    let collision = targetDirectories.has(name) ? name : undefined;
    let slash = name.indexOf("/");
    while (!collision && slash !== -1) {
      const parent = name.slice(0, slash);
      if (targetEntries.has(parent)) collision = parent;
      slash = name.indexOf("/", slash + 1);
    }
    if (collision) fail(`Fork addition collides with upstream path: ${name} (${collision})`);
    if (!official) additions.push([name, entry]);
  }
  return additions;
}
function pristine(base, snapshot) {
  const upstream = entries(base);
  const source = entries(snapshot);
  const invalid = [];
  for (const [name, entry] of source) {
    if (name === "AGENTS.md" || isDirect(name) || isStore(name)) continue;
    if (name === "LICENSE" || /\.md$/i.test(name) || name === "packages/app/package.json") {
      if (!same(entry, upstream.get(name))) invalid.push(name);
    } else if (!CONTROL_FILES.has(name) && upstream.has(name)) invalid.push(name);
  }
  for (const name of upstream.keys()) {
    if (
      (name === "LICENSE" ||
        name === "packages/app/package.json" ||
        (/\.md$/i.test(name) && name !== "AGENTS.md")) &&
      !source.has(name)
    )
      invalid.push(name);
  }
  if (invalid.length)
    fail(
      `Canonical source contains unauthorized or mismatched upstream files:\n${invalid.join("\n")}`,
    );
}
function assertProductChanges(base, patched) {
  const official = entries(base),
    replayed = entries(patched);
  const invalid = [...new Set([...official.keys(), ...replayed.keys()])].filter(
    (name) =>
      !same(official.get(name), replayed.get(name)) &&
      (!official.has(name) || isDirect(name) || /\.md$/i.test(name)),
  );
  if (invalid.length) fail(`Patches modify disallowed paths:\n${invalid.join("\n")}`);
}
function effective(base, snapshot, patches, index) {
  pristine(base.commit, snapshot);
  const patched = replay(base.commit, patches, index);
  assertProductChanges(base.commit, patched);
  const additions = forkAdditions(snapshot, patched);
  const source = entries(snapshot);
  initIndex(index, replayCI(base.commit, snapshot, patched, index));
  setEntries(index, [
    ...additions,
    ["AGENTS.md", source.get("AGENTS.md")],
    ...[...source].filter(([name]) => isStore(name)),
  ]);
  return tree(index);
}
function workspaceSnapshot(directory, start, index) {
  indexed(index, ["read-tree", "--reset", start]);
  indexed(index, ["-C", directory, "add", "-A", "--", "."]);
  return tree(index);
}
function differences(a, b) {
  const left = entries(a),
    right = entries(b);
  return [...new Set([...left.keys(), ...right.keys()])].filter(
    (name) => !isStore(name) && !same(left.get(name), right.get(name)),
  );
}
function marker(directory) {
  return path.join(directory, ".dev", "fork-build-state.json");
}
function readState(directory) {
  try {
    return JSON.parse(readFileSync(marker(directory), "utf8"));
  } catch {
    fail(`Not a managed fork worktree: ${directory}`);
  }
}
function stateWrite(directory, state) {
  mkdirSync(path.dirname(marker(directory)), { recursive: true });
  writeFileSync(marker(directory), `${JSON.stringify(state, null, 2)}\n`);
}
async function lock(directory, action) {
  const lockDir = path.join(
    root,
    ".dev",
    `fork-lock-${createHash("sha256").update(directory).digest("hex")}`,
  );
  mkdirSync(path.dirname(lockDir), { recursive: true });
  try {
    mkdirSync(lockDir);
  } catch (error) {
    if (error.code === "EEXIST") fail(`Fork worktree is locked: ${directory}`);
    throw error;
  }
  try {
    return await action();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}
function materialize(directory, resultTree, base, index) {
  const head = resolve("HEAD");
  const state = { sourceRoot: root, sourceHead: head, tree: resultTree, baseCommit: base.commit };
  if (existsSync(directory)) {
    const old = readState(directory);
    if (old.sourceRoot !== root) fail(`Worktree belongs to another source: ${directory}`);
    if (
      realpathSync(directory) === root ||
      runGit(["-C", directory, "symbolic-ref", "-q", "HEAD"], { allowFailure: true }).status === 0
    )
      fail(`Expected detached managed worktree: ${directory}`);
    const actualRoot = runGit(["-C", directory, "rev-parse", "--show-toplevel"])
      .stdout.toString()
      .trim();
    if (realpathSync(actualRoot) !== realpathSync(directory))
      fail(`Not a worktree root: ${directory}`);
    const stagedTree = runGit(["-C", directory, "write-tree"]).stdout.toString().trim();
    const stagedChanges = differences(old.tree, stagedTree);
    if (stagedChanges.length) fail(`Worktree index has edits:\n${stagedChanges.join("\n")}`);
    const actual = workspaceSnapshot(directory, old.tree, index);
    const oldChanges = differences(old.tree, actual);
    const newChanges = new Set(differences(resultTree, actual));
    const unpreserved = oldChanges.filter((name) => newChanges.has(name));
    if (unpreserved.length) fail(`Worktree has unpreserved edits:\n${unpreserved.join("\n")}`);
    runGit(["-C", directory, "read-tree", "--reset", "-u", resultTree]);
    runGit(["-C", directory, "update-ref", "HEAD", head]);
  } else {
    mkdirSync(path.dirname(directory), { recursive: true });
    runGit(["worktree", "add", "--detach", directory, head]);
    runGit(["-C", directory, "read-tree", "--reset", "-u", resultTree]);
  }
  stateWrite(directory, state);
  return state;
}
function dependencyStamp(resultTree) {
  const hash = createHash("sha256");
  hash.update(`${process.versions.modules}:${process.platform}:${process.arch}`);
  for (const [name, entry] of entries(resultTree)) {
    if (
      /(^|\/)package(-lock)?\.json$/.test(name) ||
      name.startsWith("patches/") ||
      /(^|\/)postinstall[^/]*$/.test(name)
    )
      hash.update(`${name}\0${entry.mode}\0${entry.oid}\0`);
  }
  return hash.digest("hex");
}
function bootstrapFiles(patched, target) {
  const pkg = JSON.parse(runGit(["show", `${patched}:package.json`]).stdout.toString());
  const scripts = Object.fromEntries(
    Object.keys(pkg.scripts || {})
      .filter((name) => !["preinstall", "install", "postinstall", "prepare"].includes(name))
      .map((name) => [name, `node scripts/fork/upstream.mjs run -- npm run ${name} --`]),
  );
  scripts["fork:update"] = "node scripts/fork/upstream.mjs update";
  const version = JSON.parse(runGit(["show", `${target}:package.json`]).stdout.toString()).version;
  const bootstrap = { name: "paseo-downstream", version, private: true, scripts };
  const bootstrapLock = {
    name: bootstrap.name,
    version: bootstrap.version,
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: bootstrap.name, version: bootstrap.version } },
  };
  return [bootstrap, bootstrapLock].map((value) => `${JSON.stringify(value, null, 2)}\n`);
}
function blob(content) {
  return {
    mode: "100644",
    oid: runGit(["hash-object", "-w", "--stdin"], { input: content }).stdout.toString().trim(),
  };
}
function update(targetRef, target, base, snapshot, patches, index) {
  cleanForUpdate(snapshot);
  const committed = committedStore();
  if (committed.base.commit !== base.commit) fail("Working manifest differs from HEAD");
  pristine(base.commit, "HEAD");
  assertProductChanges(base.commit, replay(base.commit, committed.patches, index));
  pristine(base.commit, snapshot);
  if (target === base.commit && targetRef === base.ref) {
    console.log(`Already pinned to ${targetRef} (${target}); nothing to update.`);
    return;
  }
  const patched = replay(target, patches, index);
  assertProductChanges(target, patched);
  forkAdditions(snapshot, target);
  const rebased = patchesFor(target, patched, index);
  const direct = entries(replayCI(base.commit, snapshot, target, index));
  const source = entries(snapshot);
  const targetEntries = entries(target);
  const synchronized = new Set(
    [...source.keys(), ...targetEntries.keys()].filter(
      (name) =>
        name !== "AGENTS.md" &&
        (name === "LICENSE" || name === "packages/app/package.json" || /\.md$/i.test(name)),
    ),
  );
  const overrides = new Set([...source.keys(), ...direct.keys()].filter(isOverride));
  const adopted = [...source.keys()].filter(
    (name) =>
      targetEntries.has(name) &&
      !isStore(name) &&
      !isDirect(name) &&
      !CONTROL_FILES.has(name) &&
      name !== "LICENSE" &&
      !/\.md$/i.test(name),
  );
  const [packageJson, packageLock] = bootstrapFiles(patched, target);
  initIndex(index, snapshot);
  setEntries(index, [
    ...[...synchronized].map((name) => [name, targetEntries.get(name)]),
    ...[...overrides].map((name) => [name, direct.get(name)]),
    ...adopted.map((name) => [name, undefined]),
    ["package.json", blob(packageJson)],
    ["package-lock.json", blob(packageLock)],
  ]);
  const pristineTarget = tree(index);
  const before = entries(snapshot);
  const after = entries(pristineTarget);
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
    (name) => !same(before.get(name), after.get(name)),
  );
  for (const name of changed) {
    if (!before.has(name) && after.has(name) && existsSync(path.join(root, name)))
      fail(`Update would overwrite an untracked path: ${name}`);
  }
  for (const name of changed) {
    if (!after.has(name)) rmSync(path.join(root, name), { force: true });
  }
  const written = changed.filter((name) => after.has(name));
  if (written.length)
    indexed(index, ["checkout-index", "--force", "--stdin", "-z"], {
      input: Buffer.from(`${written.join("\0")}\0`),
    });
  writeStore(targetRef, target, rebased);
  console.log(`Updated to ${targetRef} (${target}); review and commit the changes.`);
}
function parse(args) {
  const command = args.shift(),
    options = {},
    rest = [];
  const allowed = {
    check: ["upstream"],
    tree: [],
    materialize: ["directory"],
    run: ["directory", "cwd", "no-install"],
    refresh: ["directory"],
    "ci-apply": [],
    update: ["upstream"],
  };
  if (!allowed[command]) fail(`Unknown command: ${command || "(none)"}`);
  while (args.length) {
    const flag = args.shift();
    if (flag === "--" && command === "run") {
      rest.push(...args);
      break;
    }
    const key = flag.startsWith("--") ? flag.slice(2) : "";
    if (!allowed[command].includes(key) || Object.hasOwn(options, key))
      fail(`Invalid argument: ${flag}`);
    if (key === "no-install") options[key] = true;
    else {
      if (!args.length || args[0].startsWith("--")) fail(`Missing value for ${flag}`);
      options[key] = args.shift();
    }
  }
  if (command === "run" && !rest.length) fail("run requires -- <command...>");
  if (command === "refresh" && !options.directory) fail("refresh requires --directory");
  return { command, options, rest };
}
let root, temporary, exitSignal;
function refresh(options, base, snapshot, patches, index) {
  pristine(base.commit, snapshot);
  const directory = path.resolve(options.directory),
    state = readState(directory);
  if (state.sourceRoot !== root || state.baseCommit !== base.commit)
    fail("Worktree does not belong to this source and baseline");
  const currentTree = effective(base, snapshot, patches, index);
  if (differences(state.tree, currentTree).length)
    fail("Worktree is stale: canonical source or patches changed since materialization");
  const edited = workspaceSnapshot(directory, state.tree, index);
  const baseEntries = entries(base.commit),
    current = entries(snapshot),
    changed = entries(edited);
  const ciChanges = differences(state.tree, edited).filter(isOverride);
  if (ciChanges.length)
    fail(`Edit direct override files in the canonical checkout first:\n${ciChanges.join("\n")}`);
  const forkChanges = [...new Set([...current.keys(), ...changed.keys()])].filter(
    (name) =>
      !baseEntries.has(name) && !isStore(name) && !same(current.get(name), changed.get(name)),
  );
  if (forkChanges.length)
    fail(`Copy fork-only edits to the canonical checkout first:\n${forkChanges.join("\n")}`);
  writeStore(base.ref, base.commit, patchesFor(base.commit, edited, index));
  console.log(`Refreshed patches against ${base.ref}.`);
}

function resultFor(command, base, snapshot, patches, index) {
  let resultTree;
  if (command === "ci-apply" && existsSync(marker(root))) {
    const state = readState(root);
    if (
      state.sourceRoot !== root ||
      state.sourceHead !== resolve("HEAD") ||
      state.baseCommit !== base.commit
    )
      fail("CI marker does not match this checkout");
    const actualIndexFile = path.join(temporary, "ci-index");
    const realIndex = runGit(["rev-parse", "--git-path", "index"]).stdout.toString().trim();
    copyFileSync(path.resolve(root, realIndex), actualIndexFile);
    const actualIndex = indexed(actualIndexFile, ["write-tree"]).stdout.toString().trim();
    if (snapshot !== state.tree || actualIndex !== state.tree)
      fail("Managed CI checkout has unrecorded worktree or index changes");
    resultTree = effective(base, git("rev-parse", "--verify", "HEAD^{tree}"), patches, index);
    if (resultTree !== state.tree) fail("Managed CI checkout does not match current patches");
  } else resultTree = effective(base, snapshot, patches, index);
  return resultTree;
}

async function runWorkspace(command, options, rest, resultTree, base, index) {
  const directory = path.resolve(options.directory || path.join(root, ".dev/fork-build"));
  const cwd = path.resolve(directory, options.cwd || ".");
  if (cwd !== directory && !cwd.startsWith(`${directory}${path.sep}`))
    fail("--cwd must remain within the worktree");
  const childEnv = {
    ...process.env,
    PASEO_FORK_RUNTIME_ROOT: directory,
    PASEO_BRANCH_NAME: process.env.PASEO_BRANCH_NAME ?? git("branch", "--show-current"),
  };
  let activeChild, interrupted;
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = new Map(
    signals.map((signal) => [
      signal,
      () => {
        interrupted ||= signal;
        if (!activeChild?.pid) return;
        try {
          if (process.platform === "win32")
            spawnSync("taskkill", ["/pid", String(activeChild.pid), "/t", "/f"], {
              stdio: "ignore",
            });
          else process.kill(-activeChild.pid, signal);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      },
    ]),
  );
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const execute = (file, args, workingDirectory) =>
    new Promise((resolveChild, rejectChild) => {
      const child = spawn(file, args, {
        cwd: workingDirectory,
        env: childEnv,
        stdio: "inherit",
        detached: process.platform !== "win32",
        shell: process.platform === "win32",
      });
      activeChild = child;
      child.once("error", rejectChild);
      child.once("close", (status, signal) => {
        activeChild = undefined;
        resolveChild({ status, signal });
      });
    });
  try {
    await lock(directory, async () => {
      materialize(directory, resultTree, base, index);
      if (command === "materialize" || interrupted) return;
      const stamp = path.join(directory, ".dev", "fork-install-stamp"),
        expected = dependencyStamp(resultTree);
      if (
        !options["no-install"] &&
        (!existsSync(stamp) ||
          readFileSync(stamp, "utf8") !== expected ||
          !existsSync(path.join(directory, "node_modules")))
      ) {
        const install = await execute("npm", ["ci"], directory);
        if (interrupted) return;
        if (install.signal) {
          exitSignal = install.signal;
          return;
        }
        if (install.status !== 0) fail(`npm ci failed (${install.status})`);
        mkdirSync(path.join(directory, "node_modules"), { recursive: true });
        writeFileSync(stamp, expected);
      }
    });
    if (command === "materialize" && !interrupted) console.log(directory);
    else if (!interrupted && !exitSignal) {
      const child = await execute(rest[0], rest.slice(1), cwd);
      if (child.signal) exitSignal = child.signal;
      else process.exitCode = child.status;
    }
  } finally {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    exitSignal = interrupted || exitSignal;
  }
}

function resolveRunSource(command, options) {
  if (command === "run" && existsSync(marker(root))) {
    const state = readState(root);
    if (typeof state.sourceRoot !== "string" || !path.isAbsolute(state.sourceRoot))
      fail(`Invalid managed fork worktree source: ${root}`);
    if (state.sourceRoot !== root) {
      options.directory ||= root;
      root = realpathSync(state.sourceRoot);
    }
  }
}

async function resolveUpdateTarget(upstream) {
  const tag = upstream || (await fetchLatestReleaseTag());
  const ref = `refs/tags/${tag}`;
  if (runGit(["check-ref-format", ref], { allowFailure: true }).status !== 0)
    fail(`Invalid upstream tag: ${tag}`);
  if (upstream) return { tag, target: resolve(ref) };
  const remote = "https://github.com/getpaseo/paseo.git";
  const advertised = git("ls-remote", "--refs", remote, ref).split(/\s+/)[0];
  if (!/^[0-9a-f]{40,64}$/.test(advertised)) fail(`Official tag not found: ${tag}`);
  runGit(["fetch", "--no-tags", "--no-write-fetch-head", remote, ref]);
  return { tag, target: resolve(advertised) };
}

async function main() {
  const { command, options, rest } = parse(process.argv.slice(2));
  root = realpathSync(
    execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(),
  );
  resolveRunSource(command, options);
  temporary = mkdtempSync(path.join(tmpdir(), "paseo-upstream-"));
  const index = path.join(temporary, "index"),
    snapshot = sourceTree(index);
  if (command === "ci-apply") {
    if (
      process.env.GITHUB_ACTIONS !== "true" &&
      process.env.EAS_BUILD !== "true" &&
      !(
        process.env.CI === "1" &&
        process.env.EAS_BUILD_PROJECT_ID === "fbf5a457-e6af-4dce-a36e-6b79b413f734"
      )
    )
      fail("ci-apply requires a disposable CI checkout");
  }
  {
    const pin = JSON.parse(readFileSync(path.join(root, STORE, "series.json"), "utf8")).commit;
    if (typeof pin !== "string" || !/^[0-9a-f]{40,64}$/.test(pin))
      fail("Invalid upstream manifest commit");
    if (runGit(["cat-file", "-e", `${pin}^{commit}`], { allowFailure: true }).status !== 0)
      runGit(["fetch", "--no-tags", "https://github.com/getpaseo/paseo.git", pin]);
  }
  const base = manifest(),
    patches = readPatches();
  if (command === "update") {
    const { tag, target } = await resolveUpdateTarget(options.upstream);
    update(tag, target, base, snapshot, patches, index);
    return;
  }
  if (command === "refresh") {
    refresh(options, base, snapshot, patches, index);
    return;
  }
  if (command === "check" && options.upstream) {
    const committed = committedStore();
    if (committed.base.commit !== base.commit) fail("Working manifest differs from HEAD");
    pristine(base.commit, "HEAD");
    assertProductChanges(base.commit, replay(base.commit, committed.patches, index));
    pristine(base.commit, snapshot);
    const target = resolve(options.upstream);
    const patched = replay(target, patches, index);
    assertProductChanges(target, patched);
    forkAdditions(snapshot, target);
    replayCI(base.commit, snapshot, target, index);
    console.log(`Pristine source and patches verified against ${options.upstream}.`);
    return;
  }
  const resultTree = resultFor(command, base, snapshot, patches, index);
  if (command === "check") {
    console.log(`Pristine source and patches verified against ${options.upstream || base.ref}.`);
  } else if (command === "tree") {
    console.log(
      JSON.stringify({
        tree: resultTree,
        sourceRoot: root,
        sourceHead: resolve("HEAD"),
        base: { ref: base.ref, commit: base.commit },
      }),
    );
  } else if (command === "ci-apply") {
    runGit(["read-tree", "--reset", "-u", resultTree]);
    stateWrite(root, {
      sourceRoot: root,
      sourceHead: resolve("HEAD"),
      tree: resultTree,
      baseCommit: base.commit,
    });
  } else {
    await runWorkspace(command, options, rest, resultTree, base, index);
  }
}

try {
  if (process.argv.length === 2 || process.argv.slice(2).includes("--help")) console.log(HELP);
  else await main();
} catch (error) {
  console.error(`upstream: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
if (exitSignal) process.kill(process.pid, exitSignal);
