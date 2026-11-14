import { t as i18t } from '@/i18n';

type AvMode = 'song' | 'video';

interface PlayerVideoDetails {
  videoId?: string;
  musicVideoType?: string;
  thumbnail?: {
    thumbnails?: Array<{ url?: string; width?: number }>;
  };
}

interface MoviePlayerElement extends HTMLElement {
  getPlayerResponse?: () => { videoDetails?: PlayerVideoDetails } | undefined;
}

interface AvToggleElement extends HTMLElement {
  selectedItemHasVideo?: boolean;
  toggleDisabled?: boolean;
}

interface QueueCounterpartItem {
  counterpartRenderer?: {
    playlistPanelVideoRenderer?: {
      videoId?: string;
    };
  };
}

interface QueuePanelVideoWrapper {
  primaryRenderer?: {
    playlistPanelVideoRenderer?: {
      videoId?: string;
    };
  };
  counterpart?: QueueCounterpartItem[];
}

interface QueuePanelItem {
  playlistPanelVideoWrapperRenderer?: QueuePanelVideoWrapper;
}

interface YtMusicPlayerPageElement extends HTMLElement {
  watchNextResponse?: {
    contents?: {
      singleColumnMusicWatchNextResultsRenderer?: {
        tabbedRenderer?: {
          watchNextTabbedResultsRenderer?: {
            tabs?: Array<{
              tabRenderer?: {
                content?: {
                  musicQueueRenderer?: {
                    content?: {
                      playlistPanelRenderer?: {
                        contents?: QueuePanelItem[];
                      };
                    };
                  };
                };
              };
            }>;
          };
        };
      };
    };
  };
}

interface YtMusicAppElement extends HTMLElement {
  store?: {
    getState?: () => {
      queue?: {
        items?: QueuePanelItem[];
      };
    };
  };
}

function hasTruthyAttr(el: HTMLElement | null, name: string): boolean {
  if (!el?.hasAttribute(name)) return false;
  const val = el.getAttribute(name);
  return val === '' || val === 'true' || val === name;
}

function wrapperMatchesVideo(
  wrapper: QueuePanelVideoWrapper,
  videoId: string,
): boolean {
  if (wrapper.primaryRenderer?.playlistPanelVideoRenderer?.videoId === videoId) {
    return true;
  }
  return Boolean(
    wrapper.counterpart?.some(
      (item) =>
        item?.counterpartRenderer?.playlistPanelVideoRenderer?.videoId === videoId,
    ),
  );
}

function listHasCounterpart(
  items: QueuePanelItem[] | undefined,
  videoId?: string,
): boolean {
  if (!Array.isArray(items) || items.length === 0) return false;
  for (const item of items) {
    const wrapper = item?.playlistPanelVideoWrapperRenderer;
    if (!wrapper?.counterpart?.length) continue;
    if (!videoId || wrapperMatchesVideo(wrapper, videoId)) {
      return true;
    }
  }
  return false;
}

function hasQueueCounterpart(videoId?: string): boolean {
  const playerPage =
    document.querySelector<YtMusicPlayerPageElement>('ytmusic-player-page');
  const tabs =
    playerPage?.watchNextResponse?.contents
      ?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
      ?.watchNextTabbedResultsRenderer?.tabs;
  if (Array.isArray(tabs)) {
    for (const tab of tabs) {
      const contents =
        tab?.tabRenderer?.content?.musicQueueRenderer?.content
          ?.playlistPanelRenderer?.contents;
      if (listHasCounterpart(contents, videoId)) {
        return true;
      }
    }
  }

  const app = document.querySelector<YtMusicAppElement>('ytmusic-app');
  const queueItems = app?.store?.getState?.()?.queue?.items;
  return listHasCounterpart(queueItems, videoId);
}

const TOGGLE_CLASS = 'tempo-av-toggle';
const BAR_SELECTOR =
  'ytmusic-app-layout > :is(ytmusic-player-bar, ytmusic-miniplayer)[data-tempo-player], ' +
  'ytmusic-app-layout > :is(ytmusic-player-bar, ytmusic-miniplayer:has(> .ytMusicMiniPlayerMiddleSection))';

