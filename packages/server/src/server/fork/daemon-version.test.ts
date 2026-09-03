import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveDaemonVersion } from "./daemon-version.js";

const createdDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-daemon-version-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveDaemonVersion", () => {
  it("resolves a fork version from the most recent daemon release tag", () => {
    const root = createTempDir();
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@getpaseo/server", version: "9.8.7" }),
      "utf8",
    );
    const nestedDir = path.join(root, "dist", "server");
    mkdirSync(nestedDir, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "package.json"], { cwd: root });
    execFileSync(
      "git",
      ["-c", "user.name=Paseo Test", "-c", "user.email=test@paseo.local", "commit", "-qm", "test"],
      { cwd: root },
    );
    execFileSync("git", ["tag", "v9.8.7-fork.4"], { cwd: root });
    writeFileSync(path.join(root, "post-release.txt"), "next commit", "utf8");
    execFileSync("git", ["add", "post-release.txt"], { cwd: root });
    execFileSync(
      "git",
      ["-c", "user.name=Paseo Test", "-c", "user.email=test@paseo.local", "commit", "-qm", "next"],
      { cwd: root },
    );

    const moduleUrl = pathToFileURL(path.join(nestedDir, "index.js")).href;
    expect(resolveDaemonVersion(moduleUrl)).toBe("9.8.7-fork.4");
  });
});
