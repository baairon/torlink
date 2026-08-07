import net from "node:net";
import dgram from "node:dgram";
import type { Config } from "../config/config";

const originalNetConnect = net.connect;
const originalNetCreateConnection = net.createConnection;
const originalDgramCreateSocket = dgram.createSocket;

let activeBindAddress: string | null = null;
let patched = false;

export function applyNetworkBinding(config: Config) {
  activeBindAddress = config.bindAddress;

  if (patched) return;
  patched = true;

  // Patch net.connect and net.createConnection
  const patchNet = (original: any) => {
    return function (this: any, ...args: any[]) {
      if (activeBindAddress) {
        if (args.length > 0 && typeof args[0] === "object" && args[0] !== null) {
          args[0].localAddress = activeBindAddress;
        } else if (typeof args[0] === "number" || typeof args[0] === "string") {
          // It's a port or path, we need to inject an options object
          const options = {
            [typeof args[0] === "number" ? "port" : "path"]: args[0],
            host: typeof args[1] === "string" ? args[1] : undefined,
            localAddress: activeBindAddress,
          };
          // The callback might be arg 1 or arg 2
          const cb = typeof args[args.length - 1] === "function" ? args[args.length - 1] : undefined;
          args = cb ? [options, cb] : [options];
        }
      }
      return original.apply(this, args);
    };
  };

  (net as any).connect = patchNet(originalNetConnect);
  (net as any).createConnection = patchNet(originalNetCreateConnection);

  // Patch dgram.createSocket
  (dgram as any).createSocket = function (this: any, ...args: any[]) {
    const socket = originalDgramCreateSocket.apply(this, args as any);
    if (activeBindAddress) {
      const originalBind = socket.bind;
      socket.bind = function (this: any, ...bindArgs: any[]) {
        if (bindArgs.length > 0 && typeof bindArgs[0] === "object" && bindArgs[0] !== null) {
          if (!bindArgs[0].address) bindArgs[0].address = activeBindAddress;
        } else if (typeof bindArgs[0] === "number") {
          const port = bindArgs[0];
          let address = activeBindAddress;
          let cb = undefined;
          
          if (typeof bindArgs[1] === "string") {
            // Some modules might bind to localhost explicitly, but we want to force our bind.
            // Wait, forcing localhost to VPN interface breaks local IPC!
            // We should only force bind if it's binding to 0.0.0.0 or if it's leaving the host.
            // But usually BitTorrent sockets just bind to port 0.
            if (bindArgs[1] === "0.0.0.0" || bindArgs[1] === "::") {
              address = activeBindAddress;
            } else {
              address = bindArgs[1];
            }
            cb = bindArgs[2];
          } else if (typeof bindArgs[1] === "function") {
            cb = bindArgs[1];
          }

          bindArgs = cb ? [port, address, cb] : [port, address];
        } else if (bindArgs.length === 0 || (bindArgs.length === 1 && typeof bindArgs[0] === "function")) {
          // Binding to random port
          const cb = bindArgs[0];
          bindArgs = cb ? [0, activeBindAddress, cb] : [0, activeBindAddress];
        }
        return (originalBind as any).apply(this, bindArgs);
      };
    }
    return socket;
  };
}
