const guideEntry = 'ytmusic-guide-entry-renderer[is-primary]';
const settingsEntry = '.tempo-settings-trigger';
const sliderEntry = `${guideEntry}, ${settingsEntry}`;

export function initTempoSidebarSlider(): void {
  const win = window as unknown as Record<string, unknown>;
  if (win.__tempoSidebarSliderInitialized) {
    if (typeof win.__tempoSidebarSliderRefresh === 'function') {
      (win.__tempoSidebarSliderRefresh as () => void)();
    }
    return;
  }
  win.__tempoSidebarSliderInitialized = true;

  interface EntryMetrics {
    entry: HTMLElement;
    paper: HTMLElement;
    x: number;
    y: number;
    width: number;
    height: number;
    centerY: number;
  }

  interface SectionState {
    section: HTMLElement;
    items: HTMLElement;
    hasMeasured: boolean;
    pointerId: number | null;
    isPressed: boolean;
    isDragging: boolean;
    startClientY: number;
    grabOffsetY: number;
    pressedIndex: number;
    targetIndex: number;
    activeIndex: number;
    holdTimer: number | null;
    optimisticEntry: HTMLElement | null;
    optimisticTimer: number | null;
    suppressClickUntil: number;
  }

  const states = new WeakMap<HTMLElement, SectionState>();
  const trackedSections = new Set<HTMLElement>();
  let isSynthesizingClick = false;

  function getVisibleEntries(items: HTMLElement): HTMLElement[] {
    const list = items.querySelectorAll<HTMLElement>(sliderEntry);
    const result: HTMLElement[] = [];
    for (const entry of list) {
      if (getComputedStyle(entry).display === 'none') continue;
      const rect = entry.getBoundingClientRect();
      if (rect.height > 0 || entry.offsetHeight > 0) {
        result.push(entry);
      }
    }
    return result;
  }

  function getMetricsList(
    items: HTMLElement,
    entries: HTMLElement[],
  ): EntryMetrics[] {
    const itemsRect = items.getBoundingClientRect();
    return entries.map((entry) => {
      const paper =
        entry.querySelector<HTMLElement>('tp-yt-paper-item') ?? entry;
      const paperRect = paper.getBoundingClientRect();
      let x: number;
      let y: number;
      let width = paperRect.width;
      let height = paperRect.height;
      if (itemsRect.width > 0 && paperRect.width > 0 && paperRect.height > 0) {
        x = paperRect.left - itemsRect.left;
        y = paperRect.top - itemsRect.top;
      } else {
        x = entry.offsetLeft + (paper === entry ? 0 : paper.offsetLeft);
        y = entry.offsetTop + (paper === entry ? 0 : paper.offsetTop);
        width = paper.offsetWidth || entry.offsetWidth;
        height = paper.offsetHeight || entry.offsetHeight;
      }
      return {
        entry,
        paper,
        x,
        y,
        width,
        height,
        centerY: y + (height / 2),
      };
    });
  }

  function findClosestIndex(metrics: EntryMetrics[], targetY: number): number {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < metrics.length; i++) {
      const dist = Math.abs(metrics[i].centerY - targetY);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function updateTargetAttribute(entries: HTMLElement[], targetIdx: number) {
    entries.forEach((entry, idx) => {
      if (idx === targetIdx) {
        entry.setAttribute('data-tempo-slider-target', 'true');
      } else {
        entry.removeAttribute('data-tempo-slider-target');
      }
    });
  }

  function clearOptimistic(state: SectionState) {
    if (state.optimisticTimer !== null) {
      window.clearTimeout(state.optimisticTimer);
      state.optimisticTimer = null;
    }
    if (state.optimisticEntry) {
      state.optimisticEntry.removeAttribute('data-tempo-optimistic-active');
      state.optimisticEntry = null;
    }
  }

  function setOptimistic(state: SectionState, entry: HTMLElement) {
    clearOptimistic(state);
    state.optimisticEntry = entry;
    entry.setAttribute('data-tempo-optimistic-active', 'true');
    state.optimisticTimer = window.setTimeout(() => {
      clearOptimistic(state);
      syncSection(state);
    }, 900);
  }

  function applyPillBox(
    state: SectionState,
    x: number,
    y: number,
    width: number,
    height: number,
    immediate = false,
  ) {
    const { section, items } = state;
    if (width <= 0 || height <= 0) return;
    const firstTime = !state.hasMeasured || immediate;
    if (firstTime) {
      section.setAttribute('data-tempo-slider-no-transition', 'true');
    }
    items.style.setProperty('--tempo-pill-x', `${Math.round(x * 10) / 10}px`);
    items.style.setProperty('--tempo-pill-y', `${Math.round(y * 10) / 10}px`);
    items.style.setProperty(
      '--tempo-pill-w',
      `${Math.round(width * 10) / 10}px`,
    );
    items.style.setProperty(
      '--tempo-pill-h',
      `${Math.round(height * 10) / 10}px`,
    );
    section.setAttribute('data-tempo-slider-ready', 'true');
    if (firstTime) {
      state.hasMeasured = true;
      requestAnimationFrame(() => {
        section.removeAttribute('data-tempo-slider-no-transition');
      });
    }
  }

  function syncSection(state: SectionState, immediate = false) {
    if (state.isPressed || state.isDragging) return;
    const entries = getVisibleEntries(state.items);
    if (!entries.length) return;
    const metrics = getMetricsList(state.items, entries);

    let activeIdx = entries.findIndex((entry) =>
      entry.matches(`${settingsEntry}[aria-expanded="true"]`),
    );
    if (activeIdx === -1 && state.optimisticEntry) {
      const realActive = entries.find((e) => e.hasAttribute('active'));
      if (realActive === state.optimisticEntry) {
        clearOptimistic(state);
      } else {
        activeIdx = entries.indexOf(state.optimisticEntry);
      }
    }
    if (activeIdx === -1) {
      activeIdx = entries.findIndex((e) => e.hasAttribute('active'));
    }
    if (activeIdx === -1) {
      activeIdx = entries.findIndex(
        (e) =>
          e
            .querySelector('tp-yt-paper-item')
            ?.getAttribute('aria-current') === 'true',
      );
    }
    if (activeIdx === -1) activeIdx = 0;

    state.activeIndex = activeIdx;
    state.targetIndex = activeIdx;
    updateTargetAttribute(entries, activeIdx);

    const target = metrics[activeIdx];
    if (target && target.width > 0 && target.height > 0) {
      applyPillBox(
        state,
        target.x,
        target.y,
        target.width,
        target.height,
        immediate,
      );
    }
  }

  function syncCounterpartOptimistic(
    sourceSection: HTMLElement,
    chosenIdx: number,
  ) {
    for (const section of trackedSections) {
      if (section === sourceSection) continue;
      const otherState = states.get(section);
      if (!otherState) continue;
      const entries = getVisibleEntries(otherState.items);
      const chosen = entries[chosenIdx];
      if (!chosen) continue;
      const metrics = getMetricsList(otherState.items, entries);
      const metric = metrics[chosenIdx];
      if (!metric) continue;
      updateTargetAttribute(entries, chosenIdx);
      setOptimistic(otherState, chosen);
      applyPillBox(
        otherState,
        metric.x,
        metric.y,
        metric.width,
        metric.height,
      );
    }
  }

  function activateEntry(entry: HTMLElement) {
    const ctrl = (
      entry as unknown as { polymerController?: { onTap?: () => void } }
    ).polymerController;
    if (ctrl && typeof ctrl.onTap === 'function') {
      ctrl.onTap();
      return;
    }
    const onTapSelf = (entry as unknown as { onTap?: () => void }).onTap;
    if (typeof onTapSelf === 'function') {
      onTapSelf.call(entry);
      return;
    }
    const paper =
      entry.querySelector<HTMLElement>('tp-yt-paper-item') ?? entry;
    isSynthesizingClick = true;
    try {
      paper.click();
    } finally {
      isSynthesizingClick = false;
    }
  }

  function setupSection(section: HTMLElement) {
    if (states.has(section)) {
      syncSection(states.get(section)!);
      return;
    }
    const items = section.querySelector<HTMLElement>('#items');
    if (!items) return;

    const state: SectionState = {
      section,
      items,
      hasMeasured: false,
      pointerId: null,
      isPressed: false,
      isDragging: false,
      startClientY: 0,
      grabOffsetY: 0,
      pressedIndex: 0,
      targetIndex: 0,
      activeIndex: 0,
      holdTimer: null,
      optimisticEntry: null,
      optimisticTimer: null,
      suppressClickUntil: 0,
    };

    states.set(section, state);
    trackedSections.add(section);

    section.addEventListener('dragstart', (event: DragEvent) => {
      event.preventDefault();
    });

    section.addEventListener(
      'click',
      (event: MouseEvent) => {
        if (isSynthesizingClick || event.detail === 0 || !items.contains(event.target as Node)) return;
        if (performance.now() < state.suppressClickUntil) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          state.suppressClickUntil = 0;
        }
      },
      true,
    );

    section.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 || !items.contains(event.target as Node)) return;
      const entries = getVisibleEntries(items);
      if (!entries.length) return;
      const metrics = getMetricsList(items, entries);
      if (!metrics.length || metrics[0].height <= 0) return;

      const itemsRect = items.getBoundingClientRect();
      if (
        event.clientY < itemsRect.top - 6 ||
        event.clientY > itemsRect.bottom + 6
      ) {
        return;
      }

      const pointerY = event.clientY - itemsRect.top;
      let pressedIdx = findClosestIndex(metrics, pointerY);
      const directEntry = (event.target as Element | null)?.closest<HTMLElement>(sliderEntry);
      if (directEntry) {
        const idx = entries.indexOf(directEntry);
        if (idx !== -1) pressedIdx = idx;
      }

      let activeIdx = entries.findIndex((e) => e.hasAttribute('active'));
      if (state.optimisticEntry) {
        const optIdx = entries.indexOf(state.optimisticEntry);
        if (optIdx !== -1) activeIdx = optIdx;
      }
      if (activeIdx === -1) activeIdx = 0;

      state.pointerId = event.pointerId;
      state.isPressed = true;
      state.isDragging = false;
      state.startClientY = event.clientY;
      state.pressedIndex = pressedIdx;
      state.activeIndex = activeIdx;
      state.targetIndex = pressedIdx;

      const baseMetric = metrics[pressedIdx];
      const rawOffset = pointerY - baseMetric.y;
      state.grabOffsetY = Math.max(
        6,
        Math.min(baseMetric.height - 6, rawOffset),
      );

      section.setAttribute('data-tempo-pressed', 'true');
      updateTargetAttribute(entries, pressedIdx);
      applyPillBox(
        state,
        baseMetric.x,
        baseMetric.y,
        baseMetric.width,
        baseMetric.height,
      );

      if (state.holdTimer !== null) window.clearTimeout(state.holdTimer);
      state.holdTimer = window.setTimeout(
        () => {
          if (
            state.isPressed &&
            state.pointerId === event.pointerId &&
            !state.isDragging
          ) {
            state.isDragging = true;
            section.setAttribute('data-tempo-dragging', 'true');
            try {
              section.setPointerCapture(event.pointerId);
            } catch {
              // ignore
            }
          }
        },
        pressedIdx === activeIdx ? 80 : 280,
      );
    });

    const onPointerMove = (event: PointerEvent) => {
      if (!state.isPressed || event.pointerId !== state.pointerId) return;
      const dy = event.clientY - state.startClientY;
      if (!state.isDragging && Math.abs(dy) >= 2) {
        state.isDragging = true;
        section.setAttribute('data-tempo-dragging', 'true');
        if (state.holdTimer !== null) {
          window.clearTimeout(state.holdTimer);
          state.holdTimer = null;
        }
        try {
          section.setPointerCapture(event.pointerId);
        } catch {
          // ignore
        }
      }
      if (!state.isDragging) return;

      event.preventDefault();
      const entries = getVisibleEntries(items);
      if (!entries.length) return;
      const metrics = getMetricsList(items, entries);
      if (!metrics.length) return;

      const itemsRect = items.getBoundingClientRect();
      const pointerY = event.clientY - itemsRect.top;
      const minY = metrics[0].y;
      const maxY = metrics[metrics.length - 1].y;
      const rawY = pointerY - state.grabOffsetY;

      let clampedY = rawY;
      if (rawY < minY) {
        clampedY = minY - Math.min(7, (minY - rawY) * 0.18);
      } else if (rawY > maxY) {
        clampedY = maxY + Math.min(7, (rawY - maxY) * 0.18);
      }

      const currentHeight =
        metrics[state.targetIndex]?.height ?? metrics[0].height;
      const pillCenterY = clampedY + (currentHeight / 2);
      const closestIdx = findClosestIndex(metrics, pillCenterY);
      state.targetIndex = closestIdx;
      updateTargetAttribute(entries, closestIdx);

      const targetMetric = metrics[closestIdx];
      applyPillBox(
        state,
        targetMetric.x,
        clampedY,
        targetMetric.width,
        targetMetric.height,
      );
    };

    const finishPointer = (event: PointerEvent, cancelled: boolean) => {
      if (!state.isPressed || event.pointerId !== state.pointerId) return;
      const targetIdx = state.targetIndex;

      if (state.holdTimer !== null) {
        window.clearTimeout(state.holdTimer);
        state.holdTimer = null;
      }
      try {
        if (section.hasPointerCapture(event.pointerId)) {
          section.releasePointerCapture(event.pointerId);
        }
      } catch {
        // ignore
      }

      state.isPressed = false;
      state.isDragging = false;
      state.pointerId = null;
      section.removeAttribute('data-tempo-pressed');
      section.removeAttribute('data-tempo-dragging');

      const entries = getVisibleEntries(items);
      if (!entries.length) return;
      const metrics = getMetricsList(items, entries);

      if (cancelled) {
        syncSection(state);
        return;
      }

      const chosenIdx = Math.max(0, Math.min(entries.length - 1, targetIdx));
      const chosenMetric = metrics[chosenIdx];
      if (!chosenMetric) {
        syncSection(state);
        return;
      }

      updateTargetAttribute(entries, chosenIdx);
      const isSettings = chosenMetric.entry.matches(settingsEntry);
      if (!isSettings) setOptimistic(state, chosenMetric.entry);
      applyPillBox(
        state,
        chosenMetric.x,
        chosenMetric.y,
        chosenMetric.width,
        chosenMetric.height,
      );
      if (!isSettings) syncCounterpartOptimistic(section, chosenIdx);

      state.suppressClickUntil = performance.now() + 180;
      activateEntry(chosenMetric.entry);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', (e) => finishPointer(e, false));
    window.addEventListener('pointercancel', (e) => finishPointer(e, true));

    const resizeObserver = new ResizeObserver(() => {
      syncSection(state);
    });
    resizeObserver.observe(section);
    resizeObserver.observe(items);
    const observeEntries = () => {
      for (const entry of items.querySelectorAll<HTMLElement>(
        `${sliderEntry}, ${guideEntry} > tp-yt-paper-item`,
      )) {
        resizeObserver.observe(entry);
      }
    };
    observeEntries();

    syncSection(state, true);
  }

  function scanAndSyncAll() {
    const sections = document.querySelectorAll<HTMLElement>(
      'ytmusic-guide-section-renderer[is-primary]',
    );
    for (const section of sections) {
      setupSection(section);
    }
    for (const section of trackedSections) {
      const state = states.get(section);
      if (state) syncSection(state);
    }
  }

  win.__tempoSidebarSliderRefresh = scanAndSyncAll;

  const observer = new MutationObserver((mutations) => {
    let shouldSync = false;
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const attr = mutation.attributeName;
        if (
          attr === 'active' ||
          attr === 'aria-current' ||
          (attr === 'aria-expanded' && (mutation.target as Element).matches(settingsEntry)) ||
          attr === 'is-collapsed' ||
          attr === 'guide-collapsed' ||
          attr === 'opened'
        ) {
          shouldSync = true;
          break;
        }
      } else if (mutation.type === 'childList') {
        shouldSync = true;
        break;
      }
    }
    if (shouldSync) {
      scanAndSyncAll();
    }
  });

  const startObserving = () => {
    scanAndSyncAll();
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'active',
        'aria-current',
        'aria-expanded',
        'is-collapsed',
        'guide-collapsed',
        'opened',
      ],
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserving, {
      once: true,
    });
  } else {
    startObserving();
  }

  window.addEventListener('resize', () => {
    scanAndSyncAll();
  });
}
