import assert from "node:assert/strict";
import test from "node:test";
import { createForkReleaseMetadata, getForkNumber, getNextForkNumber } from "./release.mjs";

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
  assert.equal(createForkReleaseMetadata("app", "0.2.5", 10).sourceTag, "app-v0.2.5-fork.10");
});

test("scans all current channel tags and the historical app format", () => {
  const tags = [
    "v0.2.5-fork.2",
    "desktop-v0.2.5-fork.4",
    "app-v0.2.5-fork.6",
    "v0.2.5-fork.11-app",
    "desktop-macos-v0.2.5-fork.7",
    "v0.2.6-fork.99",
    "unrelated",
  ];
  assert.equal(getNextForkNumber(tags, "0.2.5"), 12);
  assert.equal(getForkNumber("v0.2.5-fork.11-app", "0.2.5"), 11);
  assert.equal(getForkNumber("unrelated", "0.2.5"), null);
});
