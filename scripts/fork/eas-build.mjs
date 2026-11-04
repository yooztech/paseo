#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = path.join(root, "packages/app");
const projectId = "fbf5a457-e6af-4dce-a36e-6b79b413f734";
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const git = (...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

try {
  assert(
    process.env.CI === "1" && process.env.EAS_BUILD_PROJECT_ID === projectId,
    "Release bootstrap requires the fork Expo Workflows CI environment",
  );
  assert(process.env.APP_VARIANT === "production", "APP_VARIANT must be production");
  const source = process.env.PASEO_SOURCE_COMMIT ?? "";
  assert(
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(source),
    "PASEO_SOURCE_COMMIT must be a full Git commit SHA",
  );
  assert(git("rev-parse", "HEAD") === source, "Checkout HEAD does not match PASEO_SOURCE_COMMIT");
  const version = readJson(path.join(root, "package.json")).version;
  const tag = process.env.PASEO_RELEASE_TAG ?? "";
  const match = /^app-v(\d+\.\d+\.\d+)-fork\.([1-9]\d{0,2})$/.exec(tag);
  assert(
    match && match[1] === version,
    "PASEO_RELEASE_TAG must match the root version and fork slot 1..999",
  );
  const ref = `refs/tags/${tag}`;
  // EAS performs a depth-one, no-tags checkout; verify against its authenticated
  // origin rather than trusting any locally synthesized tag ref.
  const refs = git("ls-remote", "--tags", "origin", ref, `${ref}^{}`)
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(/\s+/));
  const tagCommit =
    refs.find(([, name]) => name === `${ref}^{}`)?.[0] ??
    refs.find(([, name]) => name === ref)?.[0];
  assert(tagCommit === source, "Release tag does not resolve to the source commit");

  const applied = spawnSync(
    process.execPath,
    [path.join(root, "scripts/fork/upstream.mjs"), "ci-apply"],
    {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    },
  );
  if (applied.error) throw applied.error;
  assert(applied.status === 0, "Failed to apply fork patches");

  const eas = readJson(path.join(app, "eas.json"));
  assert(eas.cli?.appVersionSource === "local", "EAS app version source must be local");
  assert(eas.submit?.production?.ios?.ascAppId === "6797142550", "Wrong App Store Connect app ID");

  const configFile = path.join(app, "app.config.js");
  const require = createRequire(configFile);
  const config = require(configFile).expo;
  const [major, minor, patch] = version.split(".").map(Number);
  const slot = (major * 1_000_000 + minor * 1_000 + patch) * 1_000 + Number(match[2]);
  assert(Number.isSafeInteger(slot) && slot > 0, "Invalid native build slot");
  assert(config?.extra?.eas?.projectId === projectId, "Wrong Expo project ID");
  assert(config?.ios?.bundleIdentifier === "com.yooztech.paseo", "Wrong iOS bundle identifier");
  assert(
    config?.version === version &&
      config?.ios?.buildNumber === String(slot) &&
      config?.android?.versionCode === slot,
    "App version or native build numbers do not match the release tag",
  );
  console.log(`Prepared ${tag} at ${source} for Expo release`);
} catch (error) {
  console.error(`EAS release bootstrap: ${error.message}`);
  process.exitCode = 1;
}
