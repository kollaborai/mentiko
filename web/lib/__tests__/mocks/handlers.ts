/**
 * MSW handlers: mock Stripe, Hetzner, and Cloudflare APIs
 * for end-to-end provisioning pipeline testing.
 */

import { http, HttpResponse } from "msw";

// ---------------------------------------------------------------------------
// state: tracks what's been created so handlers can be stateful
// ---------------------------------------------------------------------------

export const mockState = {
  servers: new Map<number, { id: number; name: string; status: string; ip: string | null }>(),
  buckets: new Map<string, { name: string }>(),
  tokens: new Map<string, { id: string; bucket: string }>(),
  dnsRecords: new Map<string, { id: string; name: string; content: string; proxied: boolean }>(),
  stripeCheckouts: new Map<string, { id: string; url: string; metadata: Record<string, string> }>(),
  nextServerId: 1001,
  nextTokenId: 1,
  nextDnsId: 1,
};

export function resetMockState() {
  mockState.servers.clear();
  mockState.buckets.clear();
  mockState.tokens.clear();
  mockState.dnsRecords.clear();
  mockState.stripeCheckouts.clear();
  mockState.nextServerId = 1001;
  mockState.nextTokenId = 1;
  mockState.nextDnsId = 1;
}

// ---------------------------------------------------------------------------
// Hetzner Cloud API (https://api.hetzner.cloud/v1)
// ---------------------------------------------------------------------------

const hetznerHandlers = [
  // POST /servers - create server
  http.post("https://api.hetzner.cloud/v1/servers", async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const id = mockState.nextServerId++;
    const ip = `10.0.0.${id - 1000}`;

    mockState.servers.set(id, {
      id,
      name: body.name as string,
      status: "initializing",
      ip,
    });

    // simulate server becoming ready after creation
    setTimeout(() => {
      const server = mockState.servers.get(id);
      if (server) server.status = "running";
    }, 100);

    return HttpResponse.json({
      server: {
        id,
        name: body.name,
        status: "initializing",
        public_net: {
          ipv4: { ip },
          ipv6: null,
        },
        server_type: { name: body.server_type },
        datacenter: { name: "nbg1-dc3" },
        labels: body.labels || {},
      },
    });
  }),

  // GET /servers/:id - get server
  http.get("https://api.hetzner.cloud/v1/servers/:id", ({ params }) => {
    const id = parseInt(params.id as string, 10);
    const server = mockState.servers.get(id);

    if (!server) {
      return HttpResponse.json(
        { error: { code: "not_found", message: "server not found" } },
        { status: 404 },
      );
    }

    return HttpResponse.json({
      server: {
        id: server.id,
        name: server.name,
        status: server.status,
        public_net: {
          ipv4: server.ip ? { ip: server.ip } : null,
          ipv6: null,
        },
        server_type: { name: "cx32" },
        datacenter: { name: "nbg1-dc3" },
        labels: {},
      },
    });
  }),

  // POST /servers/:id/actions/poweron
  http.post("https://api.hetzner.cloud/v1/servers/:id/actions/poweron", ({ params }) => {
    const id = parseInt(params.id as string, 10);
    const server = mockState.servers.get(id);
    if (server) server.status = "running";
    return HttpResponse.json({ action: { id: 1, status: "running" } });
  }),

  // POST /servers/:id/actions/poweroff
  http.post("https://api.hetzner.cloud/v1/servers/:id/actions/poweroff", ({ params }) => {
    const id = parseInt(params.id as string, 10);
    const server = mockState.servers.get(id);
    if (server) server.status = "off";
    return HttpResponse.json({ action: { id: 2, status: "running" } });
  }),

  // DELETE /servers/:id
  http.delete("https://api.hetzner.cloud/v1/servers/:id", ({ params }) => {
    const id = parseInt(params.id as string, 10);
    mockState.servers.delete(id);
    return new HttpResponse(null, { status: 204 });
  }),
];

// ---------------------------------------------------------------------------
// Cloudflare API (R2 buckets + DNS)
// ---------------------------------------------------------------------------

