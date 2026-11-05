import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PATCH_BRANCH } from "../source.mjs";
import {
  createForkReleaseMetadata,
  getForkNumber,
  getForkReleaseNumber,
  publish,
} from "./release.mjs";

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
    mkdirSync(path.join(runtime, "scripts/fork/release"), { recursive: true });
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
    copyFileSync(
      new URL("../source.mjs", import.meta.url),
      path.join(runtime, "scripts/fork/source.mjs"),
    );
    copyFileSync(
      new URL("./release.mjs", import.meta.url),
      path.join(runtime, "scripts/fork/release/release.mjs"),
    );
    copyFileSync(
      new URL("../../trigger-fork-app-eas.mjs", import.meta.url),
      path.join(runtime, "scripts/trigger-fork-app-eas.mjs"),
    );
    copyFileSync(
      new URL("./launch.mjs", import.meta.url),
      path.join(runtime, "scripts/fork/release/launch.mjs"),
    );
    copyFileSync(
      new URL("../../release-fork-desktop.mjs", import.meta.url),
      path.join(runtime, "scripts/release-fork-desktop.mjs"),
    );
    execFileSync(
      process.execPath,
      [path.join(runtime, "scripts/release-fork-desktop.mjs"), "--fork-runtime"],
      { cwd: runtime },
    );
    assert.equal(git("rev-parse", "desktop-v0.2.5-fork.1^{commit}"), head);
    assert.equal(git("rev-parse", "v0.2.5-fork.1^{commit}"), head);
    assert.equal(git("branch", "--show-current"), PATCH_BRANCH);
  });
});
