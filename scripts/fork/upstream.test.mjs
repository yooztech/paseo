import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("./upstream.mjs", import.meta.url));
const store = "scripts/fork/upstream";
const patches = ["01-app.patch", "02-runtime.patch", "03-tooling.patch"];
const bootstrap = [
  "packages/app/app.config.js",
  "packages/app/eas.json",
  "packages/app/native-release-version.js",
];

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "pristine-upstream-"));
  const repo = path.join(root, "repo");
  mkdirSync(repo);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const put = (name, data, dir = repo) => {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, data);
  };
  const get = (name, dir = repo) => readFileSync(path.join(dir, name), "utf8");
  const runEnv = (env, ...args) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, GITHUB_ACTIONS: "", EAS_BUILD: "", ...env },
    });
  const run = (...args) => runEnv({}, ...args);
  const ok = (...args) => {
    const result = run(...args);
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stdout}\n${result.stderr}`);
    return result;
  };
  const fail = (...args) => {
    const result = run(...args);
    assert.notEqual(result.status, 0, `${args.join(" ")} unexpectedly succeeded`);
    return `${result.stdout}\n${result.stderr}`;
  };
  git("init", "-q");
  git("config", "user.name", "Test User");
  git("config", "user.email", "test@example.invalid");
  put(".gitignore", ".dev/\nnode_modules/\n");
  put("packages/app/view.txt", "base app\n");
  for (const name of bootstrap)
    put(name, "base\nunchanged 1\nunchanged 2\nunchanged 3\nunchanged 4\nend\n");
  put("packages/server/runtime.txt", "base runtime\n");
  put("tools/config.txt", "base tooling\n");
  put("tools/delete.txt", "delete me\n");
  put("tools/execute.sh", "#!/bin/sh\necho base\n");
  put("tools/tracked-executable.sh", "#!/bin/sh\necho tracked\n");
  chmodSync(path.join(repo, "tools/tracked-executable.sh"), 0o755);
  put("assets/image.bin", Buffer.from([0, 1, 2, 255]));
  put("AGENTS.md", "official instructions\n");
  put("README.md", "official readme\n");
  put(".github/workflows/build.yml", "name: official\njobs: build\n");
  put(".github/workflows/remove.yml", "name: remove\n");
  put(".github/workflows/README.md", "official CI documentation\n");
  put(".github/actions/setup/action.yml", "name: official setup\n");
  put("packages/app/.eas/workflows/build.yml", "name: official mobile\n");
  put(".github/ci-paths.yml", "paths: official\n");
  put(
    "package.json",
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      scripts: { postinstall: "node install.cjs" },
    }) + "\n",
  );
  put(
    "package-lock.json",
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: { "": { name: "fixture", version: "1.0.0", hasInstallScript: true } },
    }) + "\n",
  );
  put(
    "install.cjs",
    "const fs=require('fs');fs.mkdirSync('.dev',{recursive:true});fs.appendFileSync('.dev/install-count','install\\n');\n",
  );
  git("add", ".");
  git("update-index", "--chmod=+x", "tools/tracked-executable.sh");
  git("commit", "-qm", "official base");
  git("tag", "upstream-base");
  const base = git("rev-parse", "HEAD");
  git("checkout", "-qb", "fork");
  put("packages/app/view.txt", "fork app\n");
  put("packages/server/runtime.txt", "fork runtime\n");
  put("tools/config.txt", "fork tooling\n");
  put("assets/image.bin", Buffer.from([0, 9, 8, 255]));
  rmSync(path.join(repo, "tools/delete.txt"));
  chmodSync(path.join(repo, "tools/execute.sh"), 0o755);
  const diff = (...paths) =>
    execFileSync("git", ["diff", "--binary", "--", ...paths], { cwd: repo, encoding: "utf8" });
  const contents = [diff("packages/app"), diff("packages/server"), diff("tools", "assets")];
  git("restore", ".");
  put("AGENTS.md", "fork instructions\n");
  put("fork-only/local.txt", "fork addition\n");
  put(`${store}/series.json`, JSON.stringify({ ref: "upstream-base", commit: base }) + "\n");
  patches.forEach((name, index) => put(`${store}/${name}`, contents[index]));
  git("add", "-A");
  git("commit", "-qm", "fork metadata and additions");
  return {
    root,
    repo,
    base,
    git,
    put,
    get,
    run,
    runEnv,
    ok,
    fail,
    workspace: path.join(root, "build"),
  };
}

function nextBase(f, edit = () => {}) {
  f.git("checkout", "-qb", "official-next", "upstream-base");
  edit();
  f.git("add", "-A");
  f.git("commit", "-qm", "official next");
  f.git("tag", "upstream-next");
  const commit = f.git("rev-parse", "HEAD");
  f.git("checkout", "-q", "fork");
  return commit;
}

function snapshot(f) {
  return {
    status: f.git("status", "--porcelain=v1", "--untracked-files=all"),
    index: readFileSync(path.join(f.repo, ".git/index")),
    head: f.git("rev-parse", "HEAD"),
  };
}

test("direct CI exceptions do not exempt business files or CI Markdown", (t) => {
  const f = fixture(t);
  for (const name of [
    ".github/workflows/build.yml",
    ".github/actions/setup/action.yml",
    "packages/app/.eas/workflows/build.yml",
    ".github/ci-paths.yml",
  ]) {
    f.put(name, "fork CI\n");
  }
  f.ok("check");
  f.put("packages/app/view.txt", "unexpected business edit\n");
  assert.match(f.fail("check"), /packages\/app\/view\.txt/);
  f.git("restore", "packages/app/view.txt");
  f.put(".github/workflows/README.md", "changed documentation\n");
  assert.match(f.fail("check"), /README\.md/);
});

test("tree, materialize and ci-apply retain modified, added and deleted canonical CI", (t) => {
  const f = fixture(t);
  const workflow = JSON.stringify({
    jobs: {
      build: {
        steps: [
          {
            run: "node -e \"if(require('fs').readFileSync('packages/app/view.txt','utf8')!=='fork app\\n')process.exit(1)\"",
          },
        ],
      },
    },
  });
  f.put(".github/workflows/build.yml", workflow);
  f.put(".github/workflows/added.yml", "name: added\n");
  rmSync(path.join(f.repo, ".github/workflows/remove.yml"));
  f.git("add", "-A");
  f.git("commit", "-qm", "customize CI");
  const tree = JSON.parse(f.ok("tree").stdout).tree;
  assert.equal(f.git("show", `${tree}:.github/workflows/build.yml`), workflow);
  assert.equal(f.git("show", `${tree}:.github/workflows/added.yml`), "name: added");
  assert.notEqual(
    spawnSync("git", ["cat-file", "-e", `${tree}:.github/workflows/remove.yml`], { cwd: f.repo })
      .status,
    0,
  );
  f.ok("materialize", "--directory", f.workspace);
  assert.equal(f.get(".github/workflows/build.yml", f.workspace), workflow);
  assert.equal(f.get(".github/workflows/added.yml", f.workspace), "name: added\n");
  assert.equal(existsSync(path.join(f.workspace, ".github/workflows/remove.yml")), false);
  const result = f.runEnv({ GITHUB_ACTIONS: "true" }, "ci-apply");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(f.get(".github/workflows/build.yml"), workflow);
  assert.equal(f.get(".github/workflows/added.yml"), "name: added\n");
  assert.equal(existsSync(path.join(f.repo, ".github/workflows/remove.yml")), false);
  const command = JSON.parse(f.get(".github/workflows/build.yml")).jobs.build.steps[0].run;
  const action = spawnSync(command, { cwd: f.repo, shell: true, encoding: "utf8" });
  assert.equal(action.status, 0, `${action.stdout}\n${action.stderr}`);
  const again = f.runEnv({ GITHUB_ACTIONS: "true" }, "ci-apply");
  assert.equal(again.status, 0, `${again.stdout}\n${again.stderr}`);
});

test("product patches cannot alter direct CI or AGENTS overrides", (t) => {
  for (const name of [".github/workflows/build.yml", "AGENTS.md", ...bootstrap]) {
    const f = fixture(t);
    nextBase(f, () => f.put("tools/new.txt", "new upstream\n"));
    f.put(name, "forbidden patch edit\n");
    const patch = execFileSync("git", ["diff", "--binary", "--", name], {
      cwd: f.repo,
      encoding: "utf8",
    });
    f.git("restore", name);
    f.put(`${store}/${patches[2]}`, f.get(`${store}/${patches[2]}`) + patch);
    assert.match(f.fail("check"), /disallowed|AGENTS/i);
    assert.match(f.fail("check", "--upstream", "upstream-next"), /disallowed|AGENTS/i);
    const dest = path.join(f.root, "rejected-override");
    assert.match(
      f.fail("prepare", "--upstream", "upstream-next", "--directory", dest),
      /disallowed|AGENTS/i,
    );
    assert.equal(existsSync(dest), false);
  }
});

test("refresh refuses generated CI changes without modifying patches", (t) => {
  const f = fixture(t);
  f.ok("materialize", "--directory", f.workspace);
  const before = patches.map((name) => f.get(`${store}/${name}`));
  f.put(".github/workflows/build.yml", "generated edit\n", f.workspace);
  f.put("packages/app/view.txt", "generated business edit\n", f.workspace);
  assert.match(f.fail("refresh", "--directory", f.workspace), /CI|workflow|direct/i);
  assert.deepEqual(
    patches.map((name) => f.get(`${store}/${name}`)),
    before,
  );
  assert.equal(f.get(".github/workflows/build.yml", f.workspace), "generated edit\n");
});

test("bootstrap overrides materialize, rebase in prepare and reject generated edits", (t) => {
  const f = fixture(t);
  nextBase(f, () => {
    for (const name of bootstrap)
      f.put(name, "base\nunchanged 1\nunchanged 2\nunchanged 3\nunchanged 4\nupstream end\n");
  });
  for (const name of bootstrap)
    f.put(name, "fork\nunchanged 1\nunchanged 2\nunchanged 3\nunchanged 4\nend\n");
  f.ok("check");
  f.ok("materialize", "--directory", f.workspace);
  for (const name of bootstrap) assert.equal(f.get(name, f.workspace), f.get(name));
  const before = patches.map((name) => f.get(`${store}/${name}`));
  for (const name of bootstrap) {
    f.put(name, "generated edit\n", f.workspace);
    assert.match(f.fail("refresh", "--directory", f.workspace), /CI|bootstrap|direct/i);
    f.put(name, f.get(name), f.workspace);
  }
  assert.deepEqual(
    patches.map((name) => f.get(`${store}/${name}`)),
    before,
  );
  const dest = path.join(f.root, "bootstrap-upgrade");
  f.ok("prepare", "--upstream", "upstream-next", "--directory", dest);
  for (const name of bootstrap)
    assert.equal(
      f.get(name, dest),
      "fork\nunchanged 1\nunchanged 2\nunchanged 3\nunchanged 4\nupstream end\n",
    );
});

test("conflicting bootstrap overrides stop prepare without creating a worktree", (t) => {
  for (const name of bootstrap) {
    const f = fixture(t);
    nextBase(f, () => f.put(name, "upstream conflict\n"));
    f.put(name, "fork conflict\n");
    const dest = path.join(f.root, "bootstrap-conflict");
    assert.ok(f.fail("prepare", "--upstream", "upstream-next", "--directory", dest).includes(name));
    assert.equal(existsSync(dest), false);
  }
});

test("canonical bootstrap edits invalidate a materialized worktree without discarding edits", (t) => {
  const f = fixture(t);
  f.ok("materialize", "--directory", f.workspace);
  f.put("packages/app/view.txt", "workspace edit\n", f.workspace);
  f.put(bootstrap[0], "canonical update\n");
  assert.notEqual(f.run("materialize", "--directory", f.workspace).status, 0);
  assert.equal(f.get("packages/app/view.txt", f.workspace), "workspace edit\n");
});

test("ci-apply accepts the EAS workflow job context", (t) => {
  const f = fixture(t);
  const denied = f.runEnv({ CI: "1", EAS_BUILD_PROJECT_ID: "other" }, "ci-apply");
  assert.notEqual(denied.status, 0);
  const result = f.runEnv(
    { CI: "1", EAS_BUILD_PROJECT_ID: "fbf5a457-e6af-4dce-a36e-6b79b413f734" },
    "ci-apply",
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(f.get("packages/app/view.txt"), "fork app\n");
});

test("canonical CI edits invalidate cache without discarding workspace edits", (t) => {
  const f = fixture(t);
  f.ok("materialize", "--directory", f.workspace);
  f.put(".github/workflows/build.yml", "canonical update\n");
  f.ok("materialize", "--directory", f.workspace);
  assert.equal(f.get(".github/workflows/build.yml", f.workspace), "canonical update\n");
  f.put("packages/app/view.txt", "developer edit\n", f.workspace);
  f.put(".github/workflows/build.yml", "another canonical update\n");
  f.fail("materialize", "--directory", f.workspace);
  assert.equal(f.get("packages/app/view.txt", f.workspace), "developer edit\n");
  assert.equal(f.get(".github/workflows/build.yml", f.workspace), "canonical update\n");
});

test("prepare rebases direct CI changes and preserves new and independent upstream CI", (t) => {
  const f = fixture(t);
  f.put(".github/workflows/build.yml", "name: fork build\njobs: build\n");
  f.put(".github/workflows/fork.yml", "name: fork addition\n");
  rmSync(path.join(f.repo, ".github/workflows/remove.yml"));
  f.git("add", "-A");
  f.git("commit", "-qm", "fork CI changes");
  nextBase(f, () => {
    f.put(".github/actions/setup/action.yml", "name: upstream improved setup\n");
    f.put(".github/workflows/new.yml", "name: new upstream workflow\n");
  });
  const before = snapshot(f);
  const dest = path.join(f.root, "upgrade-ci");
  f.ok("prepare", "--upstream", "upstream-next", "--directory", dest);
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.get(".github/workflows/build.yml", dest), "name: fork build\njobs: build\n");
  assert.equal(f.get(".github/workflows/fork.yml", dest), "name: fork addition\n");
  assert.equal(existsSync(path.join(dest, ".github/workflows/remove.yml")), false);
  assert.equal(f.get(".github/workflows/new.yml", dest), "name: new upstream workflow\n");
  assert.equal(f.get(".github/actions/setup/action.yml", dest), "name: upstream improved setup\n");
  assert.equal(f.get("packages/app/view.txt", dest), "base app\n");
});

test("prepare converges identical CI deletions, additions and modifications", (t) => {
  const f = fixture(t);
  const applySharedChanges = () => {
    rmSync(path.join(f.repo, ".github/workflows/remove.yml"));
    f.put(".github/workflows/build.yml", "name: shared update\njobs: build\n");
    f.put(".github/workflows/shared.yml", "name: shared addition\n");
  };
  applySharedChanges();
  f.git("add", "-A");
  f.git("commit", "-qm", "fork convergent CI changes");
  nextBase(f, () => {
    applySharedChanges();
    f.put(".github/workflows/upstream-only.yml", "name: new upstream\n");
  });
  const before = snapshot(f);
  f.ok("check", "--upstream", "upstream-next");
  const dest = path.join(f.root, "convergent-upgrade");
  f.ok("prepare", "--upstream", "upstream-next", "--directory", dest);
  assert.deepEqual(snapshot(f), before);
  assert.equal(existsSync(path.join(dest, ".github/workflows/remove.yml")), false);
  assert.equal(f.get(".github/workflows/build.yml", dest), "name: shared update\njobs: build\n");
  assert.equal(f.get(".github/workflows/shared.yml", dest), "name: shared addition\n");
  assert.equal(f.get(".github/workflows/upstream-only.yml", dest), "name: new upstream\n");
});

test("prepare reports direct CI conflicts before creating output", (t) => {
  const f = fixture(t);
  f.put(".github/workflows/build.yml", "name: fork conflict\njobs: build\n");
  f.git("add", "-A");
  f.git("commit", "-qm", "fork CI conflict");
  nextBase(f, () => f.put(".github/workflows/build.yml", "name: upstream conflict\njobs: build\n"));
  const before = snapshot(f);
  const dest = path.join(f.root, "conflicted-upgrade");
  const error = f.fail("prepare", "--upstream", "upstream-next", "--directory", dest);
  assert.match(error, /\.github\/workflows\/build\.yml/);
  assert.equal(existsSync(dest), false);
  assert.deepEqual(snapshot(f), before);
});

test("prepare accepts a working patch resolved against the target rather than the old base", (t) => {
  const f = fixture(t);
  f.ok("check");
  nextBase(f, () => f.put("packages/app/view.txt", "target app\n"));
  f.fail("check", "--upstream", "upstream-next");
  f.git("checkout", "-q", "official-next");
  f.put("packages/app/view.txt", "resolved fork app\n");
  const resolvedPatch = execFileSync("git", ["diff", "--binary", "--", "packages/app"], {
    cwd: f.repo,
    encoding: "utf8",
  });
  f.git("restore", "packages/app/view.txt");
  f.git("checkout", "-q", "fork");
  f.put(`${store}/${patches[0]}`, resolvedPatch);
  f.ok("check", "--upstream", "upstream-next");
  const dest = path.join(f.root, "resolved-upgrade");
  f.ok("prepare", "--upstream", "upstream-next", "--directory", dest);
  assert.equal(f.get("packages/app/view.txt", dest), "target app\n");
  const build = path.join(f.root, "resolved-build");
  const result = spawnSync(process.execPath, [cli, "materialize", "--directory", build], {
    cwd: dest,
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "", EAS_BUILD: "" },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(f.get("packages/app/view.txt", build), "resolved fork app\n");
});

test("check enforces pristine content, mode and presence except AGENTS", (t) => {
  const f = fixture(t);
  f.ok("check");
  f.put("AGENTS.md", "local instructions\n");
  f.ok("check");
  f.put("README.md", "changed\n");
  assert.match(f.fail("check"), /README\.md/);
  f.git("restore", "README.md");
  chmodSync(path.join(f.repo, "tools/execute.sh"), 0o755);
  assert.match(f.fail("check"), /tools\/execute\.sh/);
  chmodSync(path.join(f.repo, "tools/execute.sh"), 0o644);
  rmSync(path.join(f.repo, "tools/delete.txt"));
  assert.match(f.fail("check"), /tools\/delete\.txt/);
});

test("snapshots preserve tracked executable modes when Git cannot trust filesystem modes", (t) => {
  const f = fixture(t);
  f.git("config", "core.filemode", "false");
  chmodSync(path.join(f.repo, "tools/tracked-executable.sh"), 0o644);
  f.ok("check");
  f.put("tools/tracked-executable.sh", "changed\n");
  assert.match(f.fail("check"), /tools\/tracked-executable\.sh/);
  f.put("tools/tracked-executable.sh", "#!/bin/sh\necho tracked\n");
  rmSync(path.join(f.repo, "tools/tracked-executable.sh"));
  assert.match(f.fail("check"), /tools\/tracked-executable\.sh/);
  f.put("tools/tracked-executable.sh", "#!/bin/sh\necho tracked\n");
  f.ok("materialize", "--directory", f.workspace);
  chmodSync(path.join(f.workspace, "tools/tracked-executable.sh"), 0o644);
  f.ok("materialize", "--directory", f.workspace);
  f.ok("refresh", "--directory", f.workspace);
  const result = f.runEnv({ GITHUB_ACTIONS: "true" }, "ci-apply");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("replay cleans Git CRLF checkout conversion without relaxing patch matching", (t) => {
  const f = fixture(t);
  const clone = path.join(f.root, "crlf-clone");
  execFileSync("git", ["clone", "-q", "-c", "core.autocrlf=true", f.repo, clone]);
  const git = (...args) => execFileSync("git", args, { cwd: clone, encoding: "utf8" }).trim();
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: clone,
      encoding: "utf8",
      env: { ...process.env, GITHUB_ACTIONS: "true", EAS_BUILD: "" },
    });
  const patch = path.join(clone, store, patches[0]);
  const checkout = readFileSync(patch, "utf8");
  assert.match(checkout, /\r\n/);
  assert.doesNotMatch(git("show", `HEAD:${store}/${patches[0]}`), /\r/);
  assert.match(readFileSync(path.join(clone, "packages/app/view.txt"), "utf8"), /\r\n/);
  git("config", "core.filemode", "false");
  const treeResult = run("tree");
  assert.equal(treeResult.status, 0, `${treeResult.stdout}\n${treeResult.stderr}`);
  const tree = JSON.parse(treeResult.stdout).tree;
  assert.equal(git("show", `${tree}:packages/app/view.txt`), "fork app");
  assert.match(git("ls-tree", tree, "tools/execute.sh"), /^100755 /);
  assert.deepEqual(
    execFileSync("git", ["show", `${tree}:assets/image.bin`], { cwd: clone }),
    Buffer.from([0, 9, 8, 255]),
  );
  writeFileSync(patch, checkout.replace("-base app\r\n", "-wrong base\r\n"));
  const drift = run("tree");
  assert.notEqual(drift.status, 0);
  assert.match(drift.stderr, /Patch replay failed/);
  git("restore", `${store}/${patches[0]}`);
  const result = run("ci-apply");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(readFileSync(path.join(clone, "packages/app/view.txt"), "utf8"), /^fork app\r?\n$/);
});

test("missing pin label is accepted but a moved label is rejected", (t) => {
  const f = fixture(t);
  f.git("tag", "-d", "upstream-base");
  f.ok("check");
  f.git("tag", "upstream-base", "HEAD");
  assert.match(f.fail("check"), /upstream-base|moved|pin/i);
});

test("check reports conflicts in all three independent patch groups", (t) => {
  const f = fixture(t);
  nextBase(f, () => {
    f.put("packages/app/view.txt", "other app\n");
    f.put("packages/server/runtime.txt", "other runtime\n");
    f.put("tools/config.txt", "other tooling\n");
  });
  const output = f.fail("check", "--upstream", "upstream-next");
  for (const name of patches) assert.ok(output.includes(name), output);
});

test("tree and materialize preserve source and index and include effective changes", (t) => {
  const f = fixture(t);
  const before = snapshot(f);
  const tree = JSON.parse(f.ok("tree").stdout);
  assert.equal(tree.sourceRoot, f.repo);
  assert.equal(tree.sourceHead, before.head);
  assert.equal(tree.base.commit, f.base);
  f.ok("materialize", "--directory", f.workspace);
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.get("packages/app/view.txt"), "base app\n");
  assert.equal(f.get("packages/app/view.txt", f.workspace), "fork app\n");
  assert.deepEqual(
    readFileSync(path.join(f.workspace, "assets/image.bin")),
    Buffer.from([0, 9, 8, 255]),
  );
  assert.equal(existsSync(path.join(f.workspace, "tools/delete.txt")), false);
  assert.ok(lstatSync(path.join(f.workspace, "tools/execute.sh")).mode & 0o111);
  assert.equal(f.get("AGENTS.md", f.workspace), "fork instructions\n");
  assert.equal(f.get("fork-only/local.txt", f.workspace), "fork addition\n");
  const state = JSON.parse(f.get(".dev/fork-build-state.json", f.workspace));
  assert.equal(state.tree, tree.tree);
  assert.equal(state.sourceHead, before.head);
  assert.equal(state.sourceRoot, f.repo);
  assert.equal(state.baseCommit, f.base);
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: f.workspace, encoding: "utf8" }).trim(),
    before.head,
  );
});

test("materialize reuses workspace but refuses developer edits", (t) => {
  const f = fixture(t);
  f.ok("materialize", "--directory", f.workspace);
  f.put(".dev/kept", "artifact", f.workspace);
  f.ok("materialize", "--directory", f.workspace);
  assert.equal(f.get(".dev/kept", f.workspace), "artifact");
  f.put("packages/app/view.txt", "developer edit\n", f.workspace);
  f.fail("materialize", "--directory", f.workspace);
  assert.equal(f.get("packages/app/view.txt", f.workspace), "developer edit\n");
  f.put("packages/app/view.txt", "fork app\n", f.workspace);
  f.put("fork-only/local.txt", "developer fork edit\n", f.workspace);
  f.fail("materialize", "--directory", f.workspace);
  assert.equal(f.get("fork-only/local.txt", f.workspace), "developer fork edit\n");
});

test("refresh captures generated upstream edits only, keeping canonical sources pristine", (t) => {
  const f = fixture(t);
  f.ok("materialize", "--directory", f.workspace);
  const before = snapshot(f);
  f.put("packages/app/view.txt", "refreshed app\n", f.workspace);
  f.ok("refresh", "--directory", f.workspace);
  assert.equal(f.get("packages/app/view.txt"), "base app\n");
  assert.deepEqual(readFileSync(path.join(f.repo, ".git/index")), before.index);
  assert.match(f.get(`${store}/${patches[0]}`), /refreshed app/);
  f.ok("check");
  f.ok("materialize", "--directory", f.workspace);
  assert.equal(f.get("packages/app/view.txt", f.workspace), "refreshed app\n");
  f.put("README.md", "not allowed\n", f.workspace);
  f.fail("refresh", "--directory", f.workspace);
});

test("refresh rejects a workspace made stale by uncommitted patch changes", (t) => {
  const f = fixture(t);
  f.ok("materialize", "--directory", f.workspace);
  f.put("packages/app/view.txt", "old workspace edit\n", f.workspace);
  const patch = `${store}/${patches[0]}`;
  f.put(patch, f.get(patch).replace("fork app", "new canonical patch"));
  const before = patches.map((name) => readFileSync(path.join(f.repo, store, name)));
  const head = f.git("rev-parse", "HEAD");
  f.fail("refresh", "--directory", f.workspace);
  assert.equal(f.git("rev-parse", "HEAD"), head);
  assert.deepEqual(
    patches.map((name) => readFileSync(path.join(f.repo, store, name))),
    before,
  );
  assert.equal(f.get("packages/app/view.txt", f.workspace), "old workspace edit\n");
});

test("run without install executes patched source with cwd and status", (t) => {
  const f = fixture(t);
  const result = f.run(
    "run",
    "--directory",
    f.workspace,
    "--cwd",
    "packages/app",
    "--no-install",
    "--",
    process.execPath,
    "-e",
    "process.stdout.write(require('fs').readFileSync('view.txt','utf8'));process.exit(23)",
  );
  assert.equal(result.status, 23, result.stderr);
  assert.equal(result.stdout, "fork app\n");
  assert.equal(existsSync(path.join(f.workspace, "node_modules")), false);
});

function forceKillIfAlive(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

test(
  "concurrent runs share a prepared workspace and termination reaches descendants",
  { timeout: 20000 },
  async (t) => {
    const f = fixture(t);
    const ready = path.join(f.root, "ready.json");
    const childReady = path.join(f.root, "child-ready");
    const childStopped = path.join(f.root, "child-stopped");
    const grandchildStopped = path.join(f.root, "grandchild-stopped");
    const grandchildReady = path.join(f.root, "grandchild-ready");
    const grandchildCode = `const fs = require('fs');
    process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(grandchildStopped)}, String(process.pid)); process.exit(0); });
    fs.writeFileSync(${JSON.stringify(grandchildReady)}, String(process.pid));
    setInterval(() => {}, 1000);`;
    const childCode = `const fs = require('fs');
    const child = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchildCode)}], { stdio: 'ignore' });
    fs.writeFileSync(${JSON.stringify(childReady)}, String(process.pid));
    process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(childStopped)}, String(process.pid)); });
    child.on('exit', () => process.exit(0));
    const timer = setInterval(() => {
      if (fs.existsSync(${JSON.stringify(grandchildReady)})) {
        fs.writeFileSync(${JSON.stringify(ready)}, JSON.stringify({ child: process.pid, grandchild: child.pid }));
        clearInterval(timer);
      }
    }, 10);`;
    const proc = spawn(
      process.execPath,
      [
        cli,
        "run",
        "--directory",
        f.workspace,
        "--no-install",
        "--",
        process.execPath,
        "-e",
        childCode,
      ],
      {
        cwd: f.repo,
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, GITHUB_ACTIONS: "", EAS_BUILD: "" },
      },
    );
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const closed = new Promise((resolve) =>
      proc.once("close", (code, signal) => resolve({ code, signal })),
    );
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 8000;
      while (!predicate()) {
        assert.ok(Date.now() < deadline, `timed out waiting for ${label}: ${stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    let pids;
    {
      const failures = [];
      try {
        await waitFor(() => existsSync(ready), "running command");
        pids = JSON.parse(readFileSync(ready, "utf8"));
        f.ok(
          "run",
          "--directory",
          f.workspace,
          "--no-install",
          "--",
          process.execPath,
          "-e",
          "process.exit(0)",
        );
        assert.equal(proc.exitCode, null, "first run must still be alive");
        proc.kill("SIGTERM");
        await waitFor(
          () => existsSync(childStopped) && existsSync(grandchildStopped),
          "descendant signal handlers",
        );
        await waitFor(() => proc.exitCode !== null || proc.signalCode !== null, "CLI termination");
        await closed;
        f.ok(
          "run",
          "--directory",
          f.workspace,
          "--no-install",
          "--",
          process.execPath,
          "-e",
          "process.exit(0)",
        );
      } catch (error) {
        failures.push(error);
      }
      if (failures.length === 0) return;
      try {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
        const cleanupPids = [
          pids?.child,
          pids?.grandchild,
          ...[childReady, grandchildReady]
            .filter(existsSync)
            .map((file) => Number(readFileSync(file, "utf8"))),
        ];
        for (const pid of new Set(cleanupPids.filter(Boolean))) forceKillIfAlive(pid);
        await closed;
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
      if (failures.length === 1) throw failures[0];
      throw new AggregateError(failures, "Test and process cleanup failed");
    }
  },
);

