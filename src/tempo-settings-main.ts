import { Menu, type BrowserWindow, type MenuItem } from 'electron';

import type { SettingsItem } from './tempo-settings-menu';

function menuSnapshot(items: MenuItem[]): SettingsItem[] {
  return items.filter((item) => item.visible).map((item) => ({
    commandId: item.commandId,
    label: item.label,
    type: item.type,
    checked: item.type === 'checkbox' || item.type === 'radio' ? item.checked : false,
    enabled: item.enabled,
    description: item.toolTip || undefined,
    icon: item.icon && typeof item.icon === 'object' && !item.icon.isEmpty() ? item.icon.toDataURL() : undefined,
    children: menuSnapshot(item.submenu?.items ?? []),
  }));
}

function findCommand(items: MenuItem[], commandId: number): MenuItem | undefined {
  for (const item of items) {
    if (!item.enabled || !item.visible) continue;
    if (item.commandId === commandId) return item;
    const child = findCommand(item.submenu?.items ?? [], commandId);
    if (child) return child;
  }
  return undefined;
}

export function setupTempoSettings(win: BrowserWindow) {
  const { webContents } = win;
  const allowed = (event: Electron.IpcMainInvokeEvent) => {
    const frame = event.senderFrame;
    return frame && !frame.parent && URL.parse(frame.url)?.origin === 'https://music.youtube.com';
  };

  webContents.ipc.handle('tempo:settings-menu', (event) =>
    allowed(event) ? menuSnapshot(Menu.getApplicationMenu()?.items ?? []) : [],
  );
  webContents.ipc.handle('tempo:settings-command', async (event, commandId: number) => {
    if (!allowed(event) || !Number.isSafeInteger(commandId)) return;
    const item = findCommand(Menu.getApplicationMenu()?.items ?? [], commandId);
    if (item && ['normal', 'checkbox', 'radio'].includes(item.type)) {
      const invokeClick = item.click as (
        keyboardEvent: Electron.KeyboardEvent,
        focusedWindow?: BrowserWindow,
        focusedWebContents?: Electron.WebContents,
      ) => unknown;
      await invokeClick.call(item, {} as Electron.KeyboardEvent, win, webContents);
    }
  });
}
