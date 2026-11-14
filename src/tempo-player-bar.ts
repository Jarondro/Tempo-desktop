interface PaperSliderElement extends HTMLElement {
  value?: number;
  immediateValue?: number;
  noink?: boolean;
}

interface AttachedBar {
  root: HTMLElement;
  time: HTMLElement;
  progress: PaperSliderElement | HTMLInputElement;
  styleTarget: HTMLElement;
  trackContainer: HTMLElement;
  isRangeInput: boolean;
}

interface ScrubState {
  pointerId: number;
  offsetPx: number;
  ratio: number;
  startValue: number;
  moved: boolean;
}

const VALID_TIMESTAMP_RE = /^\d+(?::\d{2}){1,2}$/;

function formatSeconds(seconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = String(wholeSeconds % 60).padStart(2, '0');
  return minutes < 60
    ? `${minutes}:${remainder}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`;
}

function resolveBar(): AttachedBar | undefined {
  const classic = document.querySelector<HTMLElement>(
    'ytmusic-app-layout > ytmusic-player-bar:has(> .left-controls > .left-controls-buttons)',
  );
  if (classic) {
    const time = classic.querySelector<HTMLElement>('.time-info');
    const progress = classic.querySelector<PaperSliderElement>('#progress-bar');
    if (time && progress) {
      return {
        root: classic,
        time,
        progress,
        styleTarget: progress,
        trackContainer: progress.querySelector<HTMLElement>('#sliderContainer') ?? progress,
        isRangeInput: false,
      };
    }
  }

  const mini = document.querySelector<HTMLElement>(
    'ytmusic-app-layout > ytmusic-miniplayer:has(> .ytMusicMiniPlayerMiddleSection)',
  );
  if (mini) {
    const time = mini.querySelector<HTMLElement>('.ytMusicMiniPlayerTimeInfo');
    const progress = mini.querySelector<HTMLInputElement>('input.ytMusicMiniPlayerProgressBar');
    if (time && progress) {
      return {
        root: mini,
        time,
        progress,
        styleTarget: progress.parentElement ?? progress,
        trackContainer: progress,
        isRangeInput: true,
      };
    }
  }

  return undefined;
}

function readRange(bar: AttachedBar | undefined) {
  if (!bar) return { min: 0, max: 0, value: NaN };
  if (bar.isRangeInput) {
    const input = bar.progress as HTMLInputElement;
    const min = Number(input.min || 0);
    const max = Number(input.max || 0);
    const value = input.value === '' ? NaN : Number(input.value);
    return { min, max, value };
  }
  const min = Number(bar.progress.getAttribute('aria-valuemin') ?? 0);
  const max = Number(bar.progress.getAttribute('aria-valuemax') ?? 0);
  const rawValue = bar.progress.getAttribute('aria-valuenow');
  const value = rawValue === null ? NaN : Number(rawValue);
  return { min, max, value };
}

function commitSeek(bar: AttachedBar, target: number) {
  if (bar.isRangeInput) {
    const input = bar.progress as HTMLInputElement;
    input.value = String(target);
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return;
  }
  const slider = bar.progress as PaperSliderElement;
  slider.immediateValue = target;
  slider.value = target;
  slider.setAttribute('aria-valuenow', String(target));
  slider.dispatchEvent(new CustomEvent('change', { bubbles: true, composed: true }));
}

function isInteractionBlocked(bar: AttachedBar) {
  return (
    bar.progress.getAttribute('aria-disabled') === 'true' ||
    bar.progress.hasAttribute('disabled') ||
    bar.root.hasAttribute('player-fullscreened') ||
    bar.root.parentElement?.hasAttribute('player-fullscreened') ||
    Boolean(bar.root.closest('.pip'))
  );
}

