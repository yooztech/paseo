import { describe, expect, it } from "vitest";

const {
  FDROID_ABI_VERSION_CODE_SUFFIXES,
  getFdroidVersionCodes,
  getNativeReleaseVersion,
} = require("./native-release-version");

describe("native release version", () => {
  it("uses the base Android version and leaves the fork slots available for iOS", () => {
    expect(getNativeReleaseVersion("0.2.6")).toEqual({
      appVersion: "0.2.6",
      androidVersionCode: 2006,
      iosBuildNumber: "2006000",
    });
  });

  it("gives each beta a unique build slot below stable", () => {
    expect(getNativeReleaseVersion("0.2.6-beta.2")).toEqual({
      appVersion: "0.2.6",
      androidVersionCode: 2006,
      iosBuildNumber: "2006002",
    });
  });

  it("uses the historical base-times-1000 fork build number", () => {
    expect(getNativeReleaseVersion("0.2.6", "app-v0.2.6-fork.2")).toEqual({
      appVersion: "0.2.6",
      androidVersionCode: 2006002,
      iosBuildNumber: "2006002",
    });
  });

  it("preserves the fork.8 build number for 0.3.1", () => {
    expect(getNativeReleaseVersion("0.3.1", "app-v0.3.1-fork.8")).toEqual({
      appVersion: "0.3.1",
      androidVersionCode: 3001008,
      iosBuildNumber: "3001008",
    });
  });

  it("accepts the historical app tag for release retries", () => {
    expect(getNativeReleaseVersion("0.2.6", "v0.2.6-fork.2-app")).toEqual(
      getNativeReleaseVersion("0.2.6", "app-v0.2.6-fork.2"),
    );
  });

  it("rejects beta numbers that consume the stable build slot", () => {
    expect(() => getNativeReleaseVersion("0.2.6-beta.999")).toThrow(
      "Beta number must be between 1 and 998",
    );
  });

  it("rejects an app tag for a different package version", () => {
    expect(() => getNativeReleaseVersion("0.2.6", "app-v0.2.5-fork.2")).toThrow(
      "App release tag does not match package version",
    );
  });

  it("checks the final Android versionCode limit", () => {
    expect(() => getNativeReleaseVersion("2.101.0", "app-v2.101.0-fork.999")).toThrow(
      "Derived native build version is out of range: 2101000999",
    );
  });

  it("derives one F-Droid version code per published ABI", () => {
    expect(FDROID_ABI_VERSION_CODE_SUFFIXES).toEqual({
      "armeabi-v7a": 1,
      "arm64-v8a": 2,
      x86: 3,
      x86_64: 4,
    });
    expect(getFdroidVersionCodes("0.5.0")).toEqual([
      { abi: "armeabi-v7a", versionCode: 50001 },
      { abi: "arm64-v8a", versionCode: 50002 },
      { abi: "x86", versionCode: 50003 },
      { abi: "x86_64", versionCode: 50004 },
    ]);
  });
});
