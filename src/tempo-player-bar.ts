interface ProgressSliderElement extends HTMLElement {
  value?: number;
  immediateValue?: number;
  noink?: boolean;
}

interface ScrubState {
  pointerId: number;
  offsetPx: number;
  ratio: number;
  startValue: number;
  moved: boolean;
}

function formatSeconds(seconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = String(wholeSeconds % 60).padStart(2, '0');
  return minutes < 60
    ? `${minutes}:${remainder}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`;
}

export function mountTempoPlayerBar() {
  let playerBar: HTMLElement | undefined;
  let time: HTMLElement | undefined;
  let progress: ProgressSliderElement | undefined;
  let scrubController: AbortController | undefined;
  let scrubState: ScrubState | undefined;
  let suppressNextClick = false;
  const elapsed = document.createElement('span');
  const duration = document.createElement('span');
  elapsed.className = 'tempo-player-elapsed';
  duration.className = 'tempo-player-duration';
  elapsed.setAttribute('aria-hidden', 'true');
  duration.setAttribute('aria-hidden', 'true');

  function getRange(bar: HTMLElement | undefined = progress) {
    const min = Number(bar?.getAttribute('aria-valuemin') ?? 0);
    const max = Number(bar?.getAttribute('aria-valuemax') ?? 0);
    const value = Number(bar?.getAttribute('aria-valuenow') ?? min);
    return { min, max, value };
  }

  function applyRatio(ratio: number, updateElapsed: boolean) {
    if (!progress) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    progress.style.setProperty('--tempo-played', `${clamped * 100}%`);
    if (updateElapsed) {
      const { min, max } = getRange(progress);
      if (max > min) {
        const target = Math.round(min + (clamped * (max - min)));
        elapsed.textContent = formatSeconds(target);
      }
    }
  }

  function updateTime() {
    const [current = '', total = ''] = time?.textContent?.trim().split(/\s*\/\s*/, 2) ?? [];
    if (duration.textContent !== total) duration.textContent = total;
    if (scrubState) return;
    const seconds = Number(progress?.getAttribute('aria-valuenow') ?? NaN);
    let position = current;
    if (Number.isFinite(seconds) && seconds >= 0 && /^\d+(?::\d{2}){1,2}$/.test(current)) {
      position = formatSeconds(seconds);
    }
    if (elapsed.textContent !== position) elapsed.textContent = position;
  }

  function updateProgress() {
    if (scrubState) return;
    const bar = progress;
    const { min, max, value } = getRange(bar);
    if (bar && max > min && Number.isFinite(value)) {
      applyRatio((value - min) / (max - min), false);
    } else {
      bar?.style.removeProperty('--tempo-played');
    }
  }

  function bindProgressScrub(bar: ProgressSliderElement) {
    scrubController?.abort();
    scrubController = new AbortController();
    const { signal } = scrubController;
    scrubState = undefined;
    bar.noink = true;
    bar.setAttribute('noink', '');
    bar.removeAttribute('data-tempo-scrubbing');

    const getTrackRect = () =>
      (bar.querySelector<HTMLElement>('#sliderContainer') ?? bar).getBoundingClientRect();

    const ratioFromClientX = (clientX: number, offsetPx: number) => {
      const rect = getTrackRect();
      if (rect.width <= 0) return 0;
      const isRtl = getComputedStyle(bar).direction === 'rtl';
      const x = clientX - offsetPx;
      const raw = isRtl ? (rect.right - x) / rect.width : (x - rect.left) / rect.width;
      return Math.max(0, Math.min(1, raw));
    };

    const endScrub = (commit: boolean) => {
      const state = scrubState;
      if (!state) return;
      scrubState = undefined;
      bar.removeAttribute('data-tempo-scrubbing');
      if (bar.hasPointerCapture?.(state.pointerId)) {
        try {
          bar.releasePointerCapture(state.pointerId);
        } catch {
          // Ignore if capture was already released.
        }
      }
      if (!commit) {
        updateTime();
        updateProgress();
        return;
      }

      const { min, max } = getRange(bar);
      if (max > min) {
        const target = Math.max(min, Math.min(max, Math.round(min + (state.ratio * (max - min)))));
        const nextRatio = (target - min) / (max - min);
        applyRatio(nextRatio, true);
        if (state.moved || target !== state.startValue) {
          bar.immediateValue = target;
          bar.value = target;
          bar.setAttribute('aria-valuenow', String(target));
          bar.dispatchEvent(new CustomEvent('change', { bubbles: true, composed: true }));
        }
      }
      updateTime();
      updateProgress();
    };

    bar.addEventListener('pointerdown', (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        bar.getAttribute('aria-disabled') === 'true' ||
        bar.hasAttribute('disabled') ||
        playerBar?.hasAttribute('player-fullscreened') ||
        playerBar?.closest('.pip')
      ) {
        return;
      }
      const { min, max, value } = getRange(bar);
      if (max <= min) return;
      const rect = getTrackRect();
      if (rect.width <= 0) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const startValue = Number.isFinite(value) ? value : min;
      const currentRatio = Math.max(0, Math.min(1, (startValue - min) / (max - min)));
      const isRtl = getComputedStyle(bar).direction === 'rtl';
      const dotX = isRtl
        ? rect.right - (currentRatio * rect.width)
        : rect.left + (currentRatio * rect.width);
      // Preserve grab offset when pressing directly on the dot so it glides without snapping.
      const offsetPx = Math.abs(event.clientX - dotX) <= 14 ? event.clientX - dotX : 0;
      const initialRatio = ratioFromClientX(event.clientX, offsetPx);

      scrubState = {
        pointerId: event.pointerId,
        offsetPx,
        ratio: initialRatio,
        startValue,
        moved: offsetPx === 0,
      };
      bar.setAttribute('data-tempo-scrubbing', '');
      try {
        bar.setPointerCapture?.(event.pointerId);
      } catch {
        // Ignore synthetic events without an active pointer capture target.
      }
      applyRatio(initialRatio, true);
    }, { capture: true, signal });

    bar.addEventListener('mousedown', (event: MouseEvent) => {
      if (scrubState) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture: true, signal });

    bar.addEventListener('click', (event: MouseEvent) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture: true, signal });

    bar.addEventListener('immediate-value-change', (event: Event) => {
      if (scrubState) event.stopImmediatePropagation();
    }, { capture: true, signal });

    window.addEventListener('pointermove', (event: PointerEvent) => {
      if (!scrubState || event.pointerId !== scrubState.pointerId) return;
      const nextRatio = ratioFromClientX(event.clientX, scrubState.offsetPx);
      if (Math.abs(nextRatio - scrubState.ratio) > 0.0005) {
        scrubState.moved = true;
      }
      scrubState.ratio = nextRatio;
      applyRatio(nextRatio, true);
    }, { capture: true, signal });

    window.addEventListener('pointerup', (event: PointerEvent) => {
      if (!scrubState || event.pointerId !== scrubState.pointerId) return;
      suppressNextClick = true;
      queueMicrotask(() => {
        suppressNextClick = false;
      });
      endScrub(true);
    }, { capture: true, signal });

    window.addEventListener('pointercancel', (event: PointerEvent) => {
      if (!scrubState || event.pointerId !== scrubState.pointerId) return;
      endScrub(false);
    }, { capture: true, signal });

    window.addEventListener('blur', () => {
      if (scrubState) endScrub(false);
    }, { signal });
  }

  const timeObserver = new MutationObserver(() => {
    updateTime();
    updateProgress();
  });
  function attach() {
    const bar = document.querySelector<HTMLElement>(
      'ytmusic-app-layout > ytmusic-player-bar:has(> .left-controls > .left-controls-buttons)',
    );
    const nextTime = bar?.querySelector<HTMLElement>('.time-info');
    const nextProgress = bar?.querySelector<ProgressSliderElement>('#progress-bar');
    if (!bar || !nextTime || !nextProgress) return;
    if (bar === playerBar && nextTime === time && nextProgress === progress && elapsed.parentElement === bar) return;

    playerBar?.removeAttribute('data-tempo-player');
    playerBar = bar;
    time = nextTime;
    progress = nextProgress;
    bindProgressScrub(progress);
    timeObserver.disconnect();
    timeObserver.observe(time, { childList: true, characterData: true, subtree: true });
    timeObserver.observe(progress, { attributes: true, attributeFilter: ['aria-valuemin', 'aria-valuemax', 'aria-valuenow'] });
    elapsed.dir = duration.dir = time.dir;
    updateTime();
    updateProgress();
    bar.append(elapsed, duration);
    bar.setAttribute('data-tempo-player', '');
  }

  attach();
  new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
}
