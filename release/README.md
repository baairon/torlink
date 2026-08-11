# Torlink for Windows

This folder is where the self-contained Windows release is created.

## Build the app

From the project folder, run:

```powershell
npm install
npm run package:win
```

The finished application will appear in this folder as `Torlink <version>.exe`.
It is a portable app: double-click it to run it; installation is not required.

## Put it on GitHub

Commit the source files and this README to the repository. Do not commit the
generated `.exe` to the normal source history: it is large and GitHub has a
100 MB file limit. Instead, create a GitHub Release and upload the `.exe` as a
release asset.
