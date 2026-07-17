<p align="center">
  <img src="preview/splash.svg" alt="torlink, curated torrents straight from your terminal" style="max-width: 832px; width: 100%; height: auto;">
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

That's the only thing you'll type. torlink opens straight to a search bar: search for what you want, paste in a magnet link or a bare infohash, or just press Enter on an empty box to browse the curated library. From there it's all keypresses, nothing to memorize, and `?` brings up the full list anytime.

## Finding something

Type what you're looking for and press Enter. Results stream in from every source as they answer, tagged with size and how many people are sharing each one, so you can see what'll come down fast. Arrow to what you want and press `d` to save it, or `shift+d` to pick a different folder for just that download.

<p align="center">
  <img src="preview/browse.svg" alt="torlink's browse view: the sidebar, the search bar, and merged results from every source" style="max-width: 832px; width: 100%; height: auto;">
</p>

## Your downloads

Active downloads sit up top with their progress, speed, and time left; when one finishes it drops into Recently downloaded just below, so the list stays tidy. Everything's still there when you come back, and anything interrupted picks up where it left off.

Downloads run in the background while you keep searching, so you can queue up as many as you want. They save to your downloads folder, and the Downloads pane keeps tabs on each one; press `o` anytime to change where that is, or grab one result with `shift+d` to send it somewhere else without touching the default. When something finishes it keeps seeding automatically so the next person can find it too, and the Seeding tab lets you pause or stop that anytime.

<p align="center">
  <img src="preview/downloads.svg" alt="torlink's Downloads pane: live progress on top, recently downloaded below" style="max-width: 832px; width: 100%; height: auto;">
</p>

## What it searches

A short, hand-picked list of trusted sources:

| Category | Sources |
| --- | --- |
| Games | FitGirl |
| Movies | YTS, The Pirate Bay, 1337x, BitTorrented |
| TV | EZTV, The Pirate Bay, 1337x, BitTorrented |
| Anime | Nyaa, SubsPlease |

Games are the only category that can run code, so they come from FitGirl alone, a repacker with a long, trusted track record; everything else is plain video and subtitles. If a source is down, the search carries on without it, and torlink tells you which one is offline.

## Headless

torlink also runs without the TUI, for servers and seedboxes:

    torlnk watch <dir>    download anything dropped into a folder
    torlnk serve          take magnets over HTTP
    torlnk files          stream finished downloads over HTTP
    torlnk attach         keep the TUI alive across ssh sessions

Add `--daemon` to keep watch, serve, or files running after you log out; `torlnk --help` has the full list of modes and flags.

Set `TORLINK_MAX_DOWNLOADS=N` to cap how many torrents download at once — handy on a bandwidth-limited seedbox so each active download gets a fair share instead of splitting the pipe across everything. Extra torrents wait as `queued` and start automatically as slots free (oldest first). Unset or `0` means unlimited (the default). Seeding is unaffected.

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

## Star History

<a href="https://www.star-history.com/?repos=baairon%2Ftorlink&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=baairon/torlink&type=date&theme=dark&legend=top-left&sealed_token=6RClUrW7A_foMjVMW-jdJ_bLj-wl8jtLiajry7T0uQ2F-UraDTQq4-n_hj9rdxkfW9Iqxekmz3p9eNLNUgZM18i04-fIvEYFHl-lz90OrCT5hhglY_qgSKoYh3IanPSjj8nUgVIMAGg6ZtPucVGVu-aCYcFzE3aertjFE4CPRDrO9dNaJKRxPFTH0clL" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=baairon/torlink&type=date&legend=top-left&sealed_token=6RClUrW7A_foMjVMW-jdJ_bLj-wl8jtLiajry7T0uQ2F-UraDTQq4-n_hj9rdxkfW9Iqxekmz3p9eNLNUgZM18i04-fIvEYFHl-lz90OrCT5hhglY_qgSKoYh3IanPSjj8nUgVIMAGg6ZtPucVGVu-aCYcFzE3aertjFE4CPRDrO9dNaJKRxPFTH0clL" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=baairon/torlink&type=date&legend=top-left&sealed_token=6RClUrW7A_foMjVMW-jdJ_bLj-wl8jtLiajry7T0uQ2F-UraDTQq4-n_hj9rdxkfW9Iqxekmz3p9eNLNUgZM18i04-fIvEYFHl-lz90OrCT5hhglY_qgSKoYh3IanPSjj8nUgVIMAGg6ZtPucVGVu-aCYcFzE3aertjFE4CPRDrO9dNaJKRxPFTH0clL" />
 </picture>
</a>
