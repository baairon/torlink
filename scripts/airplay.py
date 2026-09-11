#!/usr/bin/env python3
"""AirPlay helper for torlnk: scan for Apple TVs and cast a URL.

Shells out from Node (players.ts) the same way vlc/mpv are spawned.
Uses the pyatv library directly since the atvremote CLI is broken on
Python 3.14. Requires pyatv 0.18.x + the pyatv_compat shim from the iptv
project for tvOS 26 AirPlay v2 protocol support.

Usage:
  python airplay.py scan          # print "id\tname" lines for each Apple TV
  python airplay.py play <id> <url>  # cast URL to the named Apple TV
"""
import asyncio
import sys
import os

# The pyatv_compat shim lives in the iptv project; add it to the path if available.
# Without it, play_url fails on tvOS 26 (AirPlay v2 protocol changed).
_COMPAT_DIR = os.environ.get("TORLINK_PYATV_COMPAT_DIR", "")
if _COMPAT_DIR:
    sys.path.insert(0, _COMPAT_DIR)


async def scan(loop):
    import pyatv
    devs = await pyatv.scan(loop)
    for d in devs:
        os_name = getattr(d.device_info.operating_system, "name", "")
        if os_name == "TvOS":
            print(f"{d.identifier}\t{d.name}")


async def play(loop, device_id, url):
    import pyatv
    from pyatv.storage.file_storage import FileStorage

    devs = await pyatv.scan(loop)
    config = next((d for d in devs if d.identifier == device_id), None)
    if not config:
        print(f"Device {device_id} not found", file=sys.stderr)
        sys.exit(1)

    storage = FileStorage.default_storage(loop)
    await storage.load()

    restore = None
    try:
        # Install the compat shim if available (tvOS 26 AirPlay v2 support).
        try:
            from pyatv_compat import install
            restore = install(pyatv)
        except ImportError:
            pass

        atv = await pyatv.connect(config, loop, storage=storage)
        await atv.stream.play_url(url, position=0)
        # Keep alive briefly so the AirPlay session doesn't tear down immediately.
        await asyncio.sleep(2)
        atv.close()
    finally:
        if restore:
            restore()


def main():
    if len(sys.argv) < 2:
        print("Usage: airplay.py scan | play <id> <url>", file=sys.stderr)
        sys.exit(1)

    loop = asyncio.new_event_loop()
    try:
        if sys.argv[1] == "scan":
            loop.run_until_complete(scan(loop))
        elif sys.argv[1] == "play" and len(sys.argv) == 4:
            loop.run_until_complete(play(loop, sys.argv[2], sys.argv[3]))
        else:
            print("Usage: airplay.py scan | play <id> <url>", file=sys.stderr)
            sys.exit(1)
    finally:
        loop.close()


if __name__ == "__main__":
    main()