import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { parseGitHubRepo } from "../github.mjs";
import { PATCH_BRANCH } from "../source.mjs";
import {
  RELEASE_CI_WORKFLOW,
  describeCiRuns,
  ghApi,
  requirePassingCi,
  selectPassingCiRun,
} from "./ci-gate.mjs";
import {
  createForkReleaseMetadata,
  getForkNumber,
  getForkReleaseNumber,
  publish,
} from "./release.mjs";
import { failRelease, runRelease } from "./failure.mjs";

test("allocates after all current channel tags and the historical app format", () => {
  const tags = [
    "v0.2.5-fork.2",
    "desktop-v0.2.5-fork.4",
    "app-v0.2.5-fork.6",
    "v0.2.5-fork.11-app",
    "desktop-macos-v0.2.5-fork.7",
    "v0.2.6-fork.99",
    "unrelated",
  ];
  assert.equal(getForkReleaseNumber(tags, [], "0.2.5"), 12);
  assert.equal(getForkNumber("v0.2.5-fork.11-app", "0.2.5"), 11);
  assert.equal(getForkNumber("unrelated", "0.2.5"), null);
});

test("reuses the current commit fork number across release channels", () => {
  const tags = ["v0.2.5-fork.7", "desktop-v0.2.5-fork.8", "v0.2.5-fork.8"];

  assert.equal(getForkReleaseNumber(tags, ["desktop-v0.2.5-fork.8", "v0.2.5-fork.8"], "0.2.5"), 8);
});

test("rejects conflicting release numbers on the current commit", () => {
  assert.throws(
    () =>
      getForkReleaseNumber(
        ["desktop-v0.2.5-fork.8", "app-v0.2.5-fork.9"],
        ["desktop-v0.2.5-fork.8", "app-v0.2.5-fork.9"],
        "0.2.5",
      ),
    /conflicting fork release numbers: 8, 9/,
  );
});

test("parses the github.com origin forms used by the release gate", () => {
  for (const url of [
    "https://github.com/acme/fork",
    "https://github.com/acme/fork.git",
    "git@github.com:acme/fork.git",
    "ssh://git@github.com/acme/fork",
  ]) {
    assert.equal(parseGitHubRepo(url), "acme/fork");
  }
  assert.throws(
    () => parseGitHubRepo("https://gitlab.com/acme/fork"),
    /origin is not a github\.com repository: https:\/\/gitlab\.com\/acme\/fork/,
  );
  assert.throws(
    () => parseGitHubRepo("git@gitlab.com:acme/fork.git"),
    /origin is not a github\.com repository: git@gitlab\.com:acme\/fork\.git/,
  );
});

test("selects only the completed successful ci.yml run for the branch and commit", () => {
  const sha = "a".repeat(40);
  const passing = {
    id: 7,
    run_number: 7,
    head_sha: sha,
    head_branch: PATCH_BRANCH,
    path: ".github/workflows/ci.yml",
    status: "completed",
    conclusion: "success",
    html_url: "https://example.invalid/run/7",
  };

  assert.equal(RELEASE_CI_WORKFLOW, "ci.yml");
  assert.equal(selectPassingCiRun([passing], { sha }), passing);
  assert.equal(selectPassingCiRun([{ ...passing, head_branch: "main" }], { sha }), null);
  assert.equal(
    selectPassingCiRun([{ ...passing, path: ".github/workflows/app-ios-release.yml" }], { sha }),
    null,
  );
  assert.equal(
    selectPassingCiRun([{ ...passing, status: "in_progress", conclusion: null }], { sha }),
    null,
  );
  for (const conclusion of ["failure", "cancelled"]) {
    assert.equal(selectPassingCiRun([{ ...passing, conclusion }], { sha }), null);
  }
  assert.equal(selectPassingCiRun([{ ...passing, head_sha: "b".repeat(40) }], { sha }), null);
  assert.equal(selectPassingCiRun([passing], { sha, branch: "main" }), null);
});

