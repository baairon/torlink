<p align="center">
  <img src="preview/splash.svg" alt="klink, curated torrents straight from your terminal" style="max-width: 832px; width: 100%; height: auto;">
</p>

# Klink

Finding a torrent these days sucks. One site is a minefield of fake download buttons. Another hides the real link under a popup that spawns two more tabs. And after all that, half the results are dead, zero seeders.

**Klink** is a sleek torrent finder and downloader that lives in your terminal, with zero setup and nothing to configure. One search checks a short, curated list of reputable sources at once, and whatever you pick downloads straight to your computer.

> **Note**: Klink is an enhanced fork of [torlink](https://github.com/baairon/torlink) featuring advanced TUI capabilities, live peer inspection, media streaming, bandwidth throttling, and physical file organisation.

---

## ⚡ What makes Klink different (Fork Features)

Klink expands on upstream torlink with key power-user features:

- 🔒 **Klink branding**: Renamed from torlink with an 8-bit padlock identity and multi-colour terminal logo (silver shackle, gold body, red K, purple gradient wordmark).
- 🔍 **Peer Inspector Pane**: Press `b` on an active download to view live swarm peer connections, IP addresses, client software strings, and individual peer transfer rates.
- 🐢 **Turtle Mode (Bandwidth Throttling)**: Toggle global download and upload speed limits on the fly with a single keypress (`b`) for low-bandwidth or shared network environments.
- 📁 **File Inspection & Selective Download**: Inspect multi-file torrent contents before or during download, view nested file trees, and toggle individual files on or off.
- ℹ️ **Metadata Inspector**: View detailed metadata (like plot summaries, tracklists, or release notes) for a torrent before downloading.
- 📻 **RSS Auto-Downloader**: A background daemon for subscribing to RSS feeds and automatically downloading new items as they are released.
- ⚙️ **Advanced Search Filtering**: Filter and refine search results by properties like seeders, size, and category.
- ⏯️ **Sequential Downloading**: Toggle sequential block downloading to prioritise early pieces, enabling immediate playback of media.
- 🌐 **Network Interface Binding**: Force all torrent traffic through a specific network interface (like a VPN tunnel) to prevent IP leaks.
- 🎬 **Direct Media Streaming & Themed Web UI**: Stream video files directly over HTTP while downloading (`klink serve` / `klink files`), with an integrated web interface featuring a dark/light theme switcher.
- ✅ **Completed Tab & Smart File Organisation**: Cleanly separate active downloads, seeding items, and finished downloads with directory routing.
- ⚠️ **Action Confirmation Dialogs**: Safety confirmation prompts before destructive actions like cancelling downloads or clearing history to prevent accidental data loss.
- 📥 **Drag-and-Drop & Clipboard `.torrent` Support**: Drop a `.torrent` file directly onto the terminal or paste its path/URI into the search bar to enqueue it instantly.
- 📡 **Private Tracker Announce Preservation**: Intact tracker list and passkey preservation when loading `.torrent` files.
- ✨ **High-Contrast UI Row Highlights**: Full-row active bolding and dimming across all columns in Results, Downloads, and Seeding views.
- 🔧 **WebTorrent stability patch**: Guards against a null-pointer crash in `_request` introduced in webtorrent 3.x, keeping the daemon stable under heavy peer churn.

---

## Get started

**Requires Node.js 26 or later** — download it from [nodejs.org](https://nodejs.org).

```sh
npx klink
```

That's the only thing you'll type. Klink opens straight to a search bar: search for what you want, paste in a magnet link or a bare infohash, drop a `.torrent` file onto the window, or just press Enter on an empty box to browse the curated library. From there it's all keypresses, nothing to memorise, and `?` brings up the full list anytime.

## Finding something

Type what you're looking for and press Enter. Results stream in from every source as they answer, tagged with size and how many people are sharing each one, so you can see what'll come down fast. Arrow to what you want and press `d` to save it, or `shift+d` to pick a different folder for just that download.

<p align="center">
  <img src="preview/browse.svg" alt="klink's browse view: the sidebar, the search bar, and merged results from every source" style="max-width: 832px; width: 100%; height: auto;">
</p>

## Your downloads

Active downloads sit up top with their progress, speed, and time left; when one finishes it drops into Recently downloaded just below, so the list stays tidy. Everything's still there when you come back, and anything interrupted picks up where it left off.

Downloads run in the background while you keep searching, so you can queue up as many as you want. They save to your downloads folder, and the Downloads pane keeps tabs on each one; press `o` anytime to change where that is, or grab one result with `shift+d` to send it somewhere else without touching the default. When something finishes it keeps seeding automatically so the next person can find it too, and the Seeding tab lets you pause or stop that anytime.

<p align="center">
  <img src="preview/downloads.svg" alt="klink's Downloads pane: live progress on top, recently downloaded below" style="max-width: 832px; width: 100%; height: auto;">
</p>

## What it searches

A short, hand-picked list of trusted sources:

| Category | Sources |
| --- | --- |
| Games | FitGirl |
| Movies | YTS, The Pirate Bay, 1337x, BitTorrented |
| TV | EZTV, The Pirate Bay, 1337x, BitTorrented |
| Anime | Nyaa, SubsPlease |
| E-Books | The Pirate Bay, 1337x, BitTorrented |
| Audiobooks | The Pirate Bay, 1337x, BitTorrented |

Games are the only category that can run code, so they come from FitGirl alone, a repacker with a long, trusted track record; everything else is plain video and subtitles. If a source is down, the search carries on without it, and Klink tells you which one is offline.

## Headless

Klink also runs without the TUI, for servers and seedboxes:

    klink watch <dir>    download anything dropped into a folder
    klink serve          take magnets over HTTP and host themed web player
    klink files          stream finished downloads over HTTP
    klink attach         keep the TUI alive across ssh sessions

Add `--daemon` to keep watch, serve, or files running after you log out; `klink --help` has the full list of modes and flags.

## Contributing

To run or work on Klink locally:

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
   npx klink
   ```
4. Run tests and type-checks before opening a PR:
   ```sh
   npm run typecheck
   npm run test
   ```

Before opening a PR, skim [CONTRIBUTING.md](CONTRIBUTING.md); it lays out the bar with examples from real merged PRs.

## Differences from upstream torlink

| Feature | torlink (upstream) | Klink (this fork) |
| --- | --- | --- |
| Name / branding | torlink | **Klink** with 8-bit padlock logo |
| Node.js requirement | ≥ 18 | **≥ 26** |
| Peer Inspector | ❌ | ✅ |
| Turtle Mode | ❌ | ✅ |
| File Inspection | ❌ | ✅ |
| Metadata Inspector | ❌ | ✅ |
| RSS Auto-Downloader | ❌ | ✅ |
| Advanced Search Filtering | ❌ | ✅ |
| Sequential Downloading | ❌ | ✅ |
| Network Interface Binding | ❌ | ✅ |
| Media Streaming | ❌ | ✅ |
| Completion Tab | ❌ | ✅ |
| Confirmation Dialogs | ❌ | ✅ |
| Expanded Categories (E-Books & Audiobooks) | ❌ | ✅ |
| WebTorrent null-ref patch | ❌ | ✅ |

## Privacy

Your files stay on your disk, and nothing routes through a central server; Klink only talks to the torrent network directly. Once a download finishes it keeps seeding by default, sharing it back so the next person can find it just as easily. The network only works because people pass things along, and even a few minutes makes a real difference. If you'd rather not, opt out anytime: open the Seeding tab, press `p` to pause or stop any item, and press it again to pick it back up. Always your call.
