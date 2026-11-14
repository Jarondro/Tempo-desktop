import type { InAppMenuConfig } from './constants';
import type { BackendContext } from '@/types/contexts';

export const onMainLoad = ({
  window: win,
  ipc: { handle, send },
}: BackendContext<InAppMenuConfig>) => {
  handle('window-is-maximized', () => win.isMaximized());

  handle('window-close', () => win.close());
  handle('window-minimize', () => win.minimize());
  handle('window-maximize', () => win.maximize());
  win.on('maximize', () => send('window-maximize'));
  handle('window-unmaximize', () => win.unmaximize());
  win.on('unmaximize', () => send('window-unmaximize'));

};
