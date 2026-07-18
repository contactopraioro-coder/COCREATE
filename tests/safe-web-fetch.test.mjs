import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import {
  createSafeWebFetcher,
  createPinnedLookup,
  isPublicIpAddress,
  validatePublicWebUrl
} from "../infrastructure/trusted-web/safe-web-fetch.js";

function response(statusCode, headers, body = "") {
  const stream = Readable.from([Buffer.from(body)]);
  stream.statusCode = statusCode;
  stream.headers = headers;
  return stream;
}

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("pinned lookup soporta contratos single y multi-address de Node", async () => {
  const lookup = createPinnedLookup({ address: "93.184.216.34", family: 4 });
  const multiple = await new Promise((resolve, reject) => {
    lookup("example.com", { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses));
  });
  assert.deepEqual(multiple, [{ address: "93.184.216.34", family: 4 }]);
  const single = await new Promise((resolve, reject) => {
    lookup("example.com", { all: false }, (error, address, family) => error ? reject(error) : resolve({ address, family }));
  });
  assert.deepEqual(single, { address: "93.184.216.34", family: 4 });
});

test("bloquea protocolos, hosts, puertos y redes no publicas", () => {
  for (const value of [
    "http://localhost/a",
    "http://127.0.0.1/a",
    "http://10.0.0.1/a",
    "http://169.254.169.254/latest/meta-data",
    "http://metadata.google.internal/",
    "file:///etc/passwd",
    "ftp://example.com/a",
    "data:text/plain,test",
    "javascript:alert(1)",
    "https://user:pass@example.com/",
    "https://example.com:8443/"
  ]) {
    assert.throws(() => validatePublicWebUrl(value), (error) => error.code === "WEB_FETCH_BLOCKED_URL", value);
  }
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("::1"), false);
  assert.equal(isPublicIpAddress("fc00::1"), false);
});

test("recupera HTML publico sin ejecutar scripts y registra trazabilidad", async () => {
  const fetcher = createSafeWebFetcher({
    lookupImpl: publicLookup,
    requestImpl: async () => response(200, { "content-type": "text/html; charset=utf-8" },
      "<html><title>Fuente</title><script>steal()</script><p>Texto verificable</p></html>")
  });
  const result = await fetcher.fetch({ url: "https://example.com/source" });
  assert.equal(result.statusCode, 200);
  assert.equal(result.title, "Fuente");
  assert.match(result.text, /Texto verificable/);
  assert.doesNotMatch(result.text, /steal/);
  assert.ok(Date.parse(result.retrievedAt));
});

test("revalida redirects y bloquea un destino privado", async () => {
  const safe = createSafeWebFetcher({
    lookupImpl: publicLookup,
    requestImpl: async (url) => url.pathname === "/start"
      ? response(302, { location: "/final" })
      : response(200, { "content-type": "text/plain" }, "contenido final")
  });
  const result = await safe.fetch({ url: "https://example.com/start" });
  assert.equal(result.redirects, 1);
  assert.equal(result.finalUrl, "https://example.com/final");

  const malicious = createSafeWebFetcher({
    lookupImpl: publicLookup,
    requestImpl: async () => response(302, { location: "http://127.0.0.1/private" })
  });
  await assert.rejects(malicious.fetch({ url: "https://example.com/start" }), (error) => error.code === "WEB_FETCH_BLOCKED_URL");
});

test("bloquea binarios y exceso de bytes; trunca texto largo", async () => {
  const binary = createSafeWebFetcher({
    lookupImpl: publicLookup,
    requestImpl: async () => response(200, { "content-type": "application/pdf" }, "%PDF")
  });
  await assert.rejects(binary.fetch({ url: "https://example.com/a.pdf" }), (error) => error.code === "WEB_FETCH_UNSUPPORTED_CONTENT");

  const oversized = createSafeWebFetcher({
    lookupImpl: publicLookup,
    requestImpl: async () => response(200, { "content-type": "text/plain", "content-length": "2000" }, "x")
  });
  await assert.rejects(oversized.fetch({ url: "https://example.com/big", maxBytes: 1024 }), (error) => error.code === "WEB_FETCH_TOO_LARGE");

  const truncating = createSafeWebFetcher({
    lookupImpl: publicLookup,
    maxTextChars: 4_000,
    requestImpl: async () => response(200, { "content-type": "text/plain" }, "x".repeat(5_000))
  });
  const truncated = await truncating.fetch({ url: "https://example.com/long" });
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.text.length, 4_000);
});

test("timeout y DNS rebinding se convierten en errores seguros", async () => {
  const timeout = createSafeWebFetcher({
    lookupImpl: publicLookup,
    requestImpl: async (_url, _address, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })), { once: true });
    })
  });
  await assert.rejects(timeout.fetch({ url: "https://example.com/slow", timeoutMs: 500 }), (error) => error.code === "WEB_FETCH_TIMEOUT");

  const rebinding = createSafeWebFetcher({
    lookupImpl: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 }
    ],
    requestImpl: async () => response(200, { "content-type": "text/plain" }, "never")
  });
  await assert.rejects(rebinding.fetch({ url: "https://example.com" }), (error) => error.code === "WEB_FETCH_BLOCKED_URL");
});
