import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { app, dialog, type BrowserWindow } from 'electron';

import * as config from '@/config';

const spotifyBackdrop = `
  :root[data-tempo-spotify] body { background: #131315 !important; }
  :root[data-tempo-spotify] ytmusic-app { opacity: 0 !important; }
`;

function installSpotifyButtons(icon: string) {
  const addButtons = () => {
    for (const section of document.querySelectorAll(
      'ytmusic-guide-section-renderer[is-primary]',
    )) {
      if (section.querySelector(':scope > .tempo-spotify-button')) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tempo-spotify-button';
      button.title = 'Spotify';
      const image = document.createElement('img');
      image.src = icon;
      image.alt = '';
      const label = document.createElement('span');
      label.textContent = 'Spotify';
      button.append(image, label);
      button.addEventListener('click', () => {
        window.ipcRenderer.send('tempo:show-spotify');
      });
      section.append(button);
    }
  };
  addButtons();
  new MutationObserver(addButtons).observe(document.body, {
    childList: true,
    subtree: true,
  });
}

export function setupSpotifyMode(win: BrowserWindow, useInlineMenu: boolean) {
  if (process.platform !== 'win32' || process.arch !== 'x64') return;

  const hostDir = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'spotify-host')
    : path.join(app.getAppPath(), 'assets', 'spotify-host');
  let icon: string;
  try {
    icon = 'data:image/png;base64,' + readFileSync(path.join(hostDir, 'spotify.png')).toString('base64');
  } catch {
    return;
  }

  const contents = win.webContents;
  const musicOrigin = 'https://music.youtube.com';
  const isMusic = (url: string) => URL.parse(url)?.origin === musicOrigin;
  const hidesOnClose = Boolean(config.get('options.tray'));
  let spotify: ChildProcessWithoutNullStreams | undefined;
  let isClosing = false;

  const syncSpotifyWindow = () => {
    if (spotify?.stdin.writable) spotify.stdin.write('focus\n');
  };
  const showSpotifyBackdrop = (visible: boolean) => contents.executeJavaScript(
    `document.documentElement.toggleAttribute('data-tempo-spotify', ${visible}); void 0`,
  ).catch(console.error);
  const pauseYouTubeVideo = () => contents.executeJavaScript(
    "document.querySelector('ytmusic-player video')?.pause(); void 0",
  ).catch(console.error);
  const markClosingOnQuit = () => {
    isClosing = true;
  };
  app.on('before-quit', markClosingOnQuit);
  win.on('close', () => {
    // Only preserve Spotify mode on genuine close/quit, not tray-hide.
    if (!hidesOnClose) isClosing = true;
  });
  for (const event of ['show', 'hide', 'minimize', 'restore', 'focus'] as const) {
    (win as NodeJS.EventEmitter).on(event, syncSpotifyWindow);
  }

  contents.on('did-finish-load', () => {
    if (isMusic(contents.getURL())) {
      contents.insertCSS(spotifyBackdrop, { cssOrigin: 'user' })
        .then(() => showSpotifyBackdrop(Boolean(spotify)))
        .catch(console.error);
      contents.executeJavaScript(
        `(${installSpotifyButtons.toString()})(${JSON.stringify(icon)})`,
      ).catch(console.error);
      if (spotify) {
        pauseYouTubeVideo();
      }
    }
  });
  contents.on('media-started-playing', () => {
    if (spotify) {
      pauseYouTubeVideo();
    }
  });

  const startSpotify = () => {
    if (spotify || win.isDestroyed() || contents.isDestroyed()) return;

    const handle = win.getNativeWindowHandle().readBigUInt64LE().toString();
    const header = useInlineMenu ? Math.floor(32 * contents.getZoomFactor()) : 0;
    // Keep the YouTube Music renderer and its navigation state behind Spotify.
    const child = spawn(path.join(hostDir, 'SpotifyHost.exe'), [
      handle, path.join(app.getPath('userData'), 'SpotifyProfile'), String(header),
    ], { windowsHide: true });
    spotify = child;
    config.set('options.lastMode', 'spotify');
    const previousMute = contents.isAudioMuted();
    contents.setAudioMuted(true);
    if (contents.getURL()) {
      showSpotifyBackdrop(true);
      pauseYouTubeVideo();
    }

    child.stdout.resume();
    child.stdin.on('error', () => {});
    child.stderr.on('data', (chunk: Buffer) => console.error('Tempo Spotify:', chunk.toString().trim()));

    const cleanup = (failed: boolean) => {
      if (spotify !== child) return;
      spotify = undefined;
      if (isClosing || win.isDestroyed() || contents.isDestroyed()) return;
      config.set('options.lastMode', 'youtube-music');
      showSpotifyBackdrop(false);
      contents.setAudioMuted(previousMute);
      if (failed) {
        dialog.showMessageBox(win, {
          type: 'error',
          message: 'Režim Spotify se nepodařilo spustit.',
          buttons: ['OK'],
        }).catch(console.error);
      } else if (win.isFocused()) {
        contents.focus();
      }
    };
    child.once('error', (error) => {
      console.error('Tempo Spotify:', error);
      cleanup(true);
    });
    child.once('exit', (code) => cleanup(code !== 0));
  };

  contents.ipc.on('tempo:show-spotify', (event) => {
    if (spotify || !event.senderFrame || event.senderFrame.parent
      || !isMusic(event.senderFrame.url)) return;
    startSpotify();
  });

  win.once('closed', () => {
    isClosing = true;
    app.off('before-quit', markClosingOnQuit);
    spotify?.stdin.end();
  });

  if (config.get('options.lastMode') === 'spotify') {
    startSpotify();
  }
}