export function mountTempoPlayerBar() {
  let currentBar: AttachedBar | undefined;
  let scrubController: AbortController | undefined;
  let scrubState: ScrubState | undefined;
  let suppressNextClick = false;
  let suppressClickTimer: number | undefined;
  const elapsed = document.createElement('span');
  const duration = document.createElement('span');
  elapsed.className = 'tempo-player-elapsed';
  duration.className = 'tempo-player-duration';
  elapsed.setAttribute('aria-hidden', 'true');
  duration.setAttribute('aria-hidden', 'true');

  function setScrubbing(bar: AttachedBar, active: boolean) {
    for (const target of [bar.progress, bar.styleTarget]) {
      if (active) target.setAttribute('data-tempo-scrubbing', '');
      else target.removeAttribute('data-tempo-scrubbing');
    }
  }

  function applyRatio(ratio: number, updateElapsed: boolean) {
    if (!currentBar) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    currentBar.styleTarget.style.setProperty('--tempo-played', `${clamped * 100}%`);
    if (updateElapsed) {
      const { min, max } = readRange(currentBar);
      if (max > min) {
        const target = Math.round(min + (clamped * (max - min)));
        elapsed.textContent = formatSeconds(target);
      }
    }
  }

  function updateTime() {
    const [current = '', total = ''] = currentBar?.time.textContent?.trim().split(/\s*\/\s*/, 2) ?? [];
    if (duration.textContent !== total) duration.textContent = total;
    if (scrubState || !currentBar) return;
    const { min, max, value } = readRange(currentBar);
    let position = current;
    if (max > min && Number.isFinite(value) && value >= 0 && VALID_TIMESTAMP_RE.test(current)) {
      position = formatSeconds(value);
    }
    if (elapsed.textContent !== position) elapsed.textContent = position;
  }

  function updateProgress() {
    if (scrubState || !currentBar) return;
    const { min, max, value } = readRange(currentBar);
    if (max > min && Number.isFinite(value)) {
      applyRatio((value - min) / (max - min), false);
    } else {
      currentBar.styleTarget.style.removeProperty('--tempo-played');
    }
  }

  function bindProgressScrub(bar: AttachedBar) {
    scrubController?.abort();
    scrubController = new AbortController();
    const { signal } = scrubController;
    const progressEl: HTMLElement = bar.progress;
    scrubState = undefined;
    if (!bar.isRangeInput) {
      const slider = bar.progress as PaperSliderElement;
      slider.noink = true;
      slider.setAttribute('noink', '');
    }
    setScrubbing(bar, false);

    const ratioFromClientX = (clientX: number, offsetPx: number) => {
      const rect = bar.trackContainer.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const isRtl = getComputedStyle(progressEl).direction === 'rtl';
      const x = clientX - offsetPx;
      const raw = isRtl ? (rect.right - x) / rect.width : (x - rect.left) / rect.width;
      return Math.max(0, Math.min(1, raw));
    };

    const endScrub = (commit: boolean) => {
      const state = scrubState;
      if (!state) return;
      scrubState = undefined;
      setScrubbing(bar, false);
      if (progressEl.hasPointerCapture?.(state.pointerId)) {
        try {
          progressEl.releasePointerCapture(state.pointerId);
        } catch {
          // Ignore if capture was already released.
        }
      }
      if (!commit) {
        updateTime();
        updateProgress();
        return;
      }

      const { min, max } = readRange(bar);
      if (max > min) {
        const target = Math.max(min, Math.min(max, Math.round(min + (state.ratio * (max - min)))));
        const nextRatio = (target - min) / (max - min);
        applyRatio(nextRatio, true);
        if (state.moved || target !== state.startValue) {
          commitSeek(bar, target);
        }
      }
      updateTime();
      updateProgress();
    };

    progressEl.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 || isInteractionBlocked(bar)) return;
      const { min, max, value } = readRange(bar);
      if (max <= min) return;
      const rect = bar.trackContainer.getBoundingClientRect();
      if (rect.width <= 0) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const startValue = Number.isFinite(value) ? value : min;
      const currentRatio = Math.max(0, Math.min(1, (startValue - min) / (max - min)));
      const isRtl = getComputedStyle(progressEl).direction === 'rtl';
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
      setScrubbing(bar, true);
      try {
        progressEl.setPointerCapture?.(event.pointerId);
      } catch {
        // Ignore synthetic events without an active pointer capture target.
      }
      applyRatio(initialRatio, true);
    }, { capture: true, signal });

    progressEl.addEventListener('mousedown', (event: MouseEvent) => {
      if (scrubState) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture: true, signal });

    progressEl.addEventListener('input', () => {
      if (!scrubState) {
        updateTime();
        updateProgress();
      }
    }, { signal });

    progressEl.addEventListener('change', () => {
      if (!scrubState) {
        updateTime();
        updateProgress();
      }
    }, { signal });

    bar.root.addEventListener('click', (event: MouseEvent) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        if (suppressClickTimer !== undefined) {
          clearTimeout(suppressClickTimer);
          suppressClickTimer = undefined;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture: true, signal });

    if (bar.isRangeInput) {
      bar.root
        .querySelector<HTMLElement>('.ytMusicMiniPlayerVolumePopup')
        ?.addEventListener('click', (event: MouseEvent) => event.stopPropagation(), { signal });
    }

    progressEl.addEventListener('immediate-value-change', (event: Event) => {
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
      if (suppressClickTimer !== undefined) clearTimeout(suppressClickTimer);
      suppressClickTimer = window.setTimeout(() => {
        suppressNextClick = false;
        suppressClickTimer = undefined;
      }, 0);
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

  function detach() {
    scrubController?.abort();
    scrubController = undefined;
    scrubState = undefined;
    suppressNextClick = false;
    if (suppressClickTimer !== undefined) {
      clearTimeout(suppressClickTimer);
      suppressClickTimer = undefined;
    }
    timeObserver.disconnect();
    if (currentBar) {
      setScrubbing(currentBar, false);
      currentBar.styleTarget.style.removeProperty('--tempo-played');
      currentBar.root.removeAttribute('data-tempo-player');
    }
    elapsed.remove();
    duration.remove();
    currentBar = undefined;
  }

  function attach() {
    const next = resolveBar();
    if (!next) {
      if (currentBar) detach();
      return;
    }
    if (
      currentBar &&
      currentBar.root === next.root &&
      currentBar.time === next.time &&
      currentBar.progress === next.progress &&
      currentBar.styleTarget === next.styleTarget &&
      elapsed.parentElement === next.root
    ) {
      return;
    }

    if (currentBar) detach();
    currentBar = next;
    bindProgressScrub(next);
    timeObserver.observe(next.time, { childList: true, characterData: true, subtree: true });
    timeObserver.observe(next.progress, {
      attributes: true,
      attributeFilter: next.isRangeInput
        ? ['min', 'max', 'aria-valuetext', 'style', 'disabled']
        : ['aria-valuemin', 'aria-valuemax', 'aria-valuenow'],
    });
    elapsed.dir = duration.dir = next.time.dir;
    updateTime();
    updateProgress();
    next.root.append(elapsed, duration);
    next.root.setAttribute('data-tempo-player', '');
  }

  attach();
  new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
}