function safeTranslate(key: string, fallback: string): string {
  try {
    const translated = i18t(key);
    return translated && translated !== key ? translated : fallback;
  } catch {
    return fallback;
  }
}

function getActiveBar(): HTMLElement | null {
  return document.querySelector<HTMLElement>(BAR_SELECTOR);
}

function getMountPoint(bar: HTMLElement): {
  container: HTMLElement;
  anchor: HTMLElement | null;
  beforeEl: Element | null;
} | null {
  if (bar.tagName === 'YTMUSIC-MINIPLAYER') {
    const container = bar.querySelector<HTMLElement>(
      ':scope > .ytMusicMiniPlayerRightSection',
    );
    if (!container) return null;
    const anchor = container.querySelector<HTMLElement>(
      ':scope > .ytMusicMiniPlayerActionBar',
    );
    const beforeEl = container.querySelector(
      ':scope > .ytMusicMiniPlayerVolumeWrapper, :scope > .ytMusicMiniPlayerMenuButton',
    );
    return { container, anchor, beforeEl };
  }

  const container = bar.querySelector<HTMLElement>(':scope > .right-controls');
  if (!container) return null;
  return {
    container,
    anchor: null,
    beforeEl: container.firstElementChild,
  };
}

function ensureSongImageSrc(moviePlayer: MoviePlayerElement | null) {
  const img = document.querySelector<HTMLImageElement>(
    '#song-image #img, #song-image img',
  );
  if (!img) return;
  const currentSrc = img.getAttribute('src') || '';
  if (currentSrc && !currentSrc.startsWith('data:')) return;

  const thumbs = moviePlayer?.getPlayerResponse?.()?.videoDetails?.thumbnail?.thumbnails;
  const bestThumb = thumbs?.[thumbs.length - 1]?.url;
  if (bestThumb) {
    img.src = bestThumb;
  }
}

