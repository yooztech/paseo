import assert from "node:assert/strict";
import test from "node:test";
import {
  computeNextReleaseVersion,
  getReleaseInfoFromSourceTag,
  parseReleaseVersion,
} from "./release-version-utils.mjs";

test("computes the next beta patch from a stable version", () => {
  assert.equal(computeNextReleaseVersion("0.1.59", "beta-patch"), "0.1.60-beta.1");
});

test("advances beta versions", () => {
  assert.equal(computeNextReleaseVersion("0.1.60-beta.1", "beta-next"), "0.1.60-beta.2");
});

test("promotes beta versions to stable", () => {
  assert.equal(computeNextReleaseVersion("0.1.60-beta.2", "promote"), "0.1.60");
});

test("parses beta release metadata", () => {
  assert.deepEqual(parseReleaseVersion("0.1.60-beta.1"), {
    version: "0.1.60-beta.1",
    major: 0,
    minor: 1,
    patch: 60,
    prerelease: "beta.1",
    baseVersion: "0.1.60",
    isPrerelease: true,
    isBeta: true,
    betaNumber: 1,
  });
});

test("emits beta release info from tags", () => {
  assert.deepEqual(getReleaseInfoFromSourceTag("v0.1.60-beta.1"), {
    sourceTag: "v0.1.60-beta.1",
    publicationTag: "v0.1.60-beta.1",
    changelogVersion: "0.1.60-beta.1",
    releaseTag: "v0.1.60-beta.1",
    version: "0.1.60-beta.1",
    baseVersion: "0.1.60",
    prerelease: "beta.1",
    isPrerelease: true,
    isBeta: true,
    betaNumber: 1,
    releaseType: "prerelease",
    releaseChannel: "beta",
    isSmokeTag: false,
  });
});

test("emits fork release info from desktop tags", () => {
  assert.deepEqual(getReleaseInfoFromSourceTag("desktop-macos-v0.2.5-fork.1"), {
    sourceTag: "desktop-macos-v0.2.5-fork.1",
    publicationTag: "v0.2.5-fork.1",
    changelogVersion: "0.2.5",
    releaseTag: "v0.2.5-fork.1",
    version: "0.2.5-fork.1",
    baseVersion: "0.2.5",
    prerelease: "fork.1",
    isPrerelease: true,
    isBeta: false,
    betaNumber: null,
    releaseType: "prerelease",
    releaseChannel: "fork",
    isSmokeTag: false,
  });
});

test("normalizes current and historical app release tags", () => {
  assert.deepEqual(getReleaseInfoFromSourceTag("app-v0.2.5-fork.3"), {
    sourceTag: "app-v0.2.5-fork.3",
    publicationTag: "app-v0.2.5-fork.3",
    changelogVersion: "0.2.5",
    releaseTag: "v0.2.5-fork.3",
    version: "0.2.5-fork.3",
    baseVersion: "0.2.5",
    prerelease: "fork.3",
    isPrerelease: true,
    isBeta: false,
    betaNumber: null,
    releaseType: "prerelease",
    releaseChannel: "fork",
    isSmokeTag: false,
  });
  assert.equal(
    getReleaseInfoFromSourceTag("v0.2.5-fork.2-app").publicationTag,
    "v0.2.5-fork.2-app",
  );
});

test("rejects unsupported prerelease versions", () => {
  assert.throws(() => parseReleaseVersion("0.1.60-canary.1"), /Expected prerelease versions/);
});
