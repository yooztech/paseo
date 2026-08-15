import assert from "node:assert/strict";
import test from "node:test";
import { selectAppReleaseTag } from "./trigger-fork-app-eas.mjs";

test("selects the current commit app release tag", () => {
  assert.equal(
    selectAppReleaseTag(["desktop-v0.3.1-fork.8", "v0.3.1-fork.8", "app-v0.3.1-fork.8"], "0.3.1"),
    "app-v0.3.1-fork.8",
  );
});

test("requires exactly one app release tag", () => {
  assert.throws(() => selectAppReleaseTag(["v0.3.1-fork.8"], "0.3.1"), /found: none/);
  assert.throws(
    () => selectAppReleaseTag(["app-v0.3.1-fork.8", "app-v0.3.1-fork.9"], "0.3.1"),
    /found: app-v0.3.1-fork.8, app-v0.3.1-fork.9/,
  );
});