test("run installs once and invalidates on dependency input changes", (t) => {
  const f = fixture(t);
  const args = ["run", "--directory", f.workspace, "--", process.execPath, "-e", "process.exit(0)"];
  f.ok(...args);
  f.ok(...args);
  assert.equal(f.get(".dev/install-count", f.workspace), "install\n");
  // Dependency inputs are upstream files: change them in the effective tree and refresh.
  const manifest = JSON.parse(f.get("package.json", f.workspace));
  manifest.description = "changed manifest";
  f.put("package.json", JSON.stringify(manifest) + "\n", f.workspace);
  f.ok("refresh", "--directory", f.workspace);
  f.ok(...args);
  assert.equal(f.get(".dev/install-count", f.workspace), "install\ninstall\n");
  f.ok(...args);
  assert.equal(f.get(".dev/install-count", f.workspace), "install\ninstall\n");
  const lock = JSON.parse(f.get("package-lock.json", f.workspace));
  lock.packages[""].description = "changed lock";
  f.put("package-lock.json", JSON.stringify(lock) + "\n", f.workspace);
  f.ok("refresh", "--directory", f.workspace);
  f.ok(...args);
  assert.equal(f.get(".dev/install-count", f.workspace), "install\ninstall\ninstall\n");
});

test("ci-apply requires explicit CI ownership and applies effective tree", (t) => {
  const f = fixture(t);
  f.fail("ci-apply");
  assert.equal(f.get("packages/app/view.txt"), "base app\n");
  const result = f.runEnv({ GITHUB_ACTIONS: "true" }, "ci-apply");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(f.get("packages/app/view.txt"), "fork app\n");
  assert.equal(f.get("fork-only/local.txt"), "fork addition\n");
  const second = f.runEnv({ GITHUB_ACTIONS: "true" }, "ci-apply");
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  f.put("packages/app/view.txt", "tampered worktree\n");
  const before = readFileSync(path.join(f.repo, ".git/index"));
  const rejected = f.runEnv({ GITHUB_ACTIONS: "true" }, "ci-apply");
  assert.notEqual(rejected.status, 0, "tampered CI worktree must not be overwritten");
  assert.equal(f.get("packages/app/view.txt"), "tampered worktree\n");
  assert.deepEqual(readFileSync(path.join(f.repo, ".git/index")), before);
});

