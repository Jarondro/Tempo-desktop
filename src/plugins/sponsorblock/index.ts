import is from 'electron-is';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { sortSegments } from './segments';

import type { Segment, SkipSegment } from './types';
import type { GetPlayerResponse } from '@/types/get-player-response';

export type SponsorBlockPluginConfig = {
  enabled: boolean;
  apiURL: string;
  categories: (
    | 'sponsor'
    | 'intro'
    | 'outro'
    | 'interaction'
    | 'selfpromo'
    | 'music_offtopic'
  )[];
};

let currentSegments: Segment[] = [];
let attachedVideo: HTMLVideoElement | null = null;

const detachVideoListeners = (
  video: HTMLVideoElement | null,
  onTimeUpdate: (e: Event) => void,
  onEmptied: () => void,
) => {
  if (!video) return;
  video.removeEventListener('timeupdate', onTimeUpdate);
  video.removeEventListener('emptied', onEmptied);
};

const attachVideoListeners = (
  video: HTMLVideoElement | null,
  onTimeUpdate: (e: Event) => void,
  onEmptied: () => void,
) => {
  if (!video || attachedVideo === video) return;
  detachVideoListeners(attachedVideo, onTimeUpdate, onEmptied);
  attachedVideo = video;
  video.addEventListener('timeupdate', onTimeUpdate);
  // Reset segments on song end
  video.addEventListener('emptied', onEmptied);
};

export default createPlugin({
  name: () => t('plugins.sponsorblock.name'),
  description: () => t('plugins.sponsorblock.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    apiURL: 'https://sponsor.ajay.app',
    categories: [
      'sponsor',
      'intro',
      'outro',
      'interaction',
      'selfpromo',
      'music_offtopic',
    ],
  } as SponsorBlockPluginConfig,
  async backend({ getConfig, ipc }) {
    let activeController: AbortController | null = null;
    let latestRequestId = 0;

    const fetchSegments = async (
      apiURL: string,
      categories: string[],
      videoId: string,
      signal: AbortSignal,
    ) => {
      const sponsorBlockURL = `${apiURL}/api/skipSegments?videoID=${encodeURIComponent(
        videoId,
      )}&categories=${encodeURIComponent(JSON.stringify(categories))}`;
      try {
        const resp = await fetch(sponsorBlockURL, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          redirect: 'follow',
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        });
        if (resp.status !== 200) {
          return [];
        }

        const segments = (await resp.json()) as SkipSegment[];
        return sortSegments(segments.map((submission) => submission.segment));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return [];
        }
        if (is.dev()) {
          console.log('error on sponsorblock request:', error);
        }

        return [];
      }
    };

    const config = await getConfig();

    const { apiURL, categories } = config;

    ipc.on('peard:video-src-changed', async (data: GetPlayerResponse) => {
      activeController?.abort();
      const requestId = ++latestRequestId;
      // Clear previous track segments immediately so fast skips do not seek in the new track.
      ipc.send('sponsorblock-skip', []);

      const videoId = data?.videoDetails?.videoId;
      if (!videoId) return;

      const controller = new AbortController();
      activeController = controller;
      const segments = await fetchSegments(
        apiURL,
        categories,
        videoId,
        controller.signal,
      );
      if (requestId === latestRequestId) {
        ipc.send('sponsorblock-skip', segments);
      }
    });
  },
  renderer: {
    timeUpdateListener: (e: Event) => {
      if (e.target instanceof HTMLVideoElement) {
        const target = e.target;

        for (const segment of currentSegments) {
          if (
            target.currentTime >= segment[0] &&
            target.currentTime < segment[1]
          ) {
            const seekTarget = Number.isFinite(target.duration)
              ? Math.min(segment[1], target.duration)
              : segment[1];
            target.currentTime = seekTarget;
            if (window.electronIs.dev()) {
              console.log('SponsorBlock: skipping segment', segment);
            }
          }
        }
      }
    },
    resetSegments: () => (currentSegments = []),
    start({ ipc }) {
      ipc.on('sponsorblock-skip', (segments: Segment[]) => {
        currentSegments = segments;
      });
      attachVideoListeners(
        document.querySelector<HTMLVideoElement>('video'),
        this.timeUpdateListener,
        this.resetSegments,
      );
    },
    onPlayerApiReady() {
      attachVideoListeners(
        document.querySelector<HTMLVideoElement>('video'),
        this.timeUpdateListener,
        this.resetSegments,
      );
    },
    stop() {
      const video =
        attachedVideo ?? document.querySelector<HTMLVideoElement>('video');
      attachedVideo = null;
      currentSegments = [];
      detachVideoListeners(video, this.timeUpdateListener, this.resetSegments);
    },
  },
});
