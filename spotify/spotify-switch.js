(() => {
  if (window.top !== window || location.origin !== 'https://open.spotify.com') return;

  const webview = window.chrome.webview;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'tempo-youtube-music';
  button.setAttribute('aria-label', 'YouTube Music');
  button.title = 'Zpět do YouTube Music';
  const image = document.createElement('img');
  image.src = 'data:image/png;base64,__TEMPO_YOUTUBE_ICON__';
  image.alt = '';
  button.append(image);
  button.addEventListener('click', () => webview.postMessage('tempo:youtube-music'));

  const settings = document.createElement('button');
  settings.type = 'button';
  settings.id = 'tempo-spotify-settings';
  settings.setAttribute('aria-label', 'Nastavení Tempa');
  settings.setAttribute('aria-haspopup', 'dialog');
  settings.setAttribute('aria-controls', 'tempo-spotify-dialog');
  settings.title = 'Nastavení Tempa';
  const gear = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  gear.setAttribute('viewBox', '0 0 24 24');
  gear.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(gear.namespaceURI, 'path');
  shape.setAttribute('d', 'M10 3h4l.5 2.2 1.5.9 2.2-.7 2 3.5-1.7 1.6v2l1.7 1.6-2 3.5-2.2-.7-1.5.9L14 20h-4l-.5-2.2-1.5-.9-2.2.7-2-3.5 1.7-1.6v-2L3.8 9 5.8 5.5l2.2.7 1.5-.9L10 3Z');
  const ring = document.createElementNS(gear.namespaceURI, 'circle');
  ring.setAttribute('cx', '12');
  ring.setAttribute('cy', '11.5');
  ring.setAttribute('r', '2.8');
  gear.append(shape, ring);
  settings.append(gear);

  const panel = document.createElement('dialog');
  panel.id = 'tempo-spotify-dialog';
  panel.setAttribute('aria-labelledby', 'tempo-spotify-title');
  const header = document.createElement('header');
  const title = document.createElement('h2');
  title.id = 'tempo-spotify-title';
  title.textContent = 'Nastavení Tempa';
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Zavřít');
  close.textContent = '×';
  close.addEventListener('click', () => panel.close());
  header.append(title, close);

  const label = document.createElement('label');
  const name = document.createElement('strong');
  name.textContent = 'Blokování nechtěných tracků';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.setAttribute('role', 'switch');
  toggle.disabled = true;
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'tempo-spotify-reload';
  reload.textContent = 'Obnovit přehrávač';
  reload.addEventListener('click', () => location.reload());
  label.append(name, toggle);
  panel.append(header, label, status, reload);

  let enabled = false;
  settings.addEventListener('click', () => {
    if (panel.open) return;
    panel.showModal();
    webview.postMessage('tempo:adblock:get');
  });
  panel.addEventListener('close', () => settings.focus({ preventScroll: true }));
  toggle.addEventListener('change', () => {
    toggle.disabled = true;
    status.textContent = '';
    webview.postMessage(toggle.checked ? 'tempo:adblock:on' : 'tempo:adblock:off');
  });
  webview.addEventListener('message', ({ data }) => {
    if (data === 'tempo:adblock:on' || data === 'tempo:adblock:off') {
      enabled = data === 'tempo:adblock:on';
      status.textContent = '';
    } else if (data === 'tempo:adblock:error') {
      status.textContent = 'Změnu se nepodařilo uložit.';
    } else {
      return;
    }
    toggle.checked = enabled;
    toggle.disabled = false;
  });

  const style = new CSSStyleSheet();
  style.replaceSync(`
    :is(#tempo-youtube-music, #tempo-spotify-settings) {
      display: inline-grid;
      place-items: center;
      flex: 0 0 44px;
      box-sizing: border-box;
      width: 44px;
      height: 44px;
      margin-inline: 4px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: #242424;
      cursor: pointer;
    }
    :is(#tempo-youtube-music, #tempo-spotify-settings):hover { background: #353535; }
    :is(#tempo-youtube-music, #tempo-spotify-settings):focus-visible,
    #tempo-spotify-dialog :focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    #tempo-youtube-music img { width: 24px; height: 24px; }
    #tempo-spotify-settings svg {
      width: 23px; height: 23px; fill: none; stroke: #eee; stroke-width: 1.7; stroke-linejoin: round;
    }
    :is(#tempo-youtube-music, #tempo-spotify-settings)[data-floating] {
      position: fixed;
      inset: 10px auto auto 60px;
      z-index: 10;
    }
    #tempo-spotify-settings[data-floating] { inset-inline-start: 110px; }
    #tempo-spotify-dialog {
      position: fixed;
      inset: 0;
      box-sizing: border-box;
      width: min(460px, calc(100vw - 32px));
      max-height: calc(100dvh - 40px);
      margin: auto;
      padding: 22px;
      border: 1px solid #424242;
      border-radius: 18px;
      background: #1d1d1d;
      color: #f5f5f5;
      box-shadow: 0 20px 70px #0009;
      font: 14px/1.45 "Segoe UI", system-ui, sans-serif;
    }
    #tempo-spotify-dialog::backdrop { background: #000a; backdrop-filter: blur(3px); }
    #tempo-spotify-dialog header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    #tempo-spotify-dialog h2 { margin: 0; font-size: 22px; letter-spacing: -.02em; }
    #tempo-spotify-dialog header button {
      flex: none; width: 34px; height: 34px; padding: 0; border: 0;
      border-radius: 50%; background: #333; color: inherit; font: 24px/1 system-ui; cursor: pointer;
    }
    #tempo-spotify-dialog header button:hover { background: #444; }
    #tempo-spotify-dialog label {
      display: flex; align-items: center; justify-content: space-between; gap: 14px;
      margin-block-start: 18px; padding: 13px 14px; border: 1px solid #3a3a3a;
      border-radius: 12px; background: #262626; cursor: pointer;
    }
    #tempo-spotify-dialog input {
      display: block; position: relative; flex: none; appearance: none; margin: 0;
      width: 38px; height: 22px; border-radius: 11px; background: #5c5c5c; cursor: pointer;
    }
    #tempo-spotify-dialog input::after {
      content: ''; position: absolute; inset: 3px auto auto 3px;
      width: 16px; height: 16px; border-radius: 50%; background: #f3f3f3;
    }
    #tempo-spotify-dialog input:checked { background: #1ed760; }
    #tempo-spotify-dialog input:checked::after { inset-inline-start: 19px; background: #132719; }
    #tempo-spotify-dialog input:disabled { opacity: .65; }
    #tempo-spotify-dialog p { margin: 10px 0 0; color: #ffb3a7; }
    #tempo-spotify-dialog p:empty { display: none; }
    #tempo-spotify-dialog .tempo-spotify-reload {
      margin-block-start: 14px; padding: 7px 12px; border: 1px solid #424242;
      border-radius: 8px; background: #262626; color: inherit; font: inherit; cursor: pointer;
    }
    #tempo-spotify-dialog .tempo-spotify-reload:hover { background: #363636; }
  `);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, style];

  function placeButton() {
    if (!document.body) return;
    if (panel.parentElement !== document.body) document.body.append(panel);
    const home = document.querySelector('button[data-testid="home-button"]');
    if (home && home.getClientRects().length && getComputedStyle(home).visibility === 'visible') {
      button.removeAttribute('data-floating');
      settings.removeAttribute('data-floating');
      if (home.nextElementSibling !== button) home.after(button);
      if (button.nextElementSibling !== settings) button.after(settings);
    } else {
      for (const control of [button, settings]) {
        control.setAttribute('data-floating', '');
        if (control.parentElement !== document.body) document.body.append(control);
      }
    }
  }

  new MutationObserver(placeButton).observe(document, { childList: true, subtree: true });
  window.addEventListener('resize', placeButton);
  placeButton();
})();
