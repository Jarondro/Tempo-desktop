import { contextBridge, webFrame, type BrowserWindow } from 'electron';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import {
  isBlockerEnabled,
  loadTrackerBlockerEngine,
  unloadTrackerBlockerEngine,
} from './blocker';
import { buildMainWorldScript, inject, isInjected } from './injectors/inject';
import injectCliqzPreload from './injectors/inject-cliqz-preload';
import style from './style.css?inline';
import { blockers } from './types';

export interface TrackerBlockerConfig {
  /**
   * Whether to enable the tracker blocker.
   * @default true
   */
  enabled: boolean;
  /**
   * When enabled, the tracker blocker will cache the blocklists.
   * @default true
   */
  cache: boolean;
  /**
   * Which tracker blocker to use.
   * @default blockers.InPlayer
   */
  blocker: (typeof blockers)[keyof typeof blockers];
  /**
   * Additional list of filters to use.
   * @example ["https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt"]
   * @default []
   */
  additionalBlockLists: string[];
  /**
   * Disable the default blocklists.
   * @default false
   */
  disableDefaultLists: boolean;
}

async function activateInPlayerBlocker() {
  if (!isInjected()) {
    inject(contextBridge);
  }
  await webFrame.executeJavaScript(buildMainWorldScript());
}

function createAdSkipper() {
  let adObserver: MutationObserver | null = null;
  let domObserver: MutationObserver | null = null;
  let observedPlayer: Element | null = null;
  let mutedByBlocker = false;
  let previouslyMuted = false;

  const restoreMute = () => {
    if (!mutedByBlocker) return;

    const root = observedPlayer ?? document;
    const video = root.querySelector<HTMLVideoElement>('video');
    if (video) {
      video.muted = previouslyMuted;
    }
    mutedByBlocker = false;
  };

  const handleAdState = (player: Element) => {
    const isAdShowing =
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting');

    if (!isAdShowing) {
      restoreMute();
      return;
    }

    const skipButton = player.querySelector<HTMLElement>(
      '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern',
    );
    skipButton?.click();

    const video = player.querySelector<HTMLVideoElement>('video');
    if (video) {
      if (!mutedByBlocker) {
        previouslyMuted = video.muted;
        mutedByBlocker = true;
      }
      video.muted = true;
      if (
        Number.isFinite(video.duration) &&
        video.duration > 0 &&
        video.currentTime < video.duration
      ) {
        video.currentTime = video.duration;
      }
    }
  };

  const attachPlayerObserver = () => {
    const player = document.querySelector('#movie_player');
    if (!player) return false;

    if (player === observedPlayer && adObserver) {
      handleAdState(player);
      return true;
    }

    adObserver?.disconnect();
    adObserver = new MutationObserver(() => {
      handleAdState(player);
    });
    adObserver.observe(player, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true,
    });
    observedPlayer = player;
    handleAdState(player);
    return true;
  };

  const disconnectDomObserver = () => {
    domObserver?.disconnect();
    domObserver = null;
  };

  return {
    start() {
      if (attachPlayerObserver()) return;

      const root = document.body || document.documentElement;
      if (!root) return;

      disconnectDomObserver();
      domObserver = new MutationObserver(() => {
        if (attachPlayerObserver()) {
          disconnectDomObserver();
        }
      });
      domObserver.observe(root, { childList: true, subtree: true });
    },
    onPlayerApiReady() {
      if (attachPlayerObserver()) {
        disconnectDomObserver();
      }
    },
    stop() {
      adObserver?.disconnect();
      adObserver = null;
      disconnectDomObserver();
      restoreMute();
      observedPlayer = null;
    },
  };
}

const adSkipper = createAdSkipper();

export default createPlugin({
  name: () => t('plugins.do-not-track.name'),
  restartNeeded: false,
  stylesheets: [style],
  config: {
    enabled: true,
    cache: true,
    blocker: blockers.InPlayer,
    additionalBlockLists: [],
    disableDefaultLists: false,
  } as TrackerBlockerConfig,
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.do-not-track.menu.blocker'),
        submenu: Object.values(blockers).map((blocker) => ({
          label: blocker,
          type: 'radio',
          checked: (config.blocker || blockers.InPlayer) === blocker,
          click() {
            setConfig({ blocker });
          },
        })),
      },
    ];
  },
  backend: {
    mainWindow: null as BrowserWindow | null,
    async start({ getConfig, window }) {
      const config = await getConfig();
      this.mainWindow = window;

      if (config.blocker === blockers.WithBlocklists) {
        await loadTrackerBlockerEngine(
          window.webContents.session,
          config.cache,
          config.additionalBlockLists,
          config.disableDefaultLists,
        );
      }
    },
    stop({ window }) {
      if (isBlockerEnabled(window.webContents.session)) {
        unloadTrackerBlockerEngine(window.webContents.session);
      }
    },
    async onConfigChange(newConfig) {
      if (!this.mainWindow) return;

      const session = this.mainWindow.webContents.session;
      const enabled = isBlockerEnabled(session);

      if (newConfig.blocker === blockers.WithBlocklists && !enabled) {
        await loadTrackerBlockerEngine(
          session,
          newConfig.cache,
          newConfig.additionalBlockLists,
          newConfig.disableDefaultLists,
        );
      } else if (newConfig.blocker !== blockers.WithBlocklists && enabled) {
        unloadTrackerBlockerEngine(session);
      }
    },
  },
  preload: {
    async start({ getConfig }) {
      const config = await getConfig();

      if (config.blocker === blockers.InPlayer) {
        await activateInPlayerBlocker();
      } else if (config.blocker === blockers.WithBlocklists) {
        await injectCliqzPreload();
      }
    },
    async stop() {
      await webFrame.executeJavaScript('window.__tempoAdblockActive = false; 0');
    },
    async onConfigChange(newConfig) {
      if (newConfig.blocker === blockers.InPlayer) {
        await activateInPlayerBlocker();
      } else if (newConfig.blocker === blockers.WithBlocklists) {
        await webFrame.executeJavaScript(
          'window.__tempoAdblockActive = false; 0',
        );
        await injectCliqzPreload();
      }
    },
  },
  renderer: {
    start() {
      adSkipper.start();
    },
    onPlayerApiReady() {
      adSkipper.onPlayerApiReady();
    },
    stop() {
      adSkipper.stop();
    },
  },
});
