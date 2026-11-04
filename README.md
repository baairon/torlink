<p align="center">
  <img src="https://git.bairon.dev/baairon/torlink/raw/branch/main/preview/splash.svg" alt="torlink, curated torrents straight from your terminal" style="max-width: 832px; width: 100%; height: auto;">
</p>

Finding a torrent these days sucks. One site is a minefield of fake download buttons. Another hides the real link under a popup that spawns two more tabs. And after all that, half the results are dead, zero seeders.

torlink is a torrent finder that lives in your terminal, with zero setup and nothing to configure. One search checks a short, curated list of reputable sources at once, and whatever you pick downloads straight to your computer. The files are yours, saved to your downloads folder.

## Get started

1. **Install Node** (from [nodejs.org](https://nodejs.org)), it's all torlink needs.
2. **Open your terminal.**
3. **Start it:**

   ```sh
   npx torlnk
   ```

That's the only thing you'll type. torlink opens straight to a search bar: search for what you want, paste in a magnet link or a bare infohash, drag a `.torrent` file from your file manager onto the window, or just press Enter on an empty box to browse the curated library. From there it's all keypresses, nothing to memorize, and `?` brings up the full list anytime.

## Finding something

Type what you're looking for and press Enter. Results stream in from every source as they answer, tagged with size and how many people are sharing each one, so you can see what'll come down fast. Arrow to a result and press `d` to save it, or press space on several rows and then `d` to download them together. `shift+d` picks a folder for the current result or marked batch.

<p align="center">
  <img src="https://git.bairon.dev/baairon/torlink/raw/branch/main/preview/browse.svg?v=1.10.0" alt="torlink's browse view with two results marked for a batch download" style="max-width: 832px; width: 100%; height: auto;">
</p>

## Your downloads

Active downloads sit up top with their progress, speed, and time left; when one finishes it drops into Recently downloaded just below, so the list stays tidy. Everything's still there when you come back, and anything interrupted picks up where it left off.

Downloads run in the background while you keep searching, so you can queue up as many as you want. They save to your downloads folder, and the Downloads pane keeps tabs on each one; press `o` anytime to change where that is, or use `shift+d` to send a result or marked batch somewhere else without changing the default. When something finishes it keeps seeding automatically so the next person can find it too, and the Seeding tab lets you pause or stop that anytime.

<p align="center">
  <img src="https://git.bairon.dev/baairon/torlink/raw/branch/main/preview/downloads.svg?v=1.10.0" alt="torlink's Downloads pane: live progress on top, recently downloaded below" style="max-width: 832px; width: 100%; height: auto;">
</p>

When a download comes with several videos or tracks, torlink drops a `playlist.m3u` into each folder holding more than one, so a course split into modules plays straight through in order. Run `torlnk --no-playlist` if you'd rather it didn't.

## What it searches

A short, hand-picked list of trusted sources:

| Category | Sources |
| --- | --- |
| Games | FitGirl |
| Movies | YTS, The Pirate Bay, BitTorrented |
| TV | EZTV, The Pirate Bay, BitTorrented |
| Anime | Nyaa, SubsPlease |

Games are the only category that can run code, so they come from FitGirl alone, a repacker with a long, trusted track record; everything else is plain video and subtitles. If a source is down, the search carries on without it, and torlink tells you which one is offline.

## Headless

torlink also runs without the TUI, for servers and seedboxes:

    torlnk search "<query>" [--category games|movies|tv|anime]
                            print one JSON document of merged search results
    torlnk seed <path>    share files you already have
    torlnk watch <dir>    download anything dropped into a folder
    torlnk serve          take magnets over HTTP
    torlnk files          stream finished downloads over HTTP
    torlnk attach         keep the TUI alive across ssh sessions

Add `--daemon` to keep seed, watch, serve, or files running after you log out; `torlnk --help` has the full list of modes and flags.

### Sharing something of your own

Everything else starts with a torrent someone else made. `seed` goes the other way:

    torlnk seed ./album

It turns the folder into a torrent, saves `album.torrent` next to it, prints the magnet, and starts sharing right away. Send anyone the magnet and they pull the files from you.

### Driving it over HTTP

`serve` takes a magnet or a `.torrent` you already have:

    POST /add {"magnet":"magnet:?xt=..."}
    POST /add {"torrent":"<base64>"}

Either can carry a `seedTime` for that one torrent, in the same grammar as `--seed-time` (`"30d"`, `"2h"`; `0` means never stop). It wins over the daemon-wide flag, so a box that normally drops seeds after a couple of hours can keep one release alive for a month. Change it later, or on something already downloading, through the control endpoint; `GET /downloads` reports the limit and when it falls due (`seedUntil`):

    POST /control {"id":"<info hash>","action":"seed-time","seedTime":"30d"}

### Binding to a VPN or interface

If torrents should only ever leave through one interface, name it:

    torlnk serve --interface wg0 --peer-port 51413

Every peer, tracker, DHT and search socket is bound to that interface's IPv4 address, and the fixed peer port is the one to forward. If the interface drops, downloads and seeds pause instead of taking another route, and pick up on their own when it is back. The same flags work on `watch`, `seed` and the TUI, or as `TORLINK_INTERFACE`, `TORLINK_PEER_PORT` and `TORLINK_DHT_PORT`, with nothing new on screen. `serve` reports the state on `GET /network` and takes changes on `POST /network` without a restart. torlink knows nothing about any particular VPN, only the interface; `torlnk --help` has the details and limits.

## Contributing

To run or work on torlink locally:

1. Clone the repository and open the folder.
2. Install dependencies:
   ```sh
   npm install
   ```
3. Run the development version:
   ```sh
   npm run dev
   ```
   Or build it and run the bundled version:
   ```sh
   npm run build
   npx torlnk
   ```

Before opening a PR, skim [CONTRIBUTING.md](CONTRIBUTING.md); it lays out the bar with examples from real merged PRs.

## Privacy

Your files stay on your disk, and nothing routes through a central server; torlink only talks to the torrent network directly. Once a download finishes it keeps seeding by default, sharing it back so the next person can find it just as easily. The network only works because people pass things along, and even a few minutes makes a real difference. If you'd rather not, opt out anytime: open the Seeding tab, press `p` to pause or stop any item, and press it again to pick it back up. Always your call.
