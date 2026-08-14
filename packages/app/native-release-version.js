const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;
const legacyAppTagPattern = /^v(\d+\.\d+\.\d+)-fork\.(\d+)-app$/;
const appTagPattern = /^app-v(\d+\.\d+\.\d+)-fork\.(\d+)$/;
const stableBuildSlot = 999;
const buildSlotsPerVersion = 2_000;
const maxAndroidVersionCode = 2_100_000_000;

function getForkBuildSlot(releaseTag, appVersion, isBeta) {
  const normalizedReleaseTag = releaseTag ?? "";
  const match =
    appTagPattern.exec(normalizedReleaseTag) ?? legacyAppTagPattern.exec(normalizedReleaseTag);
  if (!match) return null;

  const [, tagVersion, forkText] = match;
  if (isBeta || tagVersion !== appVersion) {
    throw new Error(`App release tag does not match package version: ${releaseTag}`);
  }

  const forkNumber = Number(forkText);
  if (!Number.isSafeInteger(forkNumber) || forkNumber < 1 || forkNumber > 999) {
    throw new Error(`Fork release number must be between 1 and 999: ${releaseTag}`);
  }
  return stableBuildSlot + forkNumber;
}

function getNativeReleaseVersion(version, releaseTag) {
  const match = versionPattern.exec(version);
  if (!match) {
    throw new Error(`Cannot derive native release version from unsupported version: ${version}`);
  }

  const [, majorText, minorText, patchText, betaText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  const betaNumber = betaText === undefined ? null : Number(betaText);

  if (minor > 999 || patch > 999) {
    throw new Error(`Cannot derive collision-free native version from: ${version}`);
  }
  if (betaNumber !== null && (betaNumber < 1 || betaNumber >= stableBuildSlot)) {
    throw new Error(`Beta number must be between 1 and 998: ${version}`);
  }

  const baseVersionCode = major * 1_000_000 + minor * 1_000 + patch;
  if (!Number.isSafeInteger(baseVersionCode) || baseVersionCode <= 0) {
    throw new Error(`Derived native base version is out of range: ${baseVersionCode}`);
  }

  const appVersion = `${major}.${minor}.${patch}`;
  const buildSlot =
    getForkBuildSlot(releaseTag, appVersion, betaNumber !== null) ?? betaNumber ?? stableBuildSlot;

  const buildNumber = baseVersionCode * buildSlotsPerVersion + buildSlot;
  if (!Number.isSafeInteger(buildNumber) || buildNumber > maxAndroidVersionCode) {
    throw new Error(`Derived Android versionCode is out of range: ${buildNumber}`);
  }

  return {
    appVersion,
    androidVersionCode: buildNumber,
    iosBuildNumber: String(buildNumber),
  };
}

module.exports = { getNativeReleaseVersion };