const cloudflareHandlers = [
  // POST /accounts/:id/r2/buckets - create bucket
  http.post("https://api.cloudflare.com/client/v4/accounts/:accountId/r2/buckets", async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const name = body.name as string;
    mockState.buckets.set(name, { name });
    return HttpResponse.json({ success: true, result: { name } });
  }),

  // DELETE /accounts/:id/r2/buckets/:name - delete bucket
  http.delete("https://api.cloudflare.com/client/v4/accounts/:accountId/r2/buckets/:name", ({ params }) => {
    mockState.buckets.delete(params.name as string);
    return HttpResponse.json({ success: true, result: null });
  }),

  // POST /user/tokens - create API token (R2 bucket token)
  http.post("https://api.cloudflare.com/client/v4/user/tokens", async () => {
    const tokenId = `mock-token-${mockState.nextTokenId++}`;
    return HttpResponse.json({
      success: true,
      result: {
        id: tokenId,
        value: `mock-secret-${tokenId}`,
      },
    });
  }),

  // DELETE /user/tokens/:id - revoke token
  http.delete("https://api.cloudflare.com/client/v4/user/tokens/:tokenId", ({ params }) => {
    mockState.tokens.delete(params.tokenId as string);
    return HttpResponse.json({ success: true, result: null });
  }),

  // POST /zones/:zoneId/dns_records - create DNS record
  http.post("https://api.cloudflare.com/client/v4/zones/:zoneId/dns_records", async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const id = `dns-${mockState.nextDnsId++}`;
    mockState.dnsRecords.set(id, {
      id,
      name: body.name as string,
      content: body.content as string,
      proxied: body.proxied as boolean,
    });
    return HttpResponse.json({ success: true, result: { id } });
  }),

  // PATCH /zones/:zoneId/dns_records/:id - update DNS record
  http.patch("https://api.cloudflare.com/client/v4/zones/:zoneId/dns_records/:id", async ({ params, request }) => {
    const body = await request.json() as Record<string, unknown>;
    const record = mockState.dnsRecords.get(params.id as string);
    if (record && body.content) record.content = body.content as string;
    return HttpResponse.json({ success: true, result: record });
  }),

  // DELETE /zones/:zoneId/dns_records/:id - delete DNS record
  http.delete("https://api.cloudflare.com/client/v4/zones/:zoneId/dns_records/:id", ({ params }) => {
    mockState.dnsRecords.delete(params.id as string);
    return HttpResponse.json({ success: true, result: null });
  }),

  // GET /zones/:zoneId/dns_records - list DNS records
  http.get("https://api.cloudflare.com/client/v4/zones/:zoneId/dns_records", ({ request }) => {
    const url = new URL(request.url);
    const name = url.searchParams.get("name");
    const records = [...mockState.dnsRecords.values()].filter(
      (r) => !name || r.name === name,
    );
    return HttpResponse.json({ success: true, result: records });
  }),
];

// ---------------------------------------------------------------------------
// Stripe API
// ---------------------------------------------------------------------------

const stripeHandlers = [
  // POST /v1/checkout/sessions - create checkout session
  http.post("https://api.stripe.com/v1/checkout/sessions", async ({ request }) => {
    const body = await request.text();
    const params = new URLSearchParams(body);

    const sessionId = `cs_test_${Date.now()}`;
    const metadata: Record<string, string> = {};

    // parse stripe form-encoded metadata
    for (const [key, value] of params.entries()) {
      if (key.startsWith("metadata[")) {
        const metaKey = key.slice(9, -1);
        metadata[metaKey] = value;
      }
    }

    mockState.stripeCheckouts.set(sessionId, {
      id: sessionId,
      url: `https://checkout.stripe.com/test/${sessionId}`,
      metadata,
    });

    return HttpResponse.json({
      id: sessionId,
      url: `https://checkout.stripe.com/test/${sessionId}`,
      metadata,
    });
  }),
];

// ---------------------------------------------------------------------------
// export all handlers
// ---------------------------------------------------------------------------

export const handlers = [
  ...hetznerHandlers,
  ...cloudflareHandlers,
  ...stripeHandlers,
];
