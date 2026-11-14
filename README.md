# Tempo Desktop

A custom **YouTube Music** and **Spotify** desktop client for **Windows x64**, built on Electron and forked from [Pear Desktop](https://github.com/pear-devs/pear-desktop) (revision `3337446`) under the [MIT License](license).

> [!IMPORTANT]
> **Disclaimer:** This is an independent, unofficial open-source project and is not affiliated with, endorsed by, or connected to Google LLC, YouTube, or Spotify AB. Product names, logos, and trademarks belong to their respective owners and are used for identification purposes only. You use this software at your own risk.

---

## Features

- **Custom Player Layout:** Centered playback bar with smooth drag-and-scrub progress slider, draggable queue ordering, and segmented sidebar navigation slider.
- **Built-in Spotify Mode:** Switch between YouTube Music and the official Spotify Web Player inside the same window from the left sidebar (powered by Microsoft Edge WebView2 Runtime), with automatic restoration of the last used mode on startup.
- **Synced Lyrics:** Preconfigured with **LRCLib** (default) and **YTMusic** providers.
- **In-App Settings:** Open via the **Settings** button below Library or with `Ctrl+,`, including custom CSS theme loading and selectable app icons (`Tempo`, `Spotify`, `YouTube Music`).

---

## Download & Run (Windows x64)

Depending on the release format in **Releases**, choose one of the following:

- **`Tempo-Desktop-Portable-*-x64.exe`** — Single standalone executable that launches directly without installation.
- **`Tempo-Desktop-Setup-*-x64.exe`** — Standard Windows installer with Start Menu shortcut and uninstaller.
- **`Tempo-Desktop-win-x64.zip`** — Portable archive; extract the entire folder and run `Tempo Desktop.exe`.

> [!NOTE]
> **Windows Defender SmartScreen:** Executables are not signed with a commercial code-signing certificate. On first launch, Windows may display *"Windows protected your PC"* — click **More info → Run anyway**.

---

## Build from Source (Windows x64)

### Prerequisites
- **Node.js 22+** (Node 24 recommended)
- **pnpm 11+**
- **Windows 10 / 11 x64** (uses the built-in .NET Framework 4 `csc.exe` compiler to build `SpotifyHost.exe`; Spotify mode requires Microsoft Edge WebView2 Runtime)

### Commands

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck

# Unpacked folder build -> pack/win-unpacked/Tempo Desktop.exe
pnpm dist:win:dir

# Single executables for GitHub Releases -> pack/
pnpm dist:win:installer   # -> pack/Tempo-Desktop-Setup-0.0.1-x64.exe
pnpm dist:win:portable    # -> pack/Tempo-Desktop-Portable-0.0.1-x64.exe
pnpm dist:win             # -> both installer and portable executables
```

Additional implementation notes are available in [TEMPO.md](TEMPO.md).

---

## License

Based on **Pear Desktop** (`Copyright (c) th-ch`, https://github.com/pear-devs/pear-desktop) under the [MIT License](license).
On Windows, `SpotifyHost.exe` bundles Microsoft Edge WebView2 SDK assemblies (see `LICENSE-WebView2.txt` in the distribution package).
