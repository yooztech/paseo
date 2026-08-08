import { describe, it, expect } from "vitest";
import { PersistedConfigSchema } from "./persisted-config.js";
import {
  hostnamesFromPublicBaseUrl,
  hostnamesFromServiceProxyEnv,
  isHostnameAllowed,
  isOriginHostnameAllowed,
  mergeHostnames,
  parseHostnamesEnv,
  serviceProxyPublicBaseFromHostname,
} from "./hostnames.js";

describe("hostnames (vite-style)", () => {
  it("allows localhost by default", () => {
    expect(isHostnameAllowed("localhost:6767", undefined)).toBe(true);
  });

  it("allows subdomains of .localhost by default", () => {
    expect(isHostnameAllowed("foo.localhost:6767", undefined)).toBe(true);
  });

  it("allows IP addresses by default", () => {
    expect(isHostnameAllowed("127.0.0.1:6767", undefined)).toBe(true);
    expect(isHostnameAllowed("[::1]:6767", undefined)).toBe(true);
  });

  it("rejects non-default hosts when no allowlist is provided", () => {
    expect(isHostnameAllowed("evil.com:6767", undefined)).toBe(false);
  });

  it("allows any host when set to true", () => {
    expect(isHostnameAllowed("evil.com:6767", true)).toBe(true);
  });

  it("supports leading-dot patterns", () => {
    const hostnames = [".example.com"];
    expect(isHostnameAllowed("example.com:6767", hostnames)).toBe(true);
    expect(isHostnameAllowed("foo.example.com:6767", hostnames)).toBe(true);
    expect(isHostnameAllowed("foo.bar.example.com:6767", hostnames)).toBe(true);
    expect(isHostnameAllowed("notexample.com:6767", hostnames)).toBe(false);
  });

  it("merges arrays (append + de-dupe) and short-circuits on true", () => {
    expect(mergeHostnames([["a"], ["a", "b"]])).toEqual(["a", "b"]);
    expect(mergeHostnames([["a"], true, ["b"]])).toBe(true);
  });

  it("parses env var values", () => {
    expect(parseHostnamesEnv(undefined)).toBeUndefined();
    expect(parseHostnamesEnv("")).toBeUndefined();
    expect(parseHostnamesEnv("true")).toBe(true);
    expect(parseHostnamesEnv("localhost,.example.com")).toEqual(["localhost", ".example.com"]);
  });

  it("derives allowlist patterns from serviceProxy.publicBaseUrl", () => {
    expect(hostnamesFromPublicBaseUrl("https://paseo.iceveil.com")).toEqual([
      "paseo.iceveil.com",
      ".paseo.iceveil.com",
    ]);
    expect(
      isHostnameAllowed(
        "daemon--demonic-shark--paseo-7e3fa7f7.paseo.iceveil.com:28443",
        hostnamesFromPublicBaseUrl("https://paseo.iceveil.com"),
      ),
    ).toBe(true);
    expect(hostnamesFromPublicBaseUrl("http://localhost:6767")).toEqual([]);
    expect(hostnamesFromPublicBaseUrl(null)).toEqual([]);
  });

  it("derives allowlist patterns from workspace service URL env vars", () => {
    expect(
      serviceProxyPublicBaseFromHostname("daemon--demonic-shark--paseo-7e3fa7f7.paseo.iceveil.com"),
    ).toBe("paseo.iceveil.com");

    const patterns = hostnamesFromServiceProxyEnv({
      PASEO_URL: "https://daemon--demonic-shark--paseo-7e3fa7f7.paseo.iceveil.com:28443",
      PASEO_SERVICE_APP_URL: "https://app--demonic-shark--paseo-7e3fa7f7.paseo.iceveil.com:28443",
      PASEO_SERVICE_DAEMON_URL:
        "https://daemon--demonic-shark--paseo-7e3fa7f7.paseo.iceveil.com:28443",
    });
    expect(patterns).toEqual(["paseo.iceveil.com", ".paseo.iceveil.com"]);
    expect(
      isHostnameAllowed("daemon--demonic-shark--paseo-7e3fa7f7.paseo.iceveil.com:28443", patterns),
    ).toBe(true);
    expect(
      isOriginHostnameAllowed(
        "https://app--demonic-shark--paseo-7e3fa7f7.paseo.iceveil.com:28443",
        patterns,
      ),
    ).toBe(true);
  });

  it("allows browser origins that sit on the host allowlist", () => {
    const hostnames = hostnamesFromPublicBaseUrl("https://paseo.iceveil.com");
    expect(
      isOriginHostnameAllowed(
        "https://app--demonic-shark--paseo-7e3fa7f7.paseo.iceveil.com:28443",
        hostnames,
      ),
    ).toBe(true);
    expect(isOriginHostnameAllowed("https://evil.example:28443", hostnames)).toBe(false);
    expect(isOriginHostnameAllowed("http://app--feature--paseo.localhost:6767", undefined)).toBe(
      true,
    );
  });

  it("normalizes persisted allowedHosts into hostnames for backward compatibility", () => {
    const parsed = PersistedConfigSchema.parse({
      daemon: {
        allowedHosts: [".example.com"],
      },
    });

    expect(parsed.daemon?.hostnames).toEqual([".example.com"]);
  });
});
