import { getReleaseInfoFromSourceTag } from "./release-version-utils.mjs";
import { execFileSync } from "node:child_process";

function usageAndExit(code = 1) {
  process.stderr.write(
    `Usage: node scripts/emit-release-env.mjs --source-tag <tag> [--verify-checkout]\n`,
  );
  process.exit(code);
}

function parseArgs(argv) {
  let sourceTag = "";
  let verifyCheckout = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-tag") {
      sourceTag = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usageAndExit(0);
    }
    if (arg === "--verify-checkout") {
      verifyCheckout = true;
      continue;
    }
    usageAndExit();
  }

  if (!sourceTag) {
    usageAndExit();
  }

  return { sourceTag, verifyCheckout };
}

const { sourceTag, verifyCheckout } = parseArgs(process.argv.slice(2));
const info = getReleaseInfoFromSourceTag(sourceTag);

if (verifyCheckout) {
  const resolve = (ref) =>
    execFileSync("git", ["rev-parse", `${ref}^{commit}`], { encoding: "utf8" }).trim();
  const sourceSha = resolve(info.sourceTag);
  const publicationSha = resolve(info.publicationTag);
  const checkoutSha = resolve("HEAD");
  if (sourceSha !== publicationSha || sourceSha !== checkoutSha) {
    throw new Error(
      `Release refs must resolve to one commit: source=${sourceSha}, publication=${publicationSha}, checkout=${checkoutSha}`,
    );
  }
}

const entries = [
  ["SOURCE_TAG", info.sourceTag],
  ["PUBLICATION_TAG", info.publicationTag],
  ["CHANGELOG_VERSION", info.changelogVersion],
  ["RELEASE_TAG", info.releaseTag],
  ["RELEASE_VERSION", info.version],
  ["RELEASE_BASE_VERSION", info.baseVersion],
  ["RELEASE_PRERELEASE", info.prerelease ?? ""],
  ["IS_PRERELEASE", info.isPrerelease ? "true" : "false"],
  ["IS_BETA", info.isBeta ? "true" : "false"],
  ["RELEASE_TYPE", info.releaseType],
  ["RELEASE_CHANNEL", info.releaseChannel],
  ["DESKTOP_VERSION", info.version],
  ["IS_SMOKE_TAG", info.isSmokeTag ? "true" : "false"],
];

for (const [key, value] of entries) {
  process.stdout.write(`${key}=${value}\n`);
}
