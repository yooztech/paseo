import { describe, expect, it } from "vitest";

const { getNativeReleaseVersion } = require("./native-release-version");

describe("native release version", () => {
  it("uses the stable build slot on both platforms", () => {
    expect(getNativeReleaseVersion("0.2.6")).toEqual({
      appVersion: "0.2.6",
      androidVersionCode: 4012999,
      iosBuildNumber: "4012999",
    });
  });

  it("gives each beta a unique build slot below stable", () => {
    expect(getNativeReleaseVersion("0.2.6-beta.2")).toEqual({
      appVersion: "0.2.6",
      androidVersionCode: 4012002,
      iosBuildNumber: "4012002",
    });
  });

  it("gives app forks unique build slots above stable", () => {
    expect(getNativeReleaseVersion("0.2.6", "app-v0.2.6-fork.2")).toEqual({
      appVersion: "0.2.6",
      androidVersionCode: 4013001,
      iosBuildNumber: "4013001",
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
    expect(() => getNativeReleaseVersion("1.50.0", "app-v1.50.0-fork.999")).toThrow(
      "Derived Android versionCode is out of range: 2100001998",
    );
  });
});
