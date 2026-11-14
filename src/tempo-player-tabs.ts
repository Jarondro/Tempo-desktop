export function mountTempoPlayerTabs() {
  const selector = 'ytmusic-player-page #side-panel > .tab-header-container #tabsContent';
  let attached: HTMLElement | null = null;
  let dispose = () => {};

  function attach(tabs: HTMLElement) {
    const events = new AbortController();
    const { signal } = events;
    let gesture: {
      pointerId: number;
      startX: number;
      offset: number;
      dragging: boolean;
      target: HTMLElement;
    } | undefined;
    let suppressClick = false;

    const options = () => [...tabs.querySelectorAll<HTMLElement>(
      ':scope > tp-yt-paper-tab:not([aria-disabled="true"])',
    )].filter((tab) => tab.offsetWidth > 0);

    function position(tab: HTMLElement, x = tab.offsetLeft) {
      tabs.style.setProperty('--tempo-tab-x', `${x}px`);
      tabs.style.setProperty('--tempo-tab-width', `${tab.offsetWidth}px`);
      tabs.setAttribute('data-tempo-tab-slider', '');
    }

    function sync() {
      if (gesture?.dragging) return;
      const selected = options().find((tab) => tab.getAttribute('aria-selected') === 'true');
      if (selected) position(selected);
      else tabs.removeAttribute('data-tempo-tab-slider');
    }

    tabs.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || gesture) return;
      const tab = (event.target as Element).closest<HTMLElement>('tp-yt-paper-tab[aria-selected="true"]');
      if (!tab || !tabs.contains(tab)) return;
      gesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        offset: event.clientX - tab.getBoundingClientRect().left,
        dragging: false,
        target: tab,
      };
      suppressClick = false;
    }, { capture: true, signal });

    window.addEventListener('pointermove', (event) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      if (!gesture.dragging && Math.abs(event.clientX - gesture.startX) < 5) return;
      const entries = options();
      if (!entries.length) return;
      if (!gesture.dragging) {
        gesture.dragging = true;
        tabs.setAttribute('data-tempo-tab-dragging', '');
        try {
          tabs.setPointerCapture(event.pointerId);
        } catch {
          // The window listeners still handle dragging without pointer capture.
        }
      }
      const pointer = event.clientX - tabs.getBoundingClientRect().left;
      gesture.target = entries.reduce((closest, tab) => {
        const distance = (entry: HTMLElement) => Math.abs(pointer - entry.offsetLeft - (entry.offsetWidth / 2));
        return distance(tab) < distance(closest) ? tab : closest;
      });
      const limit = entries[entries.length - 1].offsetLeft;
      const x = Math.max(entries[0].offsetLeft, Math.min(limit, pointer - gesture.offset));
      position(gesture.target, x);
    }, { capture: true, signal });

    function finish(event: PointerEvent, select: boolean) {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const { target, dragging } = gesture;
      gesture = undefined;
      if (!dragging) return;
      tabs.removeAttribute('data-tempo-tab-dragging');
      if (select && target.isConnected) {
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
        target.dispatchEvent(new Event('tap', { bubbles: true, composed: true }));
        target.focus({ preventScroll: true });
      }
      sync();
    }

    window.addEventListener('pointerup', (event) => finish(event, true), { capture: true, signal });
    window.addEventListener('pointercancel', (event) => finish(event, false), { capture: true, signal });
    tabs.addEventListener('lostpointercapture', (event) => finish(event, false), { signal });
    tabs.addEventListener('click', (event) => {
      if (!suppressClick || event.detail === 0) return;
      event.stopImmediatePropagation();
      event.preventDefault();
    }, { capture: true, signal });

    const resize = new ResizeObserver(sync);
    resize.observe(tabs);
    if (tabs.parentElement) resize.observe(tabs.parentElement);
    const selection = new MutationObserver(sync);
    selection.observe(tabs, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'aria-disabled', 'hidden'],
    });
    sync();
    return () => {
      events.abort();
      resize.disconnect();
      selection.disconnect();
    };
  }

  function connect() {
    if (attached?.isConnected) return;
    const tabs = document.querySelector<HTMLElement>(selector);
    if (tabs === attached) return;
    dispose();
    attached = tabs;
    if (tabs) dispose = attach(tabs);
  }

  connect();
  new MutationObserver(connect).observe(document.body, { childList: true, subtree: true });
}
