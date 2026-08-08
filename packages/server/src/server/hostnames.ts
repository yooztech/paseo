import net from "node:net";

export type HostnamesConfig = true | string[] | undefined;

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

function parseHostnameFromHostHeader(hostHeader: string): string | null {
  const trimmed = hostHeader.trim();
  if (!trimmed) return null;

  // IPv6 in brackets: [::1]:6767
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end === -1) return null;
    return normalizeHostname(trimmed.slice(1, end));
  }

  // IPv4/hostname with optional port: localhost:6767
  const colonIndex = trimmed.indexOf(":");
  if (colonIndex === -1) {
    return normalizeHostname(trimmed);
  }
  return normalizeHostname(trimmed.slice(0, colonIndex));
}

function matchesHostnamePattern(hostname: string, pattern: string): boolean {
  const normalizedPattern = normalizeHostname(pattern);
  if (!normalizedPattern) return false;

  if (normalizedPattern.startsWith(".")) {
    const base = normalizedPattern.slice(1);
    if (!base) return false;
    return hostname === base || hostname.endsWith(`.${base}`);
  }

  return hostname === normalizedPattern;
}

function isDefaultAllowedHostname(hostname: string): boolean {
  // Vite-style defaults: localhost, *.localhost, and all IP addresses.
  if (hostname === "localhost") return true;
  if (hostname.endsWith(".localhost")) return true;
  if (net.isIP(hostname) !== 0) return true;
  return false;
}

/**
 * Vite-style hostname allowlist check, adapted to raw Host headers.
 *
 * Semantics:
 * - `hostnames === true` => allow any host.
 * - `hostnames === []` or `undefined` => allow localhost, *.localhost, and all IPs.
 * - `hostnames === ['.example.com', 'myhost']` => allow those *in addition* to defaults.
 */
export function isHostnameAllowed(
  hostHeader: string | undefined,
  hostnames: HostnamesConfig,
): boolean {
  const hostname = hostHeader ? parseHostnameFromHostHeader(hostHeader) : null;
  if (!hostname) return false;

  if (hostnames === true) return true;

  // Defaults are always allowed.
  if (isDefaultAllowedHostname(hostname)) return true;

  const patterns = hostnames ?? [];
  for (const pattern of patterns) {
    if (matchesHostnamePattern(hostname, pattern)) return true;
  }
  return false;
}

/**
 * True when a browser Origin is on the Host allowlist. Used for CORS and
 * WebSocket upgrades across service-proxy hostnames (app--* → daemon--*) where
 * classic same-origin checks fail because the script labels differ.
 */
export function isOriginHostnameAllowed(
  origin: string | undefined,
  hostnames: HostnamesConfig,
): boolean {
  if (!origin) {
    return false;
  }
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  return isHostnameAllowed(originUrl.host, hostnames);
}

/**
 * When serviceProxy.publicBaseUrl is set, clients reach workspace services at
 * `<script>--<branch>--<project>.<baseHost>`. Auto-allow that base and its
 * subdomains so Host checks do not reject the public service aliases.
 */
export function hostnamesFromPublicBaseUrl(publicBaseUrl: string | null | undefined): string[] {
  if (!publicBaseUrl) {
    return [];
  }
  let hostname: string;
  try {
    hostname = new URL(publicBaseUrl).hostname.toLowerCase();
  } catch {
    return [];
  }
  if (!hostname || isDefaultAllowedHostname(hostname)) {
    return [];
  }
  return [hostname, `.${hostname}`];
}

/**
 * Service-proxy public hosts are one DNS label with `--` separators plus a
 * base host, e.g. `daemon--branch--project.paseo.example.com`. The base is
 * everything after that leftmost label.
 */
export function serviceProxyPublicBaseFromHostname(hostname: string): string | null {
  const normalized = normalizeHostname(hostname);
  const firstDot = normalized.indexOf(".");
  if (firstDot <= 0) {
    return null;
  }
  const leftLabel = normalized.slice(0, firstDot);
  if (!leftLabel.includes("--")) {
    return null;
  }
  const base = normalized.slice(firstDot + 1);
  return base || null;
}

function hostnamesFromServiceProxyHostname(hostname: string): string[] {
  if (!hostname || isDefaultAllowedHostname(hostname)) {
    return [];
  }
  const base = serviceProxyPublicBaseFromHostname(hostname);
  if (!base || isDefaultAllowedHostname(base)) {
    return [];
  }
  return [base, `.${base}`];
}

/**
 * Workspace daemons spawned behind the proxy receive `PASEO_URL` /
 * `PASEO_SERVICE_*_URL` even when the child config has no `serviceProxy`
 * block. Derive the public base allowlist from those URLs so Host/CORS checks
 * admit the same aliases the parent registered.
 */
export function hostnamesFromServiceProxyEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string[] {
  const urls: string[] = [];
  const paseoUrl = env.PASEO_URL;
  if (typeof paseoUrl === "string" && paseoUrl.trim()) {
    urls.push(paseoUrl.trim());
  }
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("PASEO_SERVICE_") || !key.endsWith("_URL")) {
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      urls.push(value.trim());
    }
  }

  const patterns = new Set<string>();
  for (const url of urls) {
    let hostname: string;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    for (const pattern of hostnamesFromServiceProxyHostname(hostname)) {
      patterns.add(pattern);
    }
  }
  return Array.from(patterns);
}

export function mergeHostnames(values: Array<HostnamesConfig>): HostnamesConfig {
  let merged: string[] = [];
  for (const value of values) {
    if (value === true) return true;
    if (!value) continue;
    merged = merged.concat(value);
  }

  const deduped = Array.from(new Set(merged.map((v) => v.trim()).filter((v) => v.length > 0)));
  return deduped;
}

export function parseHostnamesEnv(raw: string | undefined): HostnamesConfig {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase() === "true") return true;
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
