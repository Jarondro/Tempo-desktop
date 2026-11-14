# Tempo Desktop

Unofficial Windows x64 fork of [Pear Desktop](https://github.com/pear-devs/pear-desktop), based on revision `3337446`.

Tempo uses its own Electron profile. Sign-in and playback are handled by the YouTube Music web app inside the window. Pear Desktop components remain licensed under the [MIT License](license).

## Customizations

- The **Settings** button below Library opens Tempo's in-app settings panel with active plugins and app options. You can also open it by dragging the sidebar slider onto Settings or pressing `Ctrl+,`.
- Edit [src/tempo-theme.css](src/tempo-theme.css) to customize default colors and styles (theme palette variables are grouped at the top of the file).
- The segmented sidebar slider (Apple-style pill with click and drag support) is implemented in [src/tempo-sidebar-slider.ts](src/tempo-sidebar-slider.ts).
- Custom CSS themes can also be loaded from **Options → Visual Tweaks → Themes** inside the app (menu labels adapt to the active app language).
- Under **View → App Icon**, you can switch between the **Tempo**, **Spotify**, and **YouTube Music** icons for the window, taskbar, and Start Menu shortcut. The embedded executable icon is generated from `assets/icon.svg`.

## Building on Windows

Use Node.js 22 or newer and pnpm 11 or newer.

```powershell
pnpm install --frozen-lockfile
pnpm dist:win:dir
```

Spotify mode on Windows x64 uses Microsoft Edge WebView2. The Spotify button in the YouTube Music left sidebar opens the official Spotify Web Player inside the Tempo window with its own local WebView2 profile directory. The return icon next to Home in Spotify switches back to YouTube Music. Microsoft Edge WebView2 Runtime is included on Windows 11 and also available standalone from Microsoft.

The unpacked executable is output to `pack/win-unpacked/Tempo Desktop.exe`. When moving the unpacked build, keep all files and subfolders in `win-unpacked` together.
