import { createResource, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { css } from 'solid-styled-components';

import { cacheNoArgs } from '@/providers/decorators';

import { WindowController } from './WindowController';

import type { InAppMenuConfig } from '../constants';
import type { RendererContext } from '@/types/contexts';

const titleStyle = cacheNoArgs(
  () => css`
    -webkit-app-region: drag;
    box-sizing: border-box;

    position: fixed;
    top: 0;
    z-index: 10000000;

    width: 100%;
    height: var(--menu-bar-height, 32px);

    display: flex;
    flex-flow: row;
    justify-content: flex-start;
    align-items: center;
    gap: 4px;

    color: #f1f1f1;
    font-size: 12px;
    padding: 4px 4px 4px var(--offset-left, 4px);
    background-color: var(--titlebar-background-color, #030303);
    user-select: none;

    transition:
      opacity 200ms ease 0s,
      transform 300ms cubic-bezier(0.2, 0, 0.6, 1) 0s,
      background-color 300ms cubic-bezier(0.2, 0, 0.6, 1) 0s;

    &[data-macos='true'] {
      padding: 4px 4px 4px 74px;
    }

    ytmusic-app:has(ytmusic-player[player-ui-state='FULLSCREEN'])
      ~ &:not([data-show='true']) {
      transform: translateY(calc(-1 * var(--menu-bar-height, 32px)));
    }
  `,
);

export type TitleBarProps = {
  ipc: RendererContext<InAppMenuConfig>['ipc'];
  isMacOS?: boolean;
  enableController?: boolean;
};

export const TitleBar = (props: TitleBarProps) => {
  const [mouseY, setMouseY] = createSignal(0);
  const [isMaximized, { refetch }] = createResource(
    async () => (await props.ipc.invoke('window-is-maximized')) as boolean,
  );
  const trackMouse = (event: MouseEvent) => setMouseY(event.clientY);
  const updateScroll = (event: Event) => {
    const layout = event.target;
    if (layout instanceof HTMLElement && layout.matches('ytmusic-app-layout#layout')) {
      layout.classList.toggle('content-scrolled', layout.scrollTop > 20);
    }
  };

  onMount(() => {
    props.ipc.on('window-maximize', refetch);
    props.ipc.on('window-unmaximize', refetch);
    window.addEventListener('mousemove', trackMouse);
    document.addEventListener('scroll', updateScroll, true);
  });
  onCleanup(() => {
    window.removeEventListener('mousemove', trackMouse);
    document.removeEventListener('scroll', updateScroll, true);
  });

  return (
    <nav
      class={titleStyle()}
      data-macos={props.isMacOS}
      data-show={mouseY() < 32}
      data-ytmd-main-panel={true}
      id="ytmd-title-bar-main-panel"
    >
      <Show when={props.enableController}>
        <div style={{ flex: 1 }} />
        <WindowController
          isMaximize={isMaximized()}
          onClose={() => {
            props.ipc.invoke('window-close');
          }}
          onMinimize={() => {
            props.ipc.invoke('window-minimize');
          }}
          onToggleMaximize={async () => {
            await props.ipc.invoke(isMaximized() ? 'window-unmaximize' : 'window-maximize');
            await refetch();
          }}
        />
      </Show>
    </nav>
  );
};
