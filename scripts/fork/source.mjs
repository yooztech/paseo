import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export const PATCH_BRANCH = "downstream/patch-build";
export const CONTROL_FILES = new Set([
  "package.json",
  "package-lock.json",
  ".gitignore",
  "lefthook.yml",
  ".oxfmtrc.json",
  ".oxlintrc.json",
  "packages/app/package.json",
]);
export function isControlFile(name) {
  return CONTROL_FILES.has(name);
}

export async function fetchLatestReleaseTag(fetcher = fetch) {
  const response = await fetcher("https://api.github.com/repos/getpaseo/paseo/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok)
    throw new Error(`Cannot fetch latest official release: HTTP ${response.status}`);
  const release = await response.json();
  if (
    !release ||
    release.draft ||
    release.prerelease ||
    typeof release.tag_name !== "string" ||
    !release.tag_name.trim()
  )
    throw new Error("Latest official release must be stable and have a tag_name");
  return release.tag_name;
}

export function readPinnedPackage(directory) {
  const manifest = JSON.parse(
    readFileSync(path.join(directory, "scripts/fork/upstream/series.json"), "utf8"),
  );
  if (
    typeof manifest.ref !== "string" ||
    !manifest.ref ||
    typeof manifest.commit !== "string" ||
    !/^[0-9a-f]{40,64}$/.test(manifest.commit)
  ) {
    throw new Error("Invalid upstream pin in scripts/fork/upstream/series.json");
  }
  try {
    const resolved = execFileSync("git", ["rev-parse", "--verify", `${manifest.ref}^{commit}`], {
      cwd: directory,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (resolved !== manifest.commit)
      throw new Error(
        `Pinned upstream ref ${manifest.ref} moved: expected ${manifest.commit}, got ${resolved}`,
      );
  } catch (error) {
    if (error.message.startsWith("Pinned upstream ref")) throw error;
  }
  let content;
  try {
    content = execFileSync("git", ["show", `${manifest.commit}:package.json`], {
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(
      `Cannot read package.json from pinned upstream object ${manifest.commit}; fetch the pinned object with fork check first`,
      { cause: error },
    );
  }
  return JSON.parse(content.toString());
}
