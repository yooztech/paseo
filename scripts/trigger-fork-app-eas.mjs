import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  })?.trim();
}

function capture(command, args) {
  return run(command, args, { capture: true });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function selectAppReleaseTag(tags, version) {
  const pattern = new RegExp(`^app-v${escapeRegExp(version)}-fork\\.\\d+$`);
  const matches = tags.filter((tag) => pattern.test(tag));
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one app release tag for v${version} on the current commit, found: ${matches.join(", ") || "none"}.`,
    );
  }
  return matches[0];
}

function triggerForkAppEas() {
  const branch = capture("git", ["branch", "--show-current"]);
  if (branch !== "main") {
    throw new Error(`Fork app EAS builds must run from main, got ${branch || "detached HEAD"}.`);
  }
  if (capture("git", ["status", "--porcelain"])) {
    throw new Error("Fork app EAS builds require a clean worktree.");
  }

  run("git", ["fetch", "origin", "main", "--tags"]);
  const head = capture("git", ["rev-parse", "HEAD"]);
  if (head !== capture("git", ["rev-parse", "origin/main"])) {
    throw new Error("HEAD must match origin/main before triggering a fork app EAS build.");
  }

  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const currentTags = capture("git", ["tag", "--points-at", "HEAD"]).split("\n").filter(Boolean);
  const releaseTag = selectAppReleaseTag(currentTags, version);
  const remoteTag = capture("git", ["ls-remote", "--tags", "origin", `refs/tags/${releaseTag}`]);
  if (remoteTag.split(/\s+/, 1)[0] !== head) {
    throw new Error(`Remote app release tag ${releaseTag} does not point to ${head}.`);
  }

  run(
    "npx",
    [
      "eas",
      "workflow:run",
      ".eas/workflows/release-mobile.yml",
      "--ref",
      releaseTag,
      "--input",
      `release_tag=${releaseTag}`,
      "--non-interactive",
    ],
    { cwd: new URL("../packages/app", import.meta.url) },
  );
  console.log(`Triggered EAS iOS release workflow for ${releaseTag}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  triggerForkAppEas();
}
