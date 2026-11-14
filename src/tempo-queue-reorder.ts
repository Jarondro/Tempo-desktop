import type { QueueElement } from '@/types/queue';

const queueSelector = 'ytmusic-player-page #side-panel ytmusic-player-queue';
const entrySelector =
  'ytmusic-player-queue-item, ytmusic-playlist-panel-video-wrapper-renderer';
const interactiveSelector =
  'a, button, input, [role="button"], yt-icon-button, ytmusic-menu-renderer';

type QueueItem = ReturnType<QueueElement['queue']['getItems']>[number];
type QueueEntry = HTMLElement & {
  data?: NonNullable<
    | QueueItem['playlistPanelVideoRenderer']
    | QueueItem['playlistPanelVideoWrapperRenderer']
  >;
};

function reorderable(entry: QueueEntry) {
  const { data } = entry;
  return (
    data &&
    ('primaryRenderer' in data
      ? data.primaryRenderer.playlistPanelVideoRenderer?.canReorder
      : data.canReorder)
  );
}

function attachReorder(queue: QueueElement, list: HTMLElement) {
  const entries = () =>
    Array.from(list.children).filter((el): el is QueueEntry =>
      el.matches(entrySelector),
    );
  const events = new AbortController();
  const { signal } = events;
  let gesture:
    | {
        entry: QueueEntry;
        pointerId: number;
        startX: number;
        startY: number;
        x: number;
        y: number;
        isHandle: boolean;
      }
    | undefined;
  let drag:
    | {
        rows: {
          entry: QueueEntry;
          data: QueueEntry['data'];
          top: number;
          height: number;
        }[];
        scroller: HTMLElement;
        startListTop: number;
        source: number;
        target: number;
      }
    | undefined;
  let frame = 0;
  let suppressClick = false;
  let suppressTimer: ReturnType<typeof setTimeout> | undefined;

  function refresh() {
    for (const entry of entries())
      entry.toggleAttribute('data-tempo-queue-row', !!reorderable(entry));
  }

  function shift(entry: QueueEntry, distance: number) {
    if (distance)
      entry.style.setProperty('--tempo-queue-shift', `${distance}px`);
    else entry.style.removeProperty('--tempo-queue-shift');
  }

  function updatePreview() {
    frame = 0;
    if (!gesture || !drag) return;

    const { rows, source, scroller, startListTop } = drag;
    const bounds = scroller.getBoundingClientRect();
    const inside =
      gesture.x >= bounds.left &&
      gesture.x <= bounds.right &&
      gesture.y >= bounds.top &&
      gesture.y <= bounds.bottom;
    const edge = inside
      ? Math.min(0, gesture.y - bounds.top - 42) +
        Math.max(0, gesture.y - bounds.bottom + 42)
      : 0;
    const scrollTop = scroller.scrollTop;
    if (edge) scroller.scrollTop += edge / 3;
    if (scroller.scrollTop !== scrollTop) requestPreview();

    const listTop = list.getBoundingClientRect().top;
    const first = rows[0];
    const last = rows[rows.length - 1];
    const origin = rows[source];
    const top = Math.max(
      first.top,
      Math.min(
        last.top + last.height - origin.height,
        origin.top + gesture.y - gesture.startY + startListTop - listTop,
      ),
    );
    shift(origin.entry, top - origin.top);

    const halfHeight = origin.height / 2;
    const center = top + halfHeight;
    let target = source;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowHalfHeight = row.height / 2;
      const rowCenter = row.top + rowHalfHeight;
      if (index < source && center < rowCenter) {
        target = index;
        break;
      }
      if (index > source && center > rowCenter) target = index;
    }
    if (target === drag.target) return;

    // Offset the intervening rows by the space the dragged row leaves behind.
    const step =
      rows[source + 1]?.top - origin.top || origin.top - rows[source - 1].top;
    const from = Math.min(target, drag.target, source);
    const to = Math.max(target, drag.target, source);
    for (let index = from; index <= to; index += 1) {
      if (index === source) continue;
      const distance =
        index >= target && index < source
          ? step
          : index <= target && index > source
            ? -step
            : 0;
      shift(rows[index].entry, distance);
    }
    drag.target = target;
  }

  function requestPreview() {
    if (!frame) frame = requestAnimationFrame(updatePreview);
  }

  function begin() {
    if (!gesture) return;
    const { entry, pointerId } = gesture;
    const scroller = list.closest<HTMLElement>('ytmusic-tab-renderer');
    if (!scroller) return;
    const startListTop = list.getBoundingClientRect().top;
    const rows = entries()
      .filter((row) => row.offsetHeight > 0)
      .map((row) => {
        const { top, height } = row.getBoundingClientRect();
        return { entry: row, data: row.data, top: top - startListTop, height };
      });
    const source = rows.findIndex((row) => row.entry === entry);
    if (source < 0 || rows.length < 2) return;
    drag = { rows, scroller, startListTop, source, target: source };
    list.setAttribute('data-tempo-queue-dragging', '');
    entry.setAttribute('data-tempo-queue-dragged', '');
    try {
      list.setPointerCapture(pointerId);
    } catch {
      // Window listeners also receive pointer events without capture.
    }
  }

  function finish(commit: boolean) {
    if (!gesture) return;
    const { entry, pointerId } = gesture;
    gesture = undefined;
    if (!drag) return;

    const { rows, source, target } = drag;
    drag = undefined;
    cancelAnimationFrame(frame);
    frame = 0;
    list.removeAttribute('data-tempo-queue-dragging');
    entry.removeAttribute('data-tempo-queue-dragged');
    for (const row of rows) shift(row.entry, 0);
    if (list.hasPointerCapture(pointerId))
      list.releasePointerCapture(pointerId);
    suppressClick = true;
    clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => {
      suppressClick = false;
    }, 0);

    if (
      !commit ||
      source === target ||
      rows.some(
        (row) =>
          row.entry.parentElement !== list || row.entry.data !== row.data,
      )
    )
      return;
    const items = queue.queue.getItems();
    const itemIndex = (data: QueueEntry['data']) =>
      items.findIndex(
        (item) =>
          data &&
          (item.playlistPanelVideoRenderer === data ||
            item.playlistPanelVideoWrapperRenderer === data),
      );
    const fromIndex = itemIndex(rows[source].data);
    const toIndex = itemIndex(rows[target].data);
    if (fromIndex >= 0 && toIndex >= 0)
      queue.dispatch({ type: 'MOVE_ITEM', payload: { fromIndex, toIndex } });
  }

  list.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || gesture) return;
      clearTimeout(suppressTimer);
      suppressClick = false;
      const target = event.target as Element;
      const row = target.closest<QueueEntry>('ytmusic-player-queue-item');
      const entry =
        row?.closest<QueueEntry>(
          'ytmusic-playlist-panel-video-wrapper-renderer',
        ) ?? row;
      if (
        !row ||
        !entry ||
        entry.parentElement !== list ||
        !reorderable(entry) ||
        !queue.queue?.getItems
      )
        return;
      const handle = target.closest('.ytmusic-reorder-handle');
      if (!handle) {
        if (event.pointerType !== 'mouse') return;
        // Never hijack clicks on the thumbnail play button or row action controls for drag.
        if (target.closest('.left-items')) return;
        const control = target.closest(interactiveSelector);
        if (control && control !== row && row.contains(control)) return;
      }
      // Keep native mouse-down gestures from starting a drag on non-handle areas while allowing clicks.
      event.preventDefault();
      event.stopImmediatePropagation();
      gesture = {
        entry,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        isHandle: Boolean(handle),
      };
    },
    { capture: true, signal },
  );

  window.addEventListener(
    'pointermove',
    (event) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      const threshold = gesture.isHandle ? 5 : 10;
      if (
        !drag &&
        Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) >=
          threshold
      )
        begin();
      if (drag) requestPreview();
    },
    { capture: true, signal },
  );

  window.addEventListener(
    'pointerup',
    (event) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      if (drag && frame) {
        cancelAnimationFrame(frame);
        updatePreview();
      }
      const bounds = drag?.scroller.getBoundingClientRect();
      finish(
        !!bounds &&
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom,
      );
    },
    { capture: true, signal },
  );

  for (const event of ['pointercancel', 'lostpointercapture', 'blur']) {
    window.addEventListener(event, () => finish(false), { signal });
  }
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && drag) {
        event.stopImmediatePropagation();
        finish(false);
      }
    },
    { capture: true, signal },
  );
  list.addEventListener(
    'dragstart',
    (event) => {
      if (!gesture) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true, signal },
  );
  for (const type of ['click', 'tap']) {
    list.addEventListener(
      type,
      (event) => {
        if (event instanceof MouseEvent && event.detail === 0) return;
        if (!drag && !suppressClick) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      { capture: true, signal },
    );
  }

  // Let clicking anywhere on a queue row body (outside action buttons/handles) play that song.
  list.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || drag || suppressClick) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      if (!target || target.closest('.left-items, .ytmusic-reorder-handle')) return;

      const wrapper = target.closest<QueueEntry>('ytmusic-playlist-panel-video-wrapper-renderer');
      const row =
        target.closest<QueueEntry>('ytmusic-player-queue-item') ??
        wrapper?.querySelector<QueueEntry>('ytmusic-player-queue-item');
      if (!row || (wrapper ?? row).parentElement !== list) return;

      const control = target.closest(interactiveSelector);
      if (control && control !== row && row.contains(control)) return;

      if (!row.hasAttribute('selected') || row.getAttribute('play-button-state') === 'paused') {
        row.querySelector<HTMLElement>('ytmusic-play-button-renderer')?.click();
      }
    },
    { signal },
  );

  const observer = new MutationObserver(() => {
    finish(false);
    refresh();
  });
  observer.observe(list, { childList: true });
  refresh();
  return () => {
    clearTimeout(suppressTimer);
    finish(false);
    events.abort();
    observer.disconnect();
  };
}

export function mountTempoQueueReorder() {
  let attached: HTMLElement | null = null;
  let dispose = () => {};
  function connect() {
    if (attached?.isConnected) return;
    const queue = document.querySelector<QueueElement>(queueSelector);
    const list =
      queue?.querySelector<HTMLElement>(':scope > #contents') ?? null;
    if (list === attached) return;
    dispose();
    attached = list;
    if (queue && list) dispose = attachReorder(queue, list);
  }
  connect();
  new MutationObserver(connect).observe(document.body, {
    childList: true,
    subtree: true,
  });
}
