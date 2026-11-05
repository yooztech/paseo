import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
import { PATCH_BRANCH, readPinnedPackage } from "./fork/source.mjs";
import { launchInForkRuntime } from "./fork/release/launch.mjs";

const runtimeRoot = fileURLToPath(new URL("..", import.meta.url));
let state;
try {
  state = JSON.parse(readFileSync(path.join(runtimeRoot, ".dev/fork-build-state.json"), "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const root = state?.sourceRoot ?? runtimeRoot;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: options.env ?? process.env,
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

export function triggerForkAppEas() {
  if (!state) throw new Error("Fork app EAS builds require a managed fork runtime.");
  const initialHead = capture("git", ["rev-parse", "HEAD"]);
  if (initialHead !== state.sourceHead) {
    throw new Error("Canonical source HEAD changed since the fork build was materialized.");
  }
  const appDir = path.join(runtimeRoot, "packages/app");
  const require = createRequire(path.join(appDir, "app.config.js"));
  const { expo: exp } = require("./app.config.js");
  if (
    exp.extra?.eas?.projectId !== "fbf5a457-e6af-4dce-a36e-6b79b413f734" ||
    exp.ios?.bundleIdentifier !== "com.yooztech.paseo"
  ) {
    throw new Error(
      "Effective app configuration does not identify the fork production EAS project and bundle.",
    );
  }
  const branch = capture("git", ["branch", "--show-current"]);
  if (branch !== PATCH_BRANCH) {
    throw new Error(
      `Fork app EAS builds must run from ${PATCH_BRANCH}, got ${branch || "detached HEAD"}.`,
    );
  }
  if (capture("git", ["status", "--porcelain"])) {
    throw new Error("Fork app EAS builds require a clean worktree.");
  }

  run("git", ["fetch", "origin", PATCH_BRANCH, "--tags"]);
  const head = capture("git", ["rev-parse", "HEAD"]);
  if (head !== initialHead) {
    throw new Error("Canonical source HEAD changed while preparing the EAS workflow.");
  }
  if (head !== capture("git", ["rev-parse", `origin/${PATCH_BRANCH}`])) {
    throw new Error(
      `HEAD must match origin/${PATCH_BRANCH} before triggering a fork app EAS build.`,
    );
  }

  const { version } = readPinnedPackage(root);
  const currentTags = capture("git", ["tag", "--points-at", "HEAD"]).split("\n").filter(Boolean);
  const releaseTag = selectAppReleaseTag(currentTags, version);
  const remoteTag = capture("git", [
    "ls-remote",
    "--tags",
    "origin",
    `refs/tags/${releaseTag}`,
    `refs/tags/${releaseTag}^{}`,
  ]);
  const refs = new Map(
    remoteTag
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(/\s+/).reverse()),
  );
  if ((refs.get(`refs/tags/${releaseTag}^{}`) ?? refs.get(`refs/tags/${releaseTag}`)) !== head) {
    throw new Error(`Remote app release tag ${releaseTag} does not point to ${head}.`);
  }

  console.log(`Starting EAS workflow for ${releaseTag} (${head}).`);
  run(
    "npx",
    [
      "--yes",
      "eas-cli@27.4.1",
      "workflow:run",
      ".eas/workflows/release-mobile.yml",
      "--ref",
      head,
      "-F",
      `release_tag=${releaseTag}`,
      "-F",
      `source_commit=${head}`,
      "--non-interactive",
    ],
    { cwd: appDir },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--fork-runtime") {
    await launchInForkRuntime("scripts/trigger-fork-app-eas.mjs");
  } else {
    triggerForkAppEas();
  }
}