test("describes the candidate runs for release failures", () => {
  assert.equal(describeCiRuns([]), "none");
  const single = (overrides) => ({
    id: 1,
    run_number: 1,
    status: "completed",
    conclusion: "success",
    head_branch: PATCH_BRANCH,
    ...overrides,
  });
  assert.equal(describeCiRuns([single({})]), `#1 success (${PATCH_BRANCH})`);
  assert.equal(
    describeCiRuns([single({ status: "in_progress", conclusion: null })]),
    `#1 in_progress (${PATCH_BRANCH})`,
  );

  const many = Array.from({ length: 6 }, (_, index) =>
    single({
      id: index + 1,
      run_number: index + 1,
      conclusion: index === 5 ? "failure" : "success",
    }),
  );
  const described = describeCiRuns(many);
  assert.ok(described.endsWith(", …"), described);
  assert.match(described, new RegExp(`#5 success \\(${PATCH_BRANCH}\\), …$`));
  assert.doesNotMatch(described, /#6/);
});

test("gh failures explain which CI verification could not run", () => {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-gh-api-"));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const gh = path.join(bin, "gh");
  writeFileSync(gh, "#!/bin/sh\necho boom >&2\nexit 1\n");
  chmodSync(gh, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous}`;
  try {
    assert.throws(
      () => ghApi("repos/acme/fork/actions/workflows/ci.yml/runs"),
      /gh api repos\/acme\/fork\/actions\/workflows\/ci\.yml\/runs failed; cannot verify release CI: boom/,
    );
  } finally {
    process.env.PATH = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifies a passing run through the injected API exactly once", (t) => {
  const sha = "a".repeat(40);
  const run = {
    id: 7,
    run_number: 7,
    head_sha: sha,
    head_branch: PATCH_BRANCH,
    path: ".github/workflows/ci.yml",
    status: "completed",
    conclusion: "success",
    html_url: "https://example.invalid/run/7",
  };
  const calls = [];
  const log = t.mock.method(console, "log", () => {});

  const selected = requirePassingCi({
    sha,
    repo: "acme/fork",
    api: (apiPath) => {
      calls.push(apiPath);
      return { workflow_runs: [run] };
    },
  });

  assert.equal(selected, run);
  assert.deepEqual(calls, [
    `repos/acme/fork/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=20`,
  ]);
  assert.equal(log.mock.calls.length, 1);
  assert.match(
    log.mock.calls[0].arguments[0],
    new RegExp(`Verified ci\\.yml success for ${sha}: https://example\\.invalid/run/7`),
  );
});

test("aborts once when no run for the commit passed ci.yml", () => {
  const sha = "a".repeat(40);
  const failing = {
    id: 8,
    run_number: 8,
    head_sha: sha,
    head_branch: PATCH_BRANCH,
    path: ".github/workflows/ci.yml",
    status: "completed",
    conclusion: "failure",
    html_url: "https://example.invalid/run/8",
  };
  let calls = 0;

  assert.throws(
    () =>
      requirePassingCi({
        sha,
        repo: "acme/fork",
        api: () => {
          calls += 1;
          return { workflow_runs: [failing] };
        },
      }),
    (error) => {
      assert.match(
        error.message,
        new RegExp(
          `Release aborted: no successful "ci\\.yml" run for ${sha} on ${PATCH_BRANCH}\\.`,
        ),
      );
      assert.match(
        error.message,
        new RegExp(`Runs for this commit: #8 failure \\(${PATCH_BRANCH}\\)`),
      );
      assert.match(error.message, /npm run ci-patch-build/);
      return true;
    },
  );
  assert.equal(calls, 1);
});

