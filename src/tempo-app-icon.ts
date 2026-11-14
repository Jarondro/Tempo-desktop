import path from 'node:path';

import { app, shell, type BrowserWindow } from 'electron';
import is from 'electron-is';

import * as config from '@/config';
import { APPLICATION_NAME } from '@/i18n';
import { isTesting } from '@/utils/testing';

export const appIconChoices = ['tempo', 'spotify', 'youtube-music'] as const;
export type AppIconChoice = (typeof appIconChoices)[number];

const windowsAppId = 'local.tempo.desktop';

export function getAppIconChoice(): AppIconChoice {
  const choice = config.get('options.appIcon');
  return appIconChoices.includes(choice) ? choice : 'tempo';
}

export function getAppIconPath(choice = getAppIconChoice()) {
  const assets = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets')
    : path.join(app.getAppPath(), 'assets');

  if (process.platform !== 'win32') return path.join(assets, 'icon.png');
  return choice === 'tempo'
    ? path.join(assets, 'generated', 'icons', 'win', 'icon.ico')
    : path.join(assets, 'app-icons', `${choice}.ico`);
}

export function registerWindowsShortcut(choice = getAppIconChoice()) {
  if (process.platform !== 'win32') return;

  const target = process.execPath;
  const appData = app.getPath('appData');
  if (
    is.dev() ||
    isTesting() ||
    target.startsWith(path.join(appData, '..', 'Local', 'Temp'))
  )
    return;

  const shortcutPath = path.join(
    appData,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    `${APPLICATION_NAME}.lnk`,
  );
  const icon = getAppIconPath(choice);
  try {
    const shortcut = shell.readShortcutLink(shortcutPath);
    if (
      shortcut.target === target &&
      shortcut.appUserModelId === windowsAppId
    ) {
      if (shortcut.icon !== icon || shortcut.iconIndex !== 0) {
        shell.writeShortcutLink(shortcutPath, 'update', {
          target,
          icon,
          iconIndex: 0,
        });
      }
      return;
    }
  } catch {
    // The shortcut does not exist yet.
  }
  shell.writeShortcutLink(shortcutPath, {
    target,
    cwd: path.dirname(target),
    description: APPLICATION_NAME,
    appUserModelId: windowsAppId,
    icon,
    iconIndex: 0,
  });
}

export function initializeAppIcon() {
  if (process.platform !== 'win32') return;
  app.setAppUserModelId(windowsAppId);
  registerWindowsShortcut();
}

export function applyWindowIcon(
  win: BrowserWindow,
  choice = getAppIconChoice(),
) {
  if (process.platform !== 'win32') return;
  const icon = getAppIconPath(choice);
  win.setIcon(icon);
  win.setAppDetails({
    appId: windowsAppId,
    appIconPath: icon,
    relaunchCommand: `"${process.execPath}"`,
    relaunchDisplayName: APPLICATION_NAME,
  });
}
