import { lookup as dnsLookup } from "dns";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import type { LookupFunction } from "net";
import {
  assertSafeOutboundWebhookTarget,
  isBlockedOutboundAddress,
  isRedirectStatus,
} from "./outbound-webhook-security";

interface OutboundWebhookRequest {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
}

interface OutboundWebhookResponse {
  statusCode: number;
  statusMessage?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function resolvedAddressesContainBlockedTarget(address: unknown): boolean {
  const addresses = Array.isArray(address)
    ? address.map((entry) => typeof entry?.address === "string" ? entry.address : undefined)
    : [typeof address === "string" ? address : undefined];
  return addresses.some((entry) => entry !== undefined && isBlockedOutboundAddress(entry));
}

export const safeOutboundWebhookLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, options, (error, address, family) => {
    if (error) {
      callback(error, address, family);
      return;
    }
    if (resolvedAddressesContainBlockedTarget(address)) {
      callback(new Error("private outbound webhook target blocked"), address, family);
      return;
    }
    callback(null, address, family);
  });
};

export async function postOutboundWebhook(
  urlString: string,
  request: OutboundWebhookRequest
): Promise<OutboundWebhookResponse> {
  await assertSafeOutboundWebhookTarget(urlString);

  const url = new URL(urlString);
  const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
  const timeoutMs = request.timeoutMs || DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const req = transport(url, {
      method: request.method,
      headers: request.headers,
      lookup: safeOutboundWebhookLookup,
    }, (res) => {
      res.on("end", () => {
        if (isRedirectStatus(res.statusCode)) {
          reject(new Error(`redirects are not allowed for outbound webhooks (HTTP ${res.statusCode})`));
          return;
        }
        resolve({
          statusCode: res.statusCode || 0,
          statusMessage: res.statusMessage,
        });
      });
      res.resume();
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("outbound webhook delivery timed out"));
    });
    req.on("error", reject);
    req.write(request.body);
    req.end();
  });
}