function withGitRepo(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-fork-release-"));
  const repo = path.join(root, "source");
  const origin = path.join(root, "origin.git");
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  const remoteTags = () =>
    execFileSync("git", ["--git-dir", origin, "tag", "--list"], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);

  try {
    execFileSync("git", ["init", "--quiet", repo]);
    execFileSync("git", ["init", "--quiet", "--bare", origin]);
    git("config", "user.name", "Release test");
    git("config", "user.email", "release-test@example.invalid");
    git("commit", "--quiet", "--allow-empty", "-m", "initial");
    git("remote", "add", "origin", origin);
    fn({
      repo,
      root,
      git,
      remoteTags,
      commands: {
        captureGit(_command, args) {
          return git(...args);
        },
        runGit(_command, args) {
          git(...args);
        },
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function copyReleaseRuntime(runtime) {
  mkdirSync(path.join(runtime, "scripts/fork/release"), { recursive: true });
  for (const [from, to] of [
    ["../source.mjs", "scripts/fork/source.mjs"],
    ["../github.mjs", "scripts/fork/github.mjs"],
    ["./ci-gate.mjs", "scripts/fork/release/ci-gate.mjs"],
    ["./failure.mjs", "scripts/fork/release/failure.mjs"],
    ["./release.mjs", "scripts/fork/release/release.mjs"],
    ["./launch.mjs", "scripts/fork/release/launch.mjs"],
    ["../../release-fork-desktop.mjs", "scripts/release-fork-desktop.mjs"],
  ]) {
    copyFileSync(new URL(from, import.meta.url), path.join(runtime, to));
  }
}

function ciRun(head, overrides = {}) {
  return {
    id: 1,
    run_number: 1,
    head_sha: head,
    head_branch: PATCH_BRANCH,
    path: ".github/workflows/ci.yml",
    status: "completed",
    conclusion: "success",
    html_url: "https://example.invalid/run/1",
    ...overrides,
  };
}

function runForkDesktop(runtime, root, runs) {
  const bin = path.join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const gh = path.join(bin, "gh");
  writeFileSync(gh, `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify({ workflow_runs: runs })}\nJSON\n`);
  chmodSync(gh, 0o755);
  return spawnSync(
    process.execPath,
    [path.join(runtime, "scripts/release-fork-desktop.mjs"), "--fork-runtime"],
    {
      cwd: runtime,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "acme/fork",
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      },
    },
  );
}

test("desktop or app can publish first and subsequent channels reuse canonical HEAD", () => {
  for (const first of ["desktop", "app"]) {
    withGitRepo(({ git, remoteTags, commands }) => {
      const second = first === "desktop" ? "app" : "desktop";
      const channels = [first, second, "daemon"];
      const head = git("rev-parse", "HEAD");
      for (const channel of channels) {
        const metadata = createForkReleaseMetadata(channel, "0.2.5", 8);
        publish(metadata, commands);
        assert.equal(git("rev-parse", `${metadata.sourceTag}^{commit}`), head);
        assert.equal(git("rev-parse", `${metadata.publicationTag}^{commit}`), head);
        assert.deepEqual(
          remoteTags(),
          [
            ...new Set(
              channels.slice(0, channels.indexOf(channel) + 1).flatMap((name) => {
                const release = createForkReleaseMetadata(name, "0.2.5", 8);
                return [release.sourceTag, release.publicationTag];
              }),
            ),
          ].sort(),
        );
      }
      publish(createForkReleaseMetadata(first, "0.2.5", 8), commands);
      assert.deepEqual(remoteTags(), [
        "app-v0.2.5-fork.8",
        "desktop-v0.2.5-fork.8",
        "v0.2.5-fork.8",
      ]);
    });
  }
});

test("conflicting local source or canonical tag cannot be moved or deleted", () => {
  for (const channel of ["desktop", "app", "daemon"]) {
    for (const conflict of ["sourceTag", "publicationTag"]) {
      withGitRepo(({ git, remoteTags, commands }) => {
        const metadata = createForkReleaseMetadata(channel, "0.2.5", 8);
        const original = git("rev-parse", "HEAD");
        git("tag", metadata[conflict]);
        git("commit", "--quiet", "--allow-empty", "-m", "next commit");
        assert.throws(() => publish(metadata, commands), /already points to .*not HEAD/);
        assert.equal(git("rev-parse", `${metadata[conflict]}^{commit}`), original);
        assert.deepEqual(git("tag", "--list").split("\n"), [metadata[conflict]]);
        assert.deepEqual(remoteTags(), []);
      });
    }
  }
});

test("conflicting remote source or canonical tag prevents any local or remote changes", () => {
  for (const channel of ["desktop", "app", "daemon"]) {
    for (const conflict of ["sourceTag", "publicationTag"]) {
      withGitRepo(({ git, remoteTags, commands }) => {
        const metadata = createForkReleaseMetadata(channel, "0.2.5", 8);
        const original = git("rev-parse", "HEAD");
        git("tag", metadata[conflict]);
        git("push", "origin", metadata[conflict]);
        git("tag", "--delete", metadata[conflict]);
        git("commit", "--quiet", "--allow-empty", "-m", "next commit");
        assert.throws(() => publish(metadata, commands), /Remote release tag .*not HEAD/);
        assert.equal(git("tag", "--list"), "");
        assert.deepEqual(remoteTags(), [metadata[conflict]]);
        assert.equal(
          git("ls-remote", "origin", `refs/tags/${metadata[conflict]}`).split("\t")[0],
          original,
        );
      });
    }
  }
});

test("atomic remote rejection leaves no partial canonical push or new local tags", () => {
  withGitRepo(({ git, remoteTags, commands }) => {
    const metadata = createForkReleaseMetadata("desktop", "0.2.5", 8);
    const original = git("rev-parse", "HEAD");
    git("commit", "--quiet", "--allow-empty", "-m", "next commit");
    const racingCommands = {
      ...commands,
      runGit(command, args) {
        if (args[0] === "push") {
          assert.equal(args[1], "--atomic");
          git("tag", "--force", metadata.sourceTag, original);
          git("push", "origin", metadata.sourceTag);
          git("tag", "--force", metadata.sourceTag, "HEAD");
        }
        commands.runGit(command, args);
      },
    };
    assert.throws(() => publish(metadata, racingCommands));
    assert.equal(git("tag", "--list"), "");
    assert.deepEqual(remoteTags(), [metadata.sourceTag]);
    assert.equal(
      git("ls-remote", "origin", `refs/tags/${metadata.sourceTag}`).split("\t")[0],
      original,
    );
  });
});

test("failed push preserves a preexisting local canonical tag", () => {
  withGitRepo(({ git, remoteTags, commands }) => {
    const metadata = createForkReleaseMetadata("app", "0.2.5", 8);
    const head = git("rev-parse", "HEAD");
    git("tag", metadata.publicationTag);
    const failingCommands = {
      ...commands,
      runGit(command, args) {
        if (args[0] === "push") throw new Error("push rejected");
        commands.runGit(command, args);
      },
    };
    assert.throws(() => publish(metadata, failingCommands), /push rejected/);
    assert.equal(git("rev-parse", `${metadata.publicationTag}^{commit}`), head);
    assert.equal(git("tag", "--list", metadata.sourceTag), "");
    assert.deepEqual(remoteTags(), []);
  });
});

test("daemon publish creates and pushes its canonical source tag", () => {
  withGitRepo(({ git, remoteTags, commands }) => {
    const metadata = createForkReleaseMetadata("daemon", "0.2.5", 8);
    publish(metadata, commands);
    assert.equal(git("rev-parse", `${metadata.publicationTag}^{commit}`), git("rev-parse", "HEAD"));
    assert.deepEqual(remoteTags(), [metadata.publicationTag]);
  });
});

test("release preflight and publication use the pinned version and canonical patch branch from a detached runtime", () => {
  withGitRepo(({ git, repo, root }) => {
    writeFileSync(path.join(repo, "package.json"), JSON.stringify({ version: "0.2.5" }));
    git("add", "package.json");
    const pin = git("commit-tree", git("write-tree"), "-m", "pinned upstream");
    git("tag", "-a", "upstream-fixture", pin, "-m", "pinned upstream");
    mkdirSync(path.join(repo, "scripts/fork/upstream"), { recursive: true });
    writeFileSync(
      path.join(repo, "scripts/fork/upstream/series.json"),
      JSON.stringify({ ref: "refs/tags/upstream-fixture", commit: pin }),
    );
    writeFileSync(path.join(repo, "package.json"), JSON.stringify({ version: "9.9.9" }));
    git("add", "package.json", "scripts/fork/upstream/series.json");
    git("commit", "--quiet", "-m", "downstream source");
    git("branch", "-M", PATCH_BRANCH);
    git("push", "-u", "origin", PATCH_BRANCH);
    const head = git("rev-parse", "HEAD");
    const runtime = path.join(root, "runtime");
    git("worktree", "add", "--detach", runtime, head);
    mkdirSync(path.join(runtime, ".dev"), { recursive: true });
    writeFileSync(
      path.join(runtime, ".dev/fork-build-state.json"),
      JSON.stringify({ sourceRoot: repo, sourceHead: head }),
    );
    writeFileSync(path.join(runtime, "package.json"), JSON.stringify({ version: "8.8.8" }));
    writeFileSync(
      path.join(runtime, "scripts/fork/upstream/series.json"),
      JSON.stringify({ ref: `refs/heads/${PATCH_BRANCH}`, commit: head }),
    );
    copyReleaseRuntime(runtime);
    const result = runForkDesktop(runtime, root, [ciRun(head)]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`Verified ci\\.yml success for ${head}`));
    assert.match(result.stdout, /Desktop Release is now queued/);
    assert.equal(git("rev-parse", "desktop-v0.2.5-fork.1^{commit}"), head);
    assert.equal(git("rev-parse", "v0.2.5-fork.1^{commit}"), head);
    assert.equal(git("branch", "--show-current"), PATCH_BRANCH);
  });
});

test("release preflight aborts before tagging when ci.yml did not pass", () => {
  withGitRepo(({ git, repo, root }) => {
    git("branch", "-M", PATCH_BRANCH);
    git("push", "-u", "origin", PATCH_BRANCH);
    const head = git("rev-parse", "HEAD");
    const runtime = path.join(root, "runtime");
    git("worktree", "add", "--detach", runtime, head);
    mkdirSync(path.join(runtime, ".dev"), { recursive: true });
    writeFileSync(
      path.join(runtime, ".dev/fork-build-state.json"),
      JSON.stringify({ sourceRoot: repo, sourceHead: head }),
    );
    copyReleaseRuntime(runtime);
    const result = runForkDesktop(runtime, root, [ciRun(head, { conclusion: "failure" })]);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      new RegExp(`Release aborted: no successful "ci\\.yml" run for ${head} on ${PATCH_BRANCH}`),
    );
    assert.match(`${result.stdout}\n${result.stderr}`, /npm run ci-patch-build/);
    assert.doesNotMatch(result.stderr, /\bat .*\.mjs:\d+/);
    assert.doesNotMatch(result.stderr, /Node\.js v/);
    assert.equal(git("tag", "--list"), "");
  });
});

test("release preflight reports a dirty worktree without a stack trace", () => {
  withGitRepo(({ git, repo, root }) => {
    git("branch", "-M", PATCH_BRANCH);
    git("push", "-u", "origin", PATCH_BRANCH);
    const head = git("rev-parse", "HEAD");
    const runtime = path.join(root, "runtime");
    git("worktree", "add", "--detach", runtime, head);
    mkdirSync(path.join(runtime, ".dev"), { recursive: true });
    writeFileSync(
      path.join(runtime, ".dev/fork-build-state.json"),
      JSON.stringify({ sourceRoot: repo, sourceHead: head }),
    );
    copyReleaseRuntime(runtime);
    for (let index = 0; index < 12; index += 1) {
      writeFileSync(path.join(repo, `uncommitted-${index}.txt`), "dirty\n");
    }
    const result = runForkDesktop(runtime, root, [ciRun(head)]);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /Fork desktop releases require a clean worktree/);
    assert.equal(result.stderr.match(/^\?\? uncommitted-/gm)?.length, 10);
    assert.match(result.stderr, /… 2 more/);
    assert.match(result.stderr, /Commit or stash these changes, then retry\./);
    assert.doesNotMatch(result.stderr, /\bat .*release\.mjs:\d+/);
    assert.doesNotMatch(result.stderr, /Node\.js v/);
    assert.equal(git("tag", "--list"), "");
  });
});

test("release failures print the message; unexpected errors keep the stack", async (t) => {
  const lines = [];
  t.mock.method(console, "error", (value) => lines.push(value));

  await runRelease(() => {
    failRelease("Fork desktop releases require a clean worktree.");
  });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(lines, ["\nFork desktop releases require a clean worktree."]);

  lines.length = 0;
  process.exitCode = 0;
  const bug = new TypeError("unexpected");
  await runRelease(() => {
    throw bug;
  });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(lines, [bug]);
  process.exitCode = 0;
});

const gateScript = fileURLToPath(new URL("../../fork/release-ci-gate.mjs", import.meta.url));

function runGateCli(root, args, runs) {
  const bin = path.join(root, "gate-bin");
  mkdirSync(bin, { recursive: true });
  const gh = path.join(bin, "gh");
  writeFileSync(gh, `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify({ workflow_runs: runs })}\nJSON\n`);
  chmodSync(gh, 0o755);
  return spawnSync(process.execPath, [gateScript, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REPOSITORY: "",
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    },
  });
}

