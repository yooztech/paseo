import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  DaemonVersionResolutionError,
  resolveDaemonVersion as resolveUpstreamDaemonVersion,
} from "../daemon-version.js";
export { DaemonVersionResolutionError };
const RELEASE_TAG_PATTERN = /^v(?<version>\d+\.\d+\.\d+(?:-beta\.\d+)?-fork\.\d+)$/;
const execFileAsync = promisify(execFile);

async function resolveCheckoutVersion(moduleUrl: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["describe", "--tags", "--match", "v[0-9]*-fork.*", "--abbrev=0", "HEAD"],
      {
        cwd: path.dirname(fileURLToPath(moduleUrl)),
        encoding: "utf8",
      },
    );
    return RELEASE_TAG_PATTERN.exec(stdout.trim())?.groups?.version ?? null;
  } catch {
    return null;
  }
}

export async function resolveDaemonVersion(moduleUrl: string = import.meta.url): Promise<string> {
  const packageVersion = resolveUpstreamDaemonVersion(moduleUrl);
  const checkoutVersion = await resolveCheckoutVersion(moduleUrl);
  // A previous fork release tag must not override the version of a newly upgraded checkout.
  return checkoutVersion?.startsWith(`${packageVersion}-fork.`) ? checkoutVersion : packageVersion;
}