export function mountTempoAvToggle() {
  const toggle = document.createElement('div');
  toggle.className = TOGGLE_CLASS;
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Song or video mode');

  const slider = document.createElement('span');
  slider.className = 'tempo-av-toggle-slider';
  slider.setAttribute('aria-hidden', 'true');

  const songBtn = document.createElement('button');
  songBtn.type = 'button';
  songBtn.className = 'tempo-av-toggle-btn';
  songBtn.dataset.mode = 'song';

  const videoBtn = document.createElement('button');
  videoBtn.type = 'button';
  videoBtn.className = 'tempo-av-toggle-btn';
  videoBtn.dataset.mode = 'video';

  toggle.append(slider, songBtn, videoBtn);

  let preferredMode: AvMode | null = null;
  let lastVideoId: string | undefined;
  let internalNativeClick = false;
  let suppressNextClick = false;
  let syncFrame: number | null = null;
  let observedAvToggle: Element | null = null;
  let observedPlayer: Element | null = null;
  let observedCustomSwitch: Element | null = null;
  let observedContainer: Element | null = null;

  let gesture:
    | {
        pointerId: number;
        startX: number;
        startProgress: number;
        dragging: boolean;
      }
    | undefined;

  const stopBarBubble = (event: Event) => {
    event.stopPropagation();
  };

  const setAttrIfChanged = (el: Element, name: string, value: string) => {
    if (el.getAttribute(name) !== value) {
      el.setAttribute(name, value);
    }
  };

  const readState = () => {
    const avToggle = document.querySelector<AvToggleElement>('ytmusic-av-toggle');
    const player = document.querySelector<HTMLElement>('ytmusic-player');
    const moviePlayer = document.querySelector<MoviePlayerElement>('#movie_player');
    const songVideo = document.querySelector<HTMLElement>('#song-video.ytmusic-player');
    const customCheckbox = document.querySelector<HTMLInputElement>(
      '#ytmd-video-toggle-switch-button-container .video-switch-button-checkbox',
    );
    const customMode =
      document.body.classList.contains('video-toggle-custom-mode') &&
      Boolean(customCheckbox);
    const forceHide = document.body.classList.contains('video-toggle-force-hide');

    const details = moviePlayer?.getPlayerResponse?.()?.videoDetails;
    const videoId = details?.videoId;
    const videoType = details?.musicVideoType;

    const hasTrack = Boolean(
      player?.hasAttribute('playable') ||
        avToggle?.hasAttribute('playback-mode') ||
        videoId,
    );

    const hasPairedVideo = Boolean(
      hasTruthyAttr(avToggle, 'selected-item-has-video') ||
        avToggle?.selectedItemHasVideo ||
        hasQueueCounterpart(videoId),
    );
    const hasVideo =
      hasPairedVideo ||
      Boolean(videoType && videoType !== 'MUSIC_VIDEO_TYPE_ATV');
    const canSelectVideo = hasVideo && !forceHide;

    let mode: AvMode;
    if (!canSelectVideo) {
      mode = 'song';
    } else if (customMode && customCheckbox) {
      mode = customCheckbox.checked ? 'video' : 'song';
    } else if (hasPairedVideo && avToggle) {
      const avPlaybackMode =
        avToggle.getAttribute('playback-mode') ??
        player?.getAttribute('playback-mode');
      if (
        hasTruthyAttr(avToggle, 'is-video-playback-mode-selected') ||
        avPlaybackMode === 'OMV_PREFERRED'
      ) {
        mode = 'video';
      } else if (
        hasTruthyAttr(avToggle, 'is-audio-playback-mode-selected') ||
        avPlaybackMode === 'ATV_PREFERRED'
      ) {
        mode = 'song';
      } else {
        mode = videoType === 'MUSIC_VIDEO_TYPE_ATV' ? 'song' : 'video';
      }
    } else if (
      player?.getAttribute('data-tempo-av-mode') === 'song' ||
      songVideo?.style.display === 'none' ||
      (player?.getAttribute('playback-mode') ??
        avToggle?.getAttribute('playback-mode')) === 'ATV_PREFERRED'
    ) {
      mode = 'song';
    } else {
      mode = videoType === 'MUSIC_VIDEO_TYPE_ATV' ? 'song' : 'video';
    }

    const songLabel =
      avToggle?.querySelector('.song-button')?.textContent?.trim() ||
      avToggle?.getAttribute('song-audio-label')?.trim() ||
      safeTranslate('plugins.video-toggle.templates.button-song', 'Song');
    const videoLabel =
      avToggle?.querySelector('.video-button')?.textContent?.trim() ||
      safeTranslate('plugins.video-toggle.templates.button-video', 'Video');

    return {
      avToggle,
      player,
      moviePlayer,
      customCheckbox,
      customMode,
      forceHide,
      hasTrack,
      hasPairedVideo,
      canSelectVideo,
      mode,
      videoId,
      songLabel,
      videoLabel,
    };
  };

  const applyMode = (target: AvMode, fromUser: boolean) => {
    const state = readState();
    if (fromUser) {
      preferredMode = target;
    }
    if (target === 'video' && !state.canSelectVideo) return;

    if (state.customMode && state.customCheckbox) {
      if (state.customCheckbox.checked !== (target === 'video')) {
        state.customCheckbox.click();
      }
      scheduleSync();
      return;
    }

    const { avToggle, player, moviePlayer, hasPairedVideo } = state;
    // Enabling has-av-switcher on ytmusic-player (without ytmusic-player-page) lets
    // Polymer swap #song-video/#song-image without revealing a duplicate #av-id bar.
    player?.setAttribute('has-av-switcher', '');
    if (state.canSelectVideo && avToggle) {
      avToggle.removeAttribute('toggle-disabled');
      avToggle.toggleDisabled = false;
    }

    const nativeBtn = avToggle?.querySelector<HTMLButtonElement>(
      target === 'song' ? '.song-button' : '.video-button',
    );
    if (nativeBtn) {
      internalNativeClick = true;
      try {
        nativeBtn.click();
      } finally {
        internalNativeClick = false;
      }
    }

    const playbackMode = target === 'song' ? 'ATV_PREFERRED' : 'OMV_PREFERRED';
    if (!nativeBtn) {
      avToggle?.setAttribute('playback-mode', playbackMode);
    }
    if (!nativeBtn || !hasPairedVideo) {
      player?.setAttribute('playback-mode', playbackMode);
    }

    if (target === 'song' && (!nativeBtn || !hasPairedVideo)) {
      player?.setAttribute('data-tempo-av-mode', 'song');
      ensureSongImageSrc(moviePlayer);
    } else {
      player?.removeAttribute('data-tempo-av-mode');
    }

    scheduleSync();
  };

  const ensureMounted = () => {
    const bar = getActiveBar();
    if (!bar) {
      if (toggle.isConnected) toggle.remove();
      return;
    }
    const target = getMountPoint(bar);
    if (!target) return;

    const { container, anchor, beforeEl } = target;
    if (anchor) {
      if (toggle.parentElement !== container || toggle.previousElementSibling !== anchor) {
        anchor.insertAdjacentElement('afterend', toggle);
      }
      return;
    }

    if (toggle.parentElement !== container) {
      if (beforeEl && beforeEl.parentElement === container) {
        container.insertBefore(toggle, beforeEl);
      } else {
        container.append(toggle);
      }
    }
  };

  const refreshTargetObservers = (
    avToggle: HTMLElement | null,
    player: HTMLElement | null,
  ) => {
    const customSwitch = document.querySelector(
      '#ytmd-video-toggle-switch-button-container',
    );

    if (avToggle && avToggle !== observedAvToggle) {
      observedAvToggle = avToggle;
      stateObserver.observe(avToggle, {
        attributes: true,
        attributeFilter: [
          'playback-mode',
          'selected-item-has-video',
          'song-audio-label',
          'toggle-disabled',
          'is-audio-playback-mode-selected',
          'is-video-playback-mode-selected',
        ],
      });
    }
    if (player && player !== observedPlayer) {
      observedPlayer = player;
      stateObserver.observe(player, {
        attributes: true,
        attributeFilter: [
          'playback-mode',
          'playable',
          'data-tempo-av-mode',
          'video-mode',
        ],
      });
    }
    if (customSwitch && customSwitch !== observedCustomSwitch) {
      observedCustomSwitch = customSwitch;
      stateObserver.observe(customSwitch, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    }

    const bar = getActiveBar();
    const mount = bar ? getMountPoint(bar) : null;
    if (mount && mount.container !== observedContainer) {
      observedContainer = mount.container;
      stateObserver.observe(mount.container, { childList: true });
    }
  };

  const sync = () => {
    syncFrame = null;
    ensureMounted();

    const state = readState();
    refreshTargetObservers(state.avToggle, state.player);

    if (state.videoId && state.videoId !== lastVideoId) {
      lastVideoId = state.videoId;
      if (
        !state.customMode &&
        preferredMode === 'song' &&
        state.canSelectVideo &&
        state.mode !== 'song'
      ) {
        applyMode('song', false);
        return;
      }
    }

    if (
      (!state.canSelectVideo || state.hasPairedVideo) &&
      state.player?.hasAttribute('data-tempo-av-mode')
    ) {
      state.player.removeAttribute('data-tempo-av-mode');
    }

    if (state.mode === 'song' && state.hasTrack) {
      ensureSongImageSrc(state.moviePlayer);
    }

    toggle.hidden = !state.hasTrack;
    if (songBtn.textContent !== state.songLabel) {
      songBtn.textContent = state.songLabel;
    }
    if (videoBtn.textContent !== state.videoLabel) {
      videoBtn.textContent = state.videoLabel;
    }

    setAttrIfChanged(toggle, 'data-mode', state.mode);
    setAttrIfChanged(
      toggle,
      'data-video-available',
      state.canSelectVideo ? 'true' : 'false',
    );
    setAttrIfChanged(
      songBtn,
      'aria-pressed',
      state.mode === 'song' ? 'true' : 'false',
    );
    setAttrIfChanged(
      videoBtn,
      'aria-pressed',
      state.mode === 'video' ? 'true' : 'false',
    );
    videoBtn.disabled = !state.canSelectVideo;

    if (!gesture?.dragging) {
      toggle.style.setProperty('--tempo-av-pos', state.mode === 'video' ? '1' : '0');
    }
  };

  const scheduleSync = () => {
    if (syncFrame !== null) return;
    syncFrame = requestAnimationFrame(sync);
  };

  // Dragging across the capsule lets users slide the active pill continuously between Song and Video.
  toggle.addEventListener('pointerdown', (event) => {
    stopBarBubble(event);
    if (event.button !== 0 || gesture) return;
    const state = readState();
    if (!state.canSelectVideo || !state.hasTrack) return;

    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startProgress: state.mode === 'video' ? 1 : 0,
      dragging: false,
    };
    suppressNextClick = false;
  });

  window.addEventListener('pointermove', (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    if (!gesture.dragging && Math.abs(dx) < 4) return;

    if (!gesture.dragging) {
      gesture.dragging = true;
      toggle.setAttribute('data-dragging', 'true');
      try {
        toggle.setPointerCapture(event.pointerId);
      } catch {
        // Window pointer listeners still track drag completion if capture fails.
      }
    }

    const halfWidth = Math.max(24, toggle.getBoundingClientRect().width / 2);
    const isRtl = getComputedStyle(toggle).direction === 'rtl';
    const delta = (isRtl ? -dx : dx) / halfWidth;
    const nextProgress = Math.max(0, Math.min(1, gesture.startProgress + delta));
    toggle.style.setProperty('--tempo-av-pos', String(nextProgress));
  });

  const finishGesture = (event: PointerEvent, commit: boolean) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const { dragging } = gesture;
    gesture = undefined;
    if (!dragging) return;

    toggle.removeAttribute('data-dragging');
    const currentPos = Number.parseFloat(
      toggle.style.getPropertyValue('--tempo-av-pos') || '0',
    );
    suppressNextClick = true;
    setTimeout(() => {
      suppressNextClick = false;
    }, 0);

    if (commit) {
      applyMode(currentPos >= 0.5 ? 'video' : 'song', true);
    } else {
      sync();
    }
  };

  window.addEventListener('pointerup', (event) => finishGesture(event, true));
  window.addEventListener('pointercancel', (event) => finishGesture(event, false));

  toggle.addEventListener('click', (event) => {
    stopBarBubble(event);
    if (suppressNextClick && event.detail !== 0) {
      event.preventDefault();
      return;
    }
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
      '.tempo-av-toggle-btn',
    );
    const targetMode = button?.dataset.mode as AvMode | undefined;
    if (!targetMode) return;
    applyMode(targetMode, true);
  });

  // Sync if the user clicks YouTube Music's own #av-id buttons or the video-toggle plugin switch.
  document.addEventListener(
    'click',
    (event) => {
      if (internalNativeClick) return;
      const target = event.target as Element | null;
      if (target?.closest('ytmusic-av-toggle .song-button')) {
        preferredMode = 'song';
        document
          .querySelector('ytmusic-player')
          ?.setAttribute('data-tempo-av-mode', 'song');
        scheduleSync();
      } else if (target?.closest('ytmusic-av-toggle .video-button')) {
        preferredMode = 'video';
        document
          .querySelector('ytmusic-player')
          ?.removeAttribute('data-tempo-av-mode');
        scheduleSync();
      } else if (target?.closest('.video-switch-button-checkbox')) {
        scheduleSync();
      }
    },
    true,
  );

  const stateObserver = new MutationObserver(scheduleSync);
  const layout = document.querySelector('ytmusic-app-layout') ?? document.body;
  stateObserver.observe(layout, { childList: true, subtree: false });
  stateObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });

  // Watch layout descendants until both the active player bar and ytmusic-av-toggle mount.
  const mountDiscoveryObserver = new MutationObserver(() => {
    scheduleSync();
    if (observedAvToggle && observedPlayer && observedContainer?.isConnected) {
      mountDiscoveryObserver.disconnect();
    }
  });
  mountDiscoveryObserver.observe(layout, { childList: true, subtree: true });

  document.addEventListener('loadedmetadata', scheduleSync, true);
  document.addEventListener('peard:src-changed', scheduleSync, true);
  window.addEventListener('yt-navigate-finish', scheduleSync);
  sync();
}
