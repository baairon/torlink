import http from "node:http";
import serveHandler from "serve-handler";

import { promises as fs } from "node:fs";
import path from "node:path";
import { renderDirectoryListing } from "./daemon/template";

let server: http.Server | null = null;

export async function startWebServer(dir: string, port: number): Promise<void> {
  if (server) return;
  server = http.createServer(async (request, response) => {
    try {
      const urlPath = (request.url || "/").split("?")[0]!;
      const decodedPath = decodeURIComponent(urlPath);
      const resolvedDir = path.resolve(dir);
      const safeRelative = decodedPath.replace(/^[/\\]+/, "");
      const resolvedFullPath = path.resolve(resolvedDir, safeRelative);
      
      // Make sure it doesn't escape the dir
      if (resolvedFullPath === resolvedDir || resolvedFullPath.startsWith(resolvedDir + path.sep)) {
        const stat = await fs.stat(resolvedFullPath).catch(() => null);
        if (stat && stat.isDirectory()) {
          const names = await fs.readdir(resolvedFullPath).catch(() => []);
          const entries = await Promise.all(names.map(async (name) => {
            const childStat = await fs.stat(path.join(resolvedFullPath, name)).catch(() => null);
            return {
              name,
              type: (childStat?.isDirectory() ? "dir" : "file") as "dir" | "file",
              size: childStat?.isFile() ? childStat.size : undefined,
            };
          }));
          
          const html = renderDirectoryListing(decodedPath, entries);
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end(request.method === "HEAD" ? undefined : html);
          return;
        }
      }
    } catch (err) {
      // Ignore errors and fall back to serveHandler
    }

    return serveHandler(request, response, {
      public: dir,
      directoryListing: false,
    });
  });
  return new Promise((resolve, reject) => {
    server!.listen(port, () => resolve());
    server!.on("error", reject);
  });
}

export function stopWebServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}
