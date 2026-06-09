import { lookup as dnsLookup } from "dns";
import { isIP } from "net";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type WebhookResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export function isBlockedOutboundAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const host = unwrapIpv4MappedIpv6(normalized) || normalized;

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const [a, b] = host.split(".").map((part) => Number(part));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (ipVersion === 6) {
    return (
      host === "::" ||
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80:")
    );
  }
  return false;
}

function unwrapIpv4MappedIpv6(address: string): string | undefined {
  const dotted = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];

  const hex = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return undefined;

  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return undefined;
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join(".");
}

export function isBlockedOutboundHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return isBlockedOutboundAddress(host);
}

export function normalizeOutboundWebhookUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (isBlockedOutboundHost(url.hostname)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function resolveWebhookHostname(hostname: string): Promise<ResolvedAddress[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true }, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(addresses.map((entry) => ({
        address: entry.address,
        family: entry.family,
      })));
    });
  });
}

export async function assertSafeOutboundWebhookTarget(
  urlString: string,
  resolver: WebhookResolver = resolveWebhookHostname
): Promise<void> {
  const url = new URL(urlString);
  if (isBlockedOutboundHost(url.hostname)) {
    throw new Error("private outbound webhook target blocked");
  }

  if (isIP(url.hostname.replace(/^\[|\]$/g, ""))) return;

  const addresses = await resolver(url.hostname);
  if (addresses.length === 0 || addresses.some((entry) => isBlockedOutboundAddress(entry.address))) {
    throw new Error("private outbound webhook target blocked");
  }
}

export function isRedirectStatus(statusCode: number | undefined): boolean {
  return statusCode !== undefined && statusCode >= 300 && statusCode < 400;
}
