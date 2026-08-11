# Torlink for Windows

Torlink is a simple desktop app for searching and managing BitTorrent downloads. Search from one screen, monitor download progress clearly, and choose exactly where your files are saved.

> Use Torlink only for files you are legally allowed to download and share.

## Download and run

1. Download `Torlink 1.6.0.exe` from the latest GitHub Release.
2. Double-click the file to open Torlink.
3. If Windows SmartScreen appears, choose **More info** then **Run anyway** only when you trust the release source.

Torlink is portable: it does not need Node.js, npm, PowerShell, or an installer. It supports 64-bit Windows.

## First-time setup

1. Open **Settings**.
2. Under **Default download folder**, choose **Browse…** or enter a folder such as `E:\Torrents`.
3. Choose **Save folder**.

Every new download will use that folder unless you change it later.

## How to use it

1. Open **Search**.
2. Enter a title, keyword, magnet link, or torrent info hash.
3. Review each result’s source, size, and availability.
4. Choose **Download**.
5. Open **Downloads** to monitor progress, pause a transfer, or resume it later.

## Network access and Windows Security

When a download first starts, Windows may ask whether Torlink can use private networks. Torlink uses peer-to-peer connections to download and share torrent data.

- On a personal PC, allow access only if you trust the app and your network.
- On an organisation-managed PC, the **Allow** option may be disabled. Choose **Cancel**.
- Downloads may still work through outgoing connections, but could be slower or show fewer peers.
- If downloads remain at `0 peers`, ask the network administrator about the organisation's policy for peer-to-peer traffic.

The temporary path shown in the Windows message is normal for the portable version of Torlink.
'@ | Add-Content "C:\Users\steve\Documents\Torlink\README.md"

## Screenshot

Add your screenshot as `docs/screenshot.png`.

![Torlink desktop app](docs/screenshot.png)

## Build from source

Requires Node.js 22 or later.

```powershell
npm install
npm run gui
```

Create the portable Windows app:

```powershell
npm run package:win
```

The finished `.exe` is placed in the `release` folder.



## Releases

Keep generated `.exe` files out of normal Git commits. Create a GitHub Release and upload the `.exe` as a release asset for people to download.

## Credits

This desktop interface builds on [baairon/torlink](https://github.com/baairon/torlink), which provides the underlying torrent search and download functionality.

## License

This project retains the upstream MIT license. See [LICENSE](LICENSE).