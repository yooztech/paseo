import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DaemonVersionResolutionError,
  resolveDaemonVersion as resolveUpstreamDaemonVersion,
} from "../daemon-version.js";
export { DaemonVersionResolutionError };
const RELEASE_TAG_PATTERN = /^v(?<version>\d+\.\d+\.\d+(?:-(?:beta|fork)\.\d+)?)$/;

function resolveCheckoutVersion(moduleUrl: string): string | null {
  try {
    const tag = execFileSync(
      "git",
      ["describe", "--tags", "--match", "v[0-9]*", "--abbrev=0", "HEAD"],
      {
        cwd: path.dirname(fileURLToPath(moduleUrl)),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return RELEASE_TAG_PATTERN.exec(tag)?.groups?.version ?? null;
  } catch {
    return null;
  }
}

export function resolveDaemonVersion(moduleUrl: string = import.meta.url): string {
  const checkoutVersion = resolveCheckoutVersion(moduleUrl);
  if (checkoutVersion) {
    return checkoutVersion;
  }

  return resolveUpstreamDaemonVersion(moduleUrl);
}
