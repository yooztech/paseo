const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;
const legacyAppTagPattern = /^v(\d+\.\d+\.\d+)-fork\.(\d+)-app$/;
const appTagPattern = /^app-v(\d+\.\d+\.\d+)-fork\.(\d+)$/;
const maxForkNumber = 999;
const maxAndroidVersionCode = 2_100_000_000;

function getForkNumber(releaseTag, appVersion, isBeta) {
  const normalizedReleaseTag = releaseTag ?? "";
  const match =
    appTagPattern.exec(normalizedReleaseTag) ?? legacyAppTagPattern.exec(normalizedReleaseTag);
  if (!match) return null;

  const [, tagVersion, forkText] = match;
  if (isBeta || tagVersion !== appVersion) {
    throw new Error(`App release tag does not match package version: ${releaseTag}`);
  }

  const forkNumber = Number(forkText);
  if (!Number.isSafeInteger(forkNumber) || forkNumber < 1 || forkNumber > maxForkNumber) {
    throw new Error(`Fork release number must be between 1 and ${maxForkNumber}: ${releaseTag}`);
  }
  return forkNumber;
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
  if (betaNumber !== null && (betaNumber < 1 || betaNumber >= maxForkNumber)) {
    throw new Error(`Beta number must be between 1 and ${maxForkNumber - 1}: ${version}`);
  }

  const baseVersionCode = major * 1_000_000 + minor * 1_000 + patch;
  if (!Number.isSafeInteger(baseVersionCode) || baseVersionCode <= 0) {
    throw new Error(`Derived native base version is out of range: ${baseVersionCode}`);
  }

  const appVersion = `${major}.${minor}.${patch}`;
  const forkNumber = getForkNumber(releaseTag, appVersion, betaNumber !== null);
  if (forkNumber !== null) {
    const forkBuildNumber = baseVersionCode * 1_000 + forkNumber;
    if (
      !Number.isSafeInteger(forkBuildNumber) ||
      forkBuildNumber <= 0 ||
      forkBuildNumber > maxAndroidVersionCode
    ) {
      throw new Error(`Derived native build version is out of range: ${forkBuildNumber}`);
    }
    return {
      appVersion,
      androidVersionCode: forkBuildNumber,
      iosBuildNumber: String(forkBuildNumber),
    };
  }

  if (baseVersionCode > maxAndroidVersionCode) {
    throw new Error(`Derived Android versionCode is out of range: ${baseVersionCode}`);
  }
  const iosBuildNumber = baseVersionCode * 1_000 + (betaNumber ?? 0);
  if (!Number.isSafeInteger(iosBuildNumber)) {
    throw new Error(`Derived iOS buildNumber is out of range: ${iosBuildNumber}`);
  }

  return {
    appVersion,
    androidVersionCode: baseVersionCode,
    iosBuildNumber: String(iosBuildNumber),
  };
}

module.exports = { getNativeReleaseVersion };
