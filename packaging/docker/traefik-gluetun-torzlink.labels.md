# Traefik labels for TorZlink when TORZLINK_NETWORK_MODE=vpn
#
# Paste these onto the **gluetun** service in your homelab compose (same pattern
# as qBittorrent's Host(`qbittorrent.lan`) → port 8081). TorZlink listens on 8787
# inside the shared network namespace.

```yaml
labels:
  # …existing qbittorrent / other labels…
  - "traefik.http.routers.torzlink.entrypoints=web"
  - "traefik.http.routers.torzlink.rule=Host(`torzlink.lan`)"
  - "traefik.http.routers.torzlink.service=torzlink-service"
  - "traefik.http.services.torzlink-service.loadbalancer.server.port=8787"
```

Also ensure Pi-hole (or your LAN DNS) resolves `torzlink.lan` to Traefik's LAN IP.
