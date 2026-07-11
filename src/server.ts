import http from "node:http";
import serveHandler from "serve-handler";

let server: http.Server | null = null;

export async function startWebServer(dir: string, port: number): Promise<void> {
  if (server) return;
  server = http.createServer((request, response) => {
    return serveHandler(request, response, {
      public: dir,
      directoryListing: true,
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
