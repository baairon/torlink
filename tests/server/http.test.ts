import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTorzlinkRuntime } from "../../src/core/runtime";
import { handleRequest } from "../../src/server/httpServer";
import { normalizeSearchQuery } from "../../src/server/searchAll";
import { parseCliArgs } from "../../src/cli/args";

function request(
  handler: http.RequestListener,
  method: string,
  urlPath: string,
  body?: string,
): Promise<{ status: number; json: unknown; text: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no addr"));
        return;
      }
      const req = http.request(
        {
          host: "127.0.0.1",
          port: addr.port,
          path: urlPath,
          method,
          headers: body
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
            : undefined,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            server.close();
            let json: unknown = null;
            try {
              json = JSON.parse(text);
            } catch {
              /* not json */
            }
            resolve({ status: res.statusCode ?? 0, json, text });
          });
        },
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (body) req.write(body);
      req.end();
    });
  });
}

describe("parseCliArgs serve", () => {
  it("parses serve defaults", () => {
    expect(parseCliArgs(["serve"])).toEqual({
      kind: "serve",
      host: "127.0.0.1",
      port: 8787,
    });
  });
  it("parses serve host and port", () => {
    expect(parseCliArgs(["serve", "--host", "0.0.0.0", "--port", "9000"])).toEqual({
      kind: "serve",
      host: "0.0.0.0",
      port: 9000,
    });
  });
  it("rejects bad port", () => {
    expect(parseCliArgs(["serve", "--port", "nope"])).toEqual({
      kind: "invalid",
      arg: "nope",
    });
  });
});

describe("normalizeSearchQuery", () => {
  it("trims and rejects empty / oversized", () => {
    expect(normalizeSearchQuery("  hi  ")).toBe("hi");
    expect(normalizeSearchQuery("")).toBeNull();
    expect(normalizeSearchQuery("x".repeat(201))).toBeNull();
  });
});

describe("HTTP API", () => {
  const stateDir = path.join(tmpdir(), "torzlink-test-state");
  let publicDir: string;

  beforeEach(async () => {
    publicDir = path.resolve(process.cwd(), "web");
    process.env.TORZLINK_DISABLE_DOTENV = "1";
    process.env.TORZLINK_SKIP_UPDATE = "1";
    process.env.TORZLINK_DOWNLOAD_DIR = path.join(stateDir, "downloads");
    delete process.env.TORZLINK_SERVE_TOKEN;
    await rm(path.join(stateDir, "data"), { recursive: true, force: true });
    await rm(path.join(stateDir, "config"), { recursive: true, force: true });
    await rm(path.join(stateDir, "downloads"), { recursive: true, force: true });
  });

  afterEach(async () => {
    delete process.env.TORZLINK_SERVE_TOKEN;
  });

  it("health and downloads list", async () => {
    const runtime = await createTorzlinkRuntime();
    try {
      const handler: http.RequestListener = (req, res) => {
        void handleRequest(req, res, runtime, publicDir);
      };
      const health = await request(handler, "GET", "/health");
      expect(health.status).toBe(200);
      expect(health.json).toMatchObject({ ok: true, mode: "serve" });

      const list = await request(handler, "GET", "/api/downloads");
      expect(list.status).toBe(200);
      expect(list.json).toEqual({ items: [] });
    } finally {
      runtime.dispose();
    }
  });

  it("rejects invalid magnet add", async () => {
    const runtime = await createTorzlinkRuntime();
    try {
      const handler: http.RequestListener = (req, res) => {
        void handleRequest(req, res, runtime, publicDir);
      };
      const res = await request(
        handler,
        "POST",
        "/api/downloads",
        JSON.stringify({ input: "not-a-magnet" }),
      );
      expect(res.status).toBe(400);
    } finally {
      runtime.dispose();
    }
  });

  it("adds a sanitized infohash and cancels it", async () => {
    const runtime = await createTorzlinkRuntime();
    try {
      const handler: http.RequestListener = (req, res) => {
        void handleRequest(req, res, runtime, publicDir);
      };
      const hash = "abcdef0123456789abcdef0123456789abcdef01";
      const add = await request(
        handler,
        "POST",
        "/api/downloads",
        JSON.stringify({ input: hash }),
      );
      expect(add.status).toBe(201);
      expect(add.json).toMatchObject({ ok: true, id: hash, existed: false });

      const dup = await request(
        handler,
        "POST",
        "/api/downloads",
        JSON.stringify({ input: hash }),
      );
      expect(dup.status).toBe(200);
      expect(dup.json).toMatchObject({ ok: true, id: hash, existed: true });

      const list = await request(handler, "GET", "/api/downloads");
      expect((list.json as { items: unknown[] }).items).toHaveLength(1);

      const cancel = await request(handler, "POST", `/api/downloads/${hash}/cancel`, "{}");
      expect(cancel.status).toBe(200);
      const list2 = await request(handler, "GET", "/api/downloads");
      expect((list2.json as { items: unknown[] }).items).toHaveLength(0);
    } finally {
      runtime.dispose();
    }
  });

  it("requires Bearer when TORZLINK_SERVE_TOKEN is set", async () => {
    process.env.TORZLINK_SERVE_TOKEN = "test-secret-token";
    const runtime = await createTorzlinkRuntime();
    try {
      const handler: http.RequestListener = (req, res) => {
        void handleRequest(req, res, runtime, publicDir);
      };
      const denied = await request(handler, "GET", "/api/downloads");
      expect(denied.status).toBe(401);

      const authMeta = await request(handler, "GET", "/api/auth");
      expect(authMeta.json).toEqual({ required: true });

      const ok = await new Promise<{ status: number; json: unknown }>((resolve, reject) => {
        const server = http.createServer(handler);
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          if (!addr || typeof addr === "string") {
            reject(new Error("no addr"));
            return;
          }
          const req = http.request(
            {
              host: "127.0.0.1",
              port: addr.port,
              path: "/api/downloads",
              method: "GET",
              headers: { Authorization: "Bearer test-secret-token" },
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (c) => chunks.push(c));
              res.on("end", () => {
                server.close();
                resolve({
                  status: res.statusCode ?? 0,
                  json: JSON.parse(Buffer.concat(chunks).toString("utf8")),
                });
              });
            },
          );
          req.on("error", (err) => {
            server.close();
            reject(err);
          });
          req.end();
        });
      });
      expect(ok.status).toBe(200);
    } finally {
      runtime.dispose();
      delete process.env.TORZLINK_SERVE_TOKEN;
    }
  });

  it("rejects static path escape to sibling dirs", async () => {
    const { resolvePublicPath } = await import("../../src/server/httpServer");
    const root = path.join(stateDir, "pub");
    expect(resolvePublicPath(root, "/../web-backup/secret")).toBeNull();
    expect(resolvePublicPath(root, "/index.html")).toBe(path.resolve(root, "index.html"));
  });

  it("serves the web UI index", async () => {
    const runtime = await createTorzlinkRuntime();
    try {
      const handler: http.RequestListener = (req, res) => {
        void handleRequest(req, res, runtime, publicDir);
      };
      const res = await request(handler, "GET", "/");
      expect(res.status).toBe(200);
      expect(res.text).toContain("TorZlink");
    } finally {
      runtime.dispose();
    }
  });
});
