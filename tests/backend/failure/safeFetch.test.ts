// F2B exit evidence: fixture HTTP server + failure-path tests for the
// hardened fetcher. Everything runs against 127.0.0.1 (allowPrivateHosts
// test hook); no real upstream is contacted.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SafeFetchError,
  isPrivateAddress,
  safeFetch,
} from "@/lib/backend/collector/safeFetch";

const FIXTURE_XML = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>fixture</title><link>https://x.example/a</link></item>
</channel></rss>`;

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", base);
    switch (url.pathname) {
      case "/feed.xml": {
        if (req.headers["if-none-match"] === '"v1"') {
          res.writeHead(304, { ETag: '"v1"' });
          res.end();
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/rss+xml",
          ETag: '"v1"',
          "Last-Modified": "Wed, 22 Jul 2026 09:00:00 GMT",
        });
        res.end(FIXTURE_XML);
        return;
      }
      case "/redirect-once":
        res.writeHead(302, { Location: "/feed.xml" });
        res.end();
        return;
      case "/redirect-loop":
        res.writeHead(302, { Location: "/redirect-loop" });
        res.end();
        return;
      case "/redirect-private":
        res.writeHead(302, { Location: "https://169.254.169.254/latest/meta-data" });
        res.end();
        return;
      case "/redirect-no-location":
        res.writeHead(302);
        res.end();
        return;
      case "/huge": {
        res.writeHead(200, { "Content-Type": "application/xml" });
        const chunk = "x".repeat(64 * 1024);
        for (let i = 0; i < 20; i++) res.write(chunk);
        res.end();
        return;
      }
      case "/slow":
        // Never responds; the client timeout must fire.
        return;
      case "/error-500":
        res.writeHead(500);
        res.end("upstream broke");
        return;
      default:
        res.writeHead(404);
        res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const testOpts = { allowPrivateHosts: true };

describe("safeFetch — happy path + conditional GET (F2B)", () => {
  it("fetches a feed and captures caching validators", async () => {
    const result = await safeFetch(`${base}/feed.xml`, testOpts);
    expect(result.status).toBe(200);
    expect(result.notModified).toBe(false);
    expect(result.body).toContain("<rss");
    expect(result.etag).toBe('"v1"');
    expect(result.lastModified).toBeTruthy();
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("sends If-None-Match and honors 304 without a body", async () => {
    const result = await safeFetch(`${base}/feed.xml`, {
      ...testOpts,
      etag: '"v1"',
    });
    expect(result.status).toBe(304);
    expect(result.notModified).toBe(true);
    expect(result.body).toBeUndefined();
    expect(result.bytes).toBe(0);
    expect(result.etag).toBe('"v1"');
  });

  it("follows a bounded redirect and reports the final URL", async () => {
    const result = await safeFetch(`${base}/redirect-once`, testOpts);
    expect(result.status).toBe(200);
    expect(result.redirects).toBe(1);
    expect(result.finalUrl).toBe(`${base}/feed.xml`);
  });

  it("returns non-2xx statuses for the caller to classify", async () => {
    const result = await safeFetch(`${base}/error-500`, testOpts);
    expect(result.status).toBe(500);
  });
});

describe("safeFetch — failure paths (F2B)", () => {
  async function expectCode(promise: Promise<unknown>, code: string) {
    try {
      await promise;
      expect.fail(`expected SafeFetchError(${code})`);
    } catch (err) {
      expect(err).toBeInstanceOf(SafeFetchError);
      expect((err as SafeFetchError).code).toBe(code);
    }
  }

  it("rejects redirect loops at the hop limit", async () => {
    await expectCode(
      safeFetch(`${base}/redirect-loop`, { ...testOpts, maxRedirects: 3 }),
      "redirect_limit_exceeded",
    );
  });

  it("rejects redirects without a Location header", async () => {
    await expectCode(
      safeFetch(`${base}/redirect-no-location`, testOpts),
      "redirect_invalid",
    );
  });

  it("blocks redirects into private/metadata address space", async () => {
    // The test hook only whitelists loopback; the redirect target
    // 169.254.169.254 (cloud metadata) must still be rejected.
    await expectCode(
      safeFetch(`${base}/redirect-private`, testOpts),
      "private_address_blocked",
    );
  });

  it("aborts oversized bodies at the byte cap, not after download", async () => {
    await expectCode(
      safeFetch(`${base}/huge`, { ...testOpts, maxBodyBytes: 256 * 1024 }),
      "body_too_large",
    );
  });

  it("times out a hanging upstream", async () => {
    await expectCode(
      safeFetch(`${base}/slow`, { ...testOpts, timeoutMs: 500 }),
      "timeout",
    );
  });

  it("rejects plain http and non-http(s) schemes in strict mode", async () => {
    await expectCode(safeFetch(`${base}/feed.xml`), "insecure_scheme");
    await expectCode(safeFetch("ftp://feeds.example/x"), "insecure_scheme");
    await expectCode(safeFetch("not a url"), "invalid_url");
  });

  it("blocks private IP literals in strict mode", async () => {
    await expectCode(
      safeFetch("https://127.0.0.1/feed.xml"),
      "private_address_blocked",
    );
    await expectCode(
      safeFetch("https://169.254.169.254/latest/meta-data"),
      "private_address_blocked",
    );
    await expectCode(
      safeFetch("https://10.0.0.8/feed.xml"),
      "private_address_blocked",
    );
    await expectCode(
      safeFetch("https://[::1]/feed.xml"),
      "private_address_blocked",
    );
  });
});

describe("isPrivateAddress classification", () => {
  it("classifies the critical ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:192.168.0.1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});