test("the workflow gate CLI accepts a passing run and rejects every other outcome", () => {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-ci-gate-"));
  try {
    const head = "a".repeat(40);
    const passing = runGateCli(root, ["--sha", head, "--repo", "acme/fork"], [ciRun(head)]);
    assert.equal(passing.status, 0, passing.stderr);
    assert.match(passing.stdout, new RegExp(`Verified ci\\.yml success for ${head}`));

    const failing = runGateCli(
      root,
      ["--sha", head, "--repo", "acme/fork"],
      [ciRun(head, { conclusion: "failure" })],
    );
    assert.equal(failing.status, 1);
    assert.match(failing.stderr, /release-ci-gate: Release aborted/);
    assert.match(failing.stderr, /Runs for this commit: #1 failure/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the workflow gate CLI requires an explicit repository outside Actions", () => {
  const result = spawnSync(process.execPath, [gateScript, "--sha", "b".repeat(40)], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_REPOSITORY: "" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /release-ci-gate: --repo is required outside GitHub Actions/);
});

test("the gate falls back to the REST API when the GitHub CLI is unavailable", () => {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-ci-gate-curl-"));
  try {
    const bin = path.join(root, "curl-bin");
    mkdirSync(bin, { recursive: true });
    const curl = path.join(bin, "curl");
    const head = "c".repeat(40);
    writeFileSync(
      curl,
      `#!/bin/sh\nprintf '%s' '${JSON.stringify({ workflow_runs: [ciRun(head)] })}'\n`,
    );
    chmodSync(curl, 0o755);
    const result = spawnSync(process.execPath, [gateScript, "--sha", head, "--repo", "acme/fork"], {
      encoding: "utf8",
      env: { ...process.env, PATH: bin, GH_TOKEN: "token" },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`Verified ci\\.yml success for ${head}`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
