import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
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

export function getForkNumber(tag, version) {
  const base = `v${escapeRegExp(version)}-fork\\.(\\d+)`;
  const match = tag.match(
    new RegExp(
      `^(?:${base}|desktop(?:-(?:windows|linux|macos))?-${base}|app-${base}|${base}-app)$`,
    ),
  );
  if (!match) return null;
  return Number(match[1] ?? match[2] ?? match[3] ?? match[4]);
}

export function getForkReleaseNumber(tags, currentTags, version) {
  const currentNumbers = [
    ...new Set(
      currentTags.map((tag) => getForkNumber(tag, version)).filter((number) => number !== null),
    ),
  ];
  if (currentNumbers.length > 1) {
    throw new Error(
      `Current commit has conflicting fork release numbers: ${currentNumbers.join(", ")}.`,
    );
  }
  if (currentNumbers.length === 1) return currentNumbers[0];

  const numbers = tags
    .map((tag) => getForkNumber(tag, version))
    .filter((number) => number !== null);
  return Math.max(0, ...numbers) + 1;
}

export function createForkReleaseMetadata(channel, version, forkNumber) {
  if (!new Set(["daemon", "desktop", "app"]).has(channel)) {
    throw new Error(`Unsupported fork release channel "${channel}".`);
  }

  const versionTag = `v${version}-fork.${forkNumber}`;
  const sourceTag = `${{ daemon: "", desktop: "desktop-", app: "app-" }[channel]}${versionTag}`;

  return {
    channel,
    sourceTag,
    publicationTag: versionTag,
    changelogVersion: version,
    version: `${version}-fork.${forkNumber}`,
    forkNumber,
  };
}

function preflight(channel) {
  const label = channel === "daemon" ? "fork" : `fork ${channel}`;
  const branch = capture("git", ["branch", "--show-current"]);
  if (branch !== "main") {
    throw new Error(
      `${label[0].toUpperCase()}${label.slice(1)} releases must run from main, got ${branch || "detached HEAD"}.`,
    );
  }
  if (capture("git", ["status", "--porcelain"])) {
    throw new Error(
      `${label[0].toUpperCase()}${label.slice(1)} releases require a clean worktree.`,
    );
  }

  run("git", ["fetch", "origin", "main", "--tags"]);
  if (capture("git", ["rev-parse", "HEAD"]) !== capture("git", ["rev-parse", "origin/main"])) {
    throw new Error(`HEAD must match origin/main before creating a ${label} release.`);
  }

  const { version } = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
  );
  const tags = capture("git", ["tag", "--list"]).split("\n").filter(Boolean);
  const currentTags = capture("git", ["tag", "--points-at", "HEAD"]).split("\n").filter(Boolean);
  return createForkReleaseMetadata(
    channel,
    version,
    getForkReleaseNumber(tags, currentTags, version),
  );
}

export function publish(metadata, { captureGit = capture, runGit = run } = {}) {
  const tags = [...new Set([metadata.sourceTag, metadata.publicationTag])];
  const head = captureGit("git", ["rev-parse", "HEAD"]);
  const remoteRefs = tags.flatMap((tag) => [`refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  const remoteOutput = captureGit("git", ["ls-remote", "--tags", "origin", ...remoteRefs]);
  const remoteTags = new Map(
    remoteOutput
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [object, ref] = line.split("\t");
        return [ref, object];
      }),
  );
  const missingLocal = [];
  const missingRemote = [];

  // Validate every ref before creating either tag or updating the remote.
  for (const tag of tags) {
    const local = captureGit("git", ["tag", "--list", tag]);
    if (local) {
      const commit = captureGit("git", ["rev-parse", `${tag}^{commit}`]);
      if (commit !== head) {
        throw new Error(`Release tag ${tag} already points to ${commit}, not HEAD (${head}).`);
      }
    } else {
      missingLocal.push(tag);
    }

    const remoteRef = `refs/tags/${tag}`;
    if (remoteTags.has(remoteRef)) {
      const commit = remoteTags.get(`${remoteRef}^{}`) ?? remoteTags.get(remoteRef);
      if (commit !== head) {
        throw new Error(
          `Remote release tag ${tag} already points to ${commit}, not HEAD (${head}).`,
        );
      }
    } else {
      missingRemote.push(tag);
    }
  }

  const created = [];
  try {
    for (const tag of missingLocal) {
      runGit("git", ["tag", tag]);
      created.push(tag);
    }
    if (missingRemote.length) {
      runGit("git", [
        "push",
        "--atomic",
        "origin",
        ...missingRemote.map((tag) => `refs/tags/${tag}:refs/tags/${tag}`),
      ]);
    }
  } catch (error) {
    for (const tag of created) runGit("git", ["tag", "--delete", tag]);
    throw error;
  }
}

export function releaseForkDaemon() {
  const metadata = preflight("daemon");
  console.log("Installing locked release dependencies...");
  run("npm", ["ci", "--loglevel=error", "--no-audit", "--no-fund"]);
  console.log(`Building server for ${metadata.sourceTag}...`);
  run("npm", ["run", "build:server"]);
  publish(metadata);
  console.log(`Published ${metadata.sourceTag}. Restarting paseo.service...`);
  run("systemctl", ["--user", "restart", "paseo.service"]);
  console.log(`${metadata.sourceTag} published and paseo.service restarted.`);
}

export function releaseForkDesktop() {
  const metadata = preflight("desktop");
  publish(metadata);
  console.log(`Published ${metadata.sourceTag}. Desktop Release is now queued.`);
}

export function releaseForkApp() {
  const metadata = preflight("app");
  publish(metadata);
  console.log(
    `Published ${metadata.sourceTag}. EAS iOS build and TestFlight upload are now queued.`,
  );
}
