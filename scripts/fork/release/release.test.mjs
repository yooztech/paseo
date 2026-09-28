import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createForkReleaseMetadata,
  getForkNumber,
  getForkReleaseNumber,
  publish,
} from "./release.mjs";

test("creates channel-specific fork release metadata", () => {
  assert.deepEqual(createForkReleaseMetadata("daemon", "0.2.5", 8), {
    channel: "daemon",
    sourceTag: "v0.2.5-fork.8",
    publicationTag: "v0.2.5-fork.8",
    changelogVersion: "0.2.5",
    version: "0.2.5-fork.8",
    forkNumber: 8,
  });
  assert.deepEqual(createForkReleaseMetadata("desktop", "0.2.5", 9), {
    channel: "desktop",
    sourceTag: "desktop-v0.2.5-fork.9",
    publicationTag: "v0.2.5-fork.9",
    changelogVersion: "0.2.5",
    version: "0.2.5-fork.9",
    forkNumber: 9,
  });
  assert.deepEqual(createForkReleaseMetadata("app", "0.2.5", 10), {
    channel: "app",
    sourceTag: "app-v0.2.5-fork.10",
    publicationTag: "v0.2.5-fork.10",
    changelogVersion: "0.2.5",
    version: "0.2.5-fork.10",
    forkNumber: 10,
  });
});

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

test("desktop and app push only their source tags when canonical tag is at HEAD", () => {
  for (const channel of ["desktop", "app"]) {
    withGitRepo(({ git, remoteTags, commands }) => {
      const metadata = createForkReleaseMetadata(channel, "0.2.5", 8);
      git("tag", metadata.publicationTag);

      publish(metadata, commands);

      assert.equal(git("rev-parse", `${metadata.sourceTag}^{commit}`), git("rev-parse", "HEAD"));
      assert.deepEqual(remoteTags(), [metadata.sourceTag]);
    });
  }
});

test("desktop and app reject missing or mismatched canonical tags without creating source tags", () => {
  for (const channel of ["desktop", "app"]) {
    withGitRepo(({ git, remoteTags, commands }) => {
      const metadata = createForkReleaseMetadata(channel, "0.2.5", 8);
      assert.throws(
        () => publish(metadata, commands),
        /must already exist at HEAD.*daemon channel first/,
      );
      assert.equal(git("tag", "--list", metadata.sourceTag), "");
      assert.deepEqual(remoteTags(), []);

      git("tag", metadata.publicationTag);
      git("commit", "--quiet", "--allow-empty", "-m", "later commit");
      assert.throws(() => publish(metadata, commands), /not HEAD.*new fork release number/);
      assert.equal(git("tag", "--list", metadata.sourceTag), "");
      assert.deepEqual(remoteTags(), []);
    });
  }
});

test("daemon publish creates and pushes its canonical source tag", () => {
  withGitRepo(({ git, remoteTags, commands }) => {
    const metadata = createForkReleaseMetadata("daemon", "0.2.5", 8);
    publish(metadata, commands);
    assert.equal(git("rev-parse", `${metadata.publicationTag}^{commit}`), git("rev-parse", "HEAD"));
    assert.deepEqual(remoteTags(), [metadata.publicationTag]);
  });
});