test("ci-apply rejects a tampered index even when worktree files match", (t) => {
  const f = fixture(t);
  const first = f.runEnv({ GITHUB_ACTIONS: "true" }, "ci-apply");
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  f.put("packages/app/view.txt", "tampered index\n");
  f.git("add", "packages/app/view.txt");
  f.put("packages/app/view.txt", "fork app\n");
  const index = readFileSync(path.join(f.repo, ".git/index"));
  const rejected = f.runEnv({ GITHUB_ACTIONS: "true" }, "ci-apply");
  assert.notEqual(rejected.status, 0, "tampered CI index must not be overwritten");
  assert.deepEqual(readFileSync(path.join(f.repo, ".git/index")), index);
  assert.equal(f.get("packages/app/view.txt"), "fork app\n");
});

test("prepare creates pristine next base with rebased patch and preserves fork overlay", (t) => {
  const f = fixture(t);
  const next = nextBase(f, () => f.put("tools/new.txt", "new official\n"));
  const before = snapshot(f);
  const dest = path.join(f.root, "upgrade");
  f.ok("prepare", "--upstream", "upstream-next", "--directory", dest);
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.get("packages/app/view.txt", dest), "base app\n");
  assert.equal(f.get("tools/new.txt", dest), "new official\n");
  assert.equal(f.get("AGENTS.md", dest), "fork instructions\n");
  assert.equal(JSON.parse(f.get(`${store}/series.json`, dest)).commit, next);
  const check = spawnSync(process.execPath, [cli, "check"], { cwd: dest, encoding: "utf8" });
  assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
  const build = path.join(f.root, "upgrade-build");
  const run = spawnSync(process.execPath, [cli, "materialize", "--directory", build], {
    cwd: dest,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.equal(f.get("packages/app/view.txt", build), "fork app\n");
});

test("prepare rejects ancestor, destination collision and stale committed source", (t) => {
  const f = fixture(t);
  nextBase(f, () => f.put("tools/new.txt", "new official\n"));
  const dest = path.join(f.root, "upgrade");
  f.fail("prepare", "--upstream", "upstream-base", "--directory", dest);
  assert.equal(existsSync(dest), false);
  mkdirSync(dest);
  f.fail("prepare", "--upstream", "upstream-next", "--directory", dest);
  rmSync(dest, { recursive: true });
  f.put("tools/config.txt", "stale committed source\n");
  f.git("add", "tools/config.txt");
  f.git("commit", "-qm", "stale source");
  f.fail("prepare", "--upstream", "upstream-next", "--directory", dest);
  assert.equal(existsSync(dest), false);
});

test("pre-commit typecheck selects the effective worktree and clears Git hook environment", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "fork-hook-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const hook = fileURLToPath(new URL("./hook-typecheck.mjs", import.meta.url));
  mkdirSync(path.join(dir, "scripts/fork"), { recursive: true });
  const record = `require('node:fs').writeFileSync('result.json', JSON.stringify({ args: process.argv.slice(2), git: process.env.GIT_INDEX_FILE }))`;
  writeFileSync(
    path.join(dir, "scripts/fork/upstream.mjs"),
    record.replace("require('node:fs')", "(await import('node:fs'))"),
  );
  const run = () =>
    spawnSync(process.execPath, [hook], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_INDEX_FILE: "/invalid/hook-index" },
    });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "result.json"))), {
    args: ["run", "--", "npm", "run", "typecheck"],
  });

  mkdirSync(path.join(dir, ".dev"));
  writeFileSync(path.join(dir, ".dev/fork-build-state.json"), "{}");
  writeFileSync(path.join(dir, "record.cjs"), record);
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ scripts: { typecheck: "node record.cjs" } }),
  );
  result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "result.json"))), { args: [] });
});
