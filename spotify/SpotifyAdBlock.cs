using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Microsoft.Web.WebView2.Core;

internal sealed class SpotifyAdBlock
{
    private static readonly string[] AdDomains =
    {
        "ads-fa.spotify.com",
        "adstudio-assets.scdn.co",
        "adxcel.com",
        "amillionads.com",
        "2mdn.net",
        "doubleclick.net",
        "googlesyndication.com",
        "googleadservices.com",
        "adeventtracker.spotify.com",
        "pixel.spotify.com",
        "analytics.spotify.com",
        "ads.spotify.com",
        "admocker.spotify.com",
    };

    private static readonly CoreWebView2WebResourceContext[] BlockedContexts =
    {
        CoreWebView2WebResourceContext.Image,
        CoreWebView2WebResourceContext.Script,
        CoreWebView2WebResourceContext.Document,
        CoreWebView2WebResourceContext.Stylesheet,
        CoreWebView2WebResourceContext.XmlHttpRequest,
        CoreWebView2WebResourceContext.Fetch,
    };

    private static readonly byte[] EmptyScriptBytes = Encoding.UTF8.GetBytes("/* blocked by Tempo */\n");
    private static readonly byte[] EmptyHtmlBytes = Encoding.UTF8.GetBytes("<!doctype html><html><body></body></html>");
    private static readonly byte[] EmptyJsonBytes = Encoding.UTF8.GetBytes("{}");

    private readonly CoreWebView2 web;
    private readonly CoreWebView2Environment environment;
    private readonly string preference;
    public bool Enabled { get; private set; }

    public SpotifyAdBlock(CoreWebView2 web, CoreWebView2Environment environment, string profile)
    {
        this.web = web;
        this.environment = environment;
        preference = Path.Combine(profile, "tempo-block-ads");
        Enabled = File.Exists(preference);
        web.WebResourceRequested += FilterRequest;

        foreach (var domain in AdDomains)
        {
            foreach (var context in BlockedContexts)
            {
                AddFilter("https://" + domain + "/*", context);
                AddFilter("https://*." + domain + "/*", context);
            }
        }

        AddFilter("https://open.spotifycdn.com/cdn/js/retargeting-pixels*", CoreWebView2WebResourceContext.Script);
        AddFilter("https://open.spotifycdn.com/cdn/js/retargeting-pixels*", CoreWebView2WebResourceContext.Fetch);
        AddFilter("https://open.spotifycdn.com/cdn/js/retargeting-pixels*", CoreWebView2WebResourceContext.XmlHttpRequest);
        AddFilter("https://open.spotifycdn.com/cdn/js/gtm*", CoreWebView2WebResourceContext.Script);
        AddFilter("https://open.spotifycdn.com/cdn/js/gtm*", CoreWebView2WebResourceContext.Fetch);
        AddFilter("https://open.spotifycdn.com/cdn/js/gtm*", CoreWebView2WebResourceContext.XmlHttpRequest);
        AddFilter("https://open.spotifycdn.com/cdn/templates/leaderboard*", CoreWebView2WebResourceContext.Document);
        AddFilter("https://open.spotifycdn.com/cdn/templates/leaderboard*", CoreWebView2WebResourceContext.Fetch);
        AddFilter("https://open.spotifycdn.com/cdn/templates/leaderboard*", CoreWebView2WebResourceContext.XmlHttpRequest);
        AddFilter("https://*.spotify.com/ads-identity-web-enricher/*", CoreWebView2WebResourceContext.Fetch);
        AddFilter("https://*.spotify.com/ads-identity-web-enricher/*", CoreWebView2WebResourceContext.XmlHttpRequest);
    }

    public bool TrySetEnabled(bool enabled)
    {
        if (enabled == Enabled) return true;
        try
        {
            if (enabled)
            {
                using (File.Create(preference)) { }
            }
            else
            {
                File.Delete(preference);
            }
            Enabled = enabled;
            return true;
        }
        catch (IOException ex) { Console.Error.WriteLine(ex.Message); }
        catch (UnauthorizedAccessException ex) { Console.Error.WriteLine(ex.Message); }
        return false;
    }

    public string BuildClientScript()
    {
        return ClientScriptTemplate.Replace("__TEMPO_ADBLOCK_INITIAL__", Enabled ? "true" : "false");
    }

    private void AddFilter(string uri, CoreWebView2WebResourceContext context)
    {
        web.AddWebResourceRequestedFilter(uri, context, CoreWebView2WebResourceRequestSourceKinds.All);
    }

    private void FilterRequest(object sender, CoreWebView2WebResourceRequestedEventArgs args)
    {
        // Never touch music CDN streams, playlist/account APIs, or DRM license requests.
        if (!Enabled || !SpotifyHost.IsSpotifyPage(web.Source))
            return;

        if (args.ResourceContext == CoreWebView2WebResourceContext.Image)
        {
            args.Response = environment.CreateWebResourceResponse(null, 204, "No Content", "Cache-Control: no-store");
            return;
        }

        var origin = ResolveCorsOrigin(args.Request);
        var corsHeaders = BuildCorsHeaders(origin);

        if (string.Equals(args.Request.Method, "OPTIONS", StringComparison.OrdinalIgnoreCase))
        {
            args.Response = environment.CreateWebResourceResponse(
                null,
                204,
                "No Content",
                corsHeaders + "\r\nAccess-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Max-Age: 86400\r\nCache-Control: no-store");
            return;
        }

        switch (args.ResourceContext)
        {
            case CoreWebView2WebResourceContext.Script:
                args.Response = environment.CreateWebResourceResponse(
                    new MemoryStream(EmptyScriptBytes),
                    200,
                    "OK",
                    corsHeaders + "\r\nContent-Type: application/javascript; charset=utf-8\r\nCache-Control: no-store");
                return;
            case CoreWebView2WebResourceContext.Document:
                args.Response = environment.CreateWebResourceResponse(
                    new MemoryStream(EmptyHtmlBytes),
                    200,
                    "OK",
                    "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store");
                return;
            case CoreWebView2WebResourceContext.Stylesheet:
                args.Response = environment.CreateWebResourceResponse(
                    new MemoryStream(new byte[0]),
                    200,
                    "OK",
                    corsHeaders + "\r\nContent-Type: text/css; charset=utf-8\r\nCache-Control: no-store");
                return;
            case CoreWebView2WebResourceContext.XmlHttpRequest:
            case CoreWebView2WebResourceContext.Fetch:
                var requestUri = args.Request.Uri ?? "";
                var responseBytes = EmptyJsonBytes;
                var contentType = "application/json; charset=utf-8";
                if (requestUri.IndexOf("/cdn/js/", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    responseBytes = EmptyScriptBytes;
                    contentType = "application/javascript; charset=utf-8";
                }
                else if (requestUri.IndexOf("/cdn/templates/", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    responseBytes = EmptyHtmlBytes;
                    contentType = "text/html; charset=utf-8";
                }
                args.Response = environment.CreateWebResourceResponse(
                    new MemoryStream(responseBytes),
                    200,
                    "OK",
                    corsHeaders + "\r\nContent-Type: " + contentType + "\r\nCache-Control: no-store");
                return;
        }
    }

    private static string ResolveCorsOrigin(CoreWebView2WebResourceRequest request)
    {
        try
        {
            if (request.Headers.Contains("Origin"))
            {
                var origin = request.Headers.GetHeader("Origin");
                if (!string.IsNullOrEmpty(origin))
                    return origin;
            }
        }
        catch { }
        return "*";
    }

    private static string BuildCorsHeaders(string origin)
    {
        if (origin == "*")
            return "Access-Control-Allow-Origin: *";
        return "Access-Control-Allow-Origin: " + origin + "\r\nAccess-Control-Allow-Credentials: true\r\nVary: Origin";
    }

    private const string ClientScriptTemplate = @"
(() => {
  if (window.location.hostname !== 'open.spotify.com') return;

  let enabled = __TEMPO_ADBLOCK_INITIAL__;
  const TRACKED_EVENTS = ['loadstart', 'play', 'playing', 'loadedmetadata', 'durationchange', 'timeupdate', 'ratechange', 'volumechange', 'ended', 'emptied'];
  const TELEMETRY_RE = /^https:\/\/([^/]+\.)?(adeventtracker\.spotify\.com|pixel\.spotify\.com|analytics\.spotify\.com|doubleclick\.net|googlesyndication\.com|googleadservices\.com|adxcel\.com|amillionads\.com|2mdn\.net)(\/|$)|ads-identity-web-enricher/i;
  const AD_MEDIA_SRC_RE = /(\/mp3-ad\/|adstudio-assets\.scdn\.co|spclient\.wg\.spotify\.com\/ad-logic\/)/i;
  const AD_CARD_CONTAINER_SELECTOR = '[data-testid=""home-ads-container""], [data-testid=""home-ad-card""], [data-testid=""home-ad-video-asset""], #leaderboard-ad-element';
  const AD_PLAYING_SELECTOR = '[data-testid=""ad-countdown-timer""], [data-testid=""context-item-info-ad-subtitle""], [data-testid=""context-item-info-ad-title""]';
  const TRACK_LINK_SELECTOR = '[data-testid=""context-item-link""]';
  const MAX_AD_DURATION_SECONDS = 95;
  const AD_PRODUCT_STATE_BYTES = [0x0a, 0x03, 0x61, 0x64, 0x73, 0x12, 0x01, 0x31];

  const trackedMedia = new Set();
  const activeAdElements = new Set();
  const savedState = new WeakMap();
  const activeGuard = new WeakSet();
  const textDecoder = new TextDecoder();
  const esperantoTrackState = { known: false, isAd: false, uri: '' };
  let styleEl = null;
  let scheduledScan = 0;
  let lastAppliedAttr = null;
  let brakeTimer = 0;

  const AD_CSS = `
html[data-tempo-adblock=""on""] [data-testid=""home-ads-container""],
html[data-tempo-adblock=""on""] [data-testid=""home-ad-card""],
html[data-tempo-adblock=""on""] [data-testid=""home-ad-video-asset""],
html[data-tempo-adblock=""on""] [data-testid=""compact-advertiser-info""],
html[data-tempo-adblock=""on""] [data-testid=""regular-advertiser-info""],
html[data-tempo-adblock=""on""] [data-testid=""upgrade-button""],
html[data-tempo-adblock=""on""] [data-testid=""leaderboard-ad-element""],
html[data-tempo-adblock=""on""] #leaderboard-ad-element,
html[data-tempo-adblock=""on""] iframe[src*=""leaderboard""],
html[data-tempo-adblock=""on""] [data-testid=""billboard-ad""],
html[data-tempo-adblock=""on""] [data-testid=""hpto-ad""],
html[data-tempo-adblock=""on""] [data-testid=""ad-slot""],
html[data-tempo-adblock=""on""] [data-testid=""scroll-card-ad""] {
  display: none !important;
}`;

  function ensureStyleAndAttr() {
    const root = document.documentElement;
    if (!root) return;
    const want = enabled ? 'on' : 'off';
    if (lastAppliedAttr !== want) {
      lastAppliedAttr = want;
      if (enabled) {
        root.setAttribute('data-tempo-adblock', 'on');
      } else {
        root.removeAttribute('data-tempo-adblock');
      }
    }
    if (enabled && (!styleEl || !styleEl.isConnected)) {
      styleEl = document.getElementById('tempo-adblock-style');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'tempo-adblock-style';
        styleEl.textContent = AD_CSS;
      }
      (document.head || root).appendChild(styleEl);
    }
  }

  function isIgnoredElement(el) {
    if (!el || el.id === 'jssdk-internal-playability-checker') return true;
    const src = el.currentSrc || el.getAttribute('src') || el.src || '';
    if (src.includes('sounds/silence.mp3')) return true;
    if (typeof MediaStream !== 'undefined' && el.srcObject instanceof MediaStream) return true;
    return false;
  }

  function hasGlobalAdMarker() {
    return !!document.querySelector(AD_PLAYING_SELECTOR);
  }

  function hasTrackLinkMarker() {
    return !!document.querySelector(TRACK_LINK_SELECTOR);
  }

  function classifyAdMedia(el) {
    if (!enabled || isIgnoredElement(el)) return null;
    if (typeof el.closest === 'function' && el.closest(AD_CARD_CONTAINER_SELECTOR)) {
      return 'card';
    }
    const src = el.currentSrc || el.getAttribute('src') || el.src || '';
    if (src && AD_MEDIA_SRC_RE.test(src)) {
      return 'stream';
    }
    if (Number.isFinite(el.duration) && el.duration > MAX_AD_DURATION_SECONDS) {
      return null;
    }
    if (esperantoTrackState.known) {
      return esperantoTrackState.isAd ? 'stream' : null;
    }
    if (hasTrackLinkMarker()) {
      return null;
    }
    if (hasGlobalAdMarker()) {
      return 'stream';
    }
    return null;
  }

  function stopBrakeTimer() {
    if (brakeTimer) {
      clearInterval(brakeTimer);
      brakeTimer = 0;
    }
  }

  function ensureBrakeTimer() {
    if (brakeTimer || activeAdElements.size === 0) return;
    brakeTimer = setInterval(() => {
      if (!enabled || activeAdElements.size === 0) {
        stopBrakeTimer();
        return;
      }
      for (const el of Array.from(activeAdElements)) {
        if (!el || !el.isConnected) {
          restoreElement(el);
          continue;
        }
        applyMediaGuard(el);
      }
    }, 40);
  }

  function computeAdPlaybackRate(el) {
    const dur = el.duration;
    if (!Number.isFinite(dur) || dur <= 1.2) return 1;
    const cur = Number.isFinite(el.currentTime) ? el.currentTime : 0;
    const remaining = dur - cur;
    if (remaining <= 0.65) return 1;
    if (remaining <= 1.9) return 4;
    return 16;
  }

  function restoreElement(el) {
    activeAdElements.delete(el);
    if (activeAdElements.size === 0) {
      stopBrakeTimer();
    }
    const prev = savedState.get(el);
    if (!prev) {
      try {
        if (el && el.defaultPlaybackRate !== 1) el.defaultPlaybackRate = 1;
        if (el && el.playbackRate > 2) el.playbackRate = 1;
      } catch {}
      return;
    }
    savedState.delete(el);
    try {
      el.muted = prev.muted;
      el.volume = prev.volume;
      el.defaultPlaybackRate = prev.defaultPlaybackRate;
      el.playbackRate = prev.playbackRate;
    } catch {}
  }

  function restoreAllAdMedia() {
    for (const el of Array.from(activeAdElements)) {
      restoreElement(el);
    }
    for (const el of trackedMedia) {
      if (savedState.has(el)) {
        restoreElement(el);
      }
    }
  }

  function applyMediaGuard(el, evtType) {
    if (!(el instanceof HTMLMediaElement) || activeGuard.has(el)) return;
    activeGuard.add(el);
    try {
      trackMediaElement(el);
      if (evtType === 'loadstart' || evtType === 'emptied' || evtType === 'ended') {
        try {
          if (el.defaultPlaybackRate !== 1) el.defaultPlaybackRate = 1;
          if (el.playbackRate !== 1) el.playbackRate = 1;
        } catch {}
      }
      const prev = savedState.get(el);
      if (evtType === 'durationchange' && prev && prev.adDuration > 1 && Number.isFinite(el.duration)
        && (el.duration > MAX_AD_DURATION_SECONDS
          || (Math.abs(el.duration - prev.adDuration) > 2
            && ((!esperantoTrackState.known && (hasTrackLinkMarker() || !hasGlobalAdMarker()))
              || (esperantoTrackState.known && !esperantoTrackState.isAd))))) {
        restoreElement(el);
        return;
      }

      const kind = classifyAdMedia(el);
      if (!kind) {
        restoreElement(el);
        return;
      }
      if (kind === 'card') {
        try {
          el.muted = true;
          if (!el.paused) el.pause();
        } catch {}
        return;
      }
      if (!savedState.has(el)) {
        savedState.set(el, {
          muted: el.muted,
          volume: el.volume,
          playbackRate: el.playbackRate > 2 ? 1 : el.playbackRate,
          defaultPlaybackRate: el.defaultPlaybackRate > 2 ? 1 : el.defaultPlaybackRate,
          adDuration: Number.isFinite(el.duration) && el.duration > 1 ? el.duration : 0,
        });
      } else if (prev && (!prev.adDuration || prev.adDuration <= 1) && Number.isFinite(el.duration) && el.duration > 1) {
        prev.adDuration = el.duration;
      }
      activeAdElements.add(el);
      ensureBrakeTimer();
      const targetRate = computeAdPlaybackRate(el);
      try {
        if (!el.muted) el.muted = true;
        if (el.volume !== 0) el.volume = 0;
        if (el.defaultPlaybackRate !== 1) el.defaultPlaybackRate = 1;
        if (el.playbackRate !== targetRate) el.playbackRate = targetRate;
      } catch {}
    } finally {
      activeGuard.delete(el);
    }
  }

  function trackMediaElement(el) {
    if (!el || trackedMedia.has(el)) return;
    trackedMedia.add(el);
    for (const evt of TRACKED_EVENTS) {
      el.addEventListener(evt, () => applyMediaGuard(el, evt), true);
    }
  }

  function syncAllMedia() {
    if (typeof document !== 'undefined') {
      for (const el of document.querySelectorAll('audio, video')) {
        trackMediaElement(el);
      }
    }
    for (const el of trackedMedia) {
      applyMediaGuard(el);
    }
  }

  function scheduleSync() {
    if (scheduledScan) return;
    scheduledScan = requestAnimationFrame(() => {
      scheduledScan = 0;
      ensureStyleAndAttr();
      syncAllMedia();
    });
  }

  function setEnabled(next) {
    const flag = !!next;
    if (enabled === flag && styleEl?.isConnected) return;
    enabled = flag;
    ensureStyleAndAttr();
    if (!enabled) {
      restoreAllAdMedia();
    }
    syncAllMedia();
  }

  function patchProductStateAds(bytes) {
    const n = AD_PRODUCT_STATE_BYTES;
    const limit = bytes.length - n.length;
    let copy = null;
    for (let i = 0; i <= limit; i++) {
      let match = true;
      for (let j = 0; j < n.length; j++) {
        if (bytes[i + j] !== n[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        if (!copy) copy = new Uint8Array(bytes);
        copy[i + n.length - 1] = 0x30;
      }
    }
    return copy;
  }

  function readProtoVarint(buf, pos, end) {
    let val = 0;
    let shift = 0;
    while (pos < end) {
      const b = buf[pos++];
      if (shift <= 28) val += (b & 0x7f) * (2 ** shift);
      if (b < 0x80) return { val, pos };
      shift += 7;
      if (shift > 63) break;
    }
    return null;
  }

  function skipProtoField(buf, pos, end, wireType) {
    if (wireType === 0) {
      while (pos < end && (buf[pos++] & 0x80) !== 0) {}
      return pos;
    }
    if (wireType === 1) return Math.min(end, pos + 8);
    if (wireType === 2) {
      const len = readProtoVarint(buf, pos, end);
      return len ? Math.min(end, len.pos + len.val) : end;
    }
    if (wireType === 5) return Math.min(end, pos + 4);
    return end;
  }

  function readLengthDelimitedSlice(buf, start, end, fieldNum) {
    let pos = start;
    while (pos < end) {
      const tag = readProtoVarint(buf, pos, end);
      if (!tag) break;
      pos = tag.pos;
      const field = tag.val >>> 3;
      const wireType = tag.val & 7;
      if (wireType === 4 || tag.val === 0) break;
      if (field === fieldNum && wireType === 2) {
        const len = readProtoVarint(buf, pos, end);
        if (!len) break;
        return buf.subarray(len.pos, Math.min(end, len.pos + len.val));
      }
      pos = skipProtoField(buf, pos, end, wireType);
    }
    return null;
  }

  function extractContextPlayerTrackInfo(bytes) {
    const trackSlice = readLengthDelimitedSlice(bytes, 0, bytes.length, 7);
    if (!trackSlice) return null;
    const ctxSlice = readLengthDelimitedSlice(trackSlice, 0, trackSlice.length, 1);
    const providerSlice = readLengthDelimitedSlice(trackSlice, 0, trackSlice.length, 4);
    const uriSlice = ctxSlice ? readLengthDelimitedSlice(ctxSlice, 0, ctxSlice.length, 1) : null;
    const uri = uriSlice ? textDecoder.decode(uriSlice) : '';
    const provider = providerSlice ? textDecoder.decode(providerSlice) : '';
    if (!uri && !provider) return null;
    return { uri, provider };
  }

  function wrapEsperantoCall(fn) {
    if (typeof fn !== 'function' || fn.__tempoAdWrapped) return fn;
    const wrapped = function tempoExecuteEsperantoCall(call) {
      if (call && call.request instanceof ArrayBuffer && typeof call.onSuccess === 'function') {
        try {
          const view = new DataView(call.request);
          const svcLen = view.byteLength >= 4 ? view.getInt32(0, false) : 0;
          if (svcLen > 0 && svcLen < 256 && 4 + svcLen <= view.byteLength) {
            const service = textDecoder.decode(new Uint8Array(call.request, 4, svcLen));
            if (enabled && service === 'spotify.product_state.esperanto.proto.ProductState') {
              const origSuccess = call.onSuccess;
              call = Object.assign({}, call, {
                onSuccess(payload) {
                  if (enabled && payload instanceof ArrayBuffer) {
                    const patched = patchProductStateAds(new Uint8Array(payload));
                    if (patched) return origSuccess(patched.buffer);
                  }
                  return origSuccess(payload);
                }
              });
            } else if (service === 'spotify.player.esperanto.proto.ContextPlayer' && 8 + svcLen <= view.byteLength) {
              const methodLen = view.getInt32(4 + svcLen, false);
              if (methodLen > 0 && methodLen < 128 && 8 + svcLen + methodLen <= view.byteLength) {
                const method = textDecoder.decode(new Uint8Array(call.request, 8 + svcLen, methodLen));
                if (method === 'GetState' || method === 'SubState') {
                  const origSuccess = call.onSuccess;
                  call = Object.assign({}, call, {
                    onSuccess(payload) {
                      if (payload instanceof ArrayBuffer) {
                        try {
                          const info = extractContextPlayerTrackInfo(new Uint8Array(payload));
                          if (info) {
                            const isAd = (!!info.uri && info.uri.startsWith('spotify:ad:'))
                              || info.provider === 'ad'
                              || info.provider === 'ads';
                            const changed = !esperantoTrackState.known
                              || esperantoTrackState.isAd !== isAd
                              || esperantoTrackState.uri !== info.uri;
                            esperantoTrackState.known = true;
                            esperantoTrackState.isAd = isAd;
                            esperantoTrackState.uri = info.uri;
                            if (changed) {
                              if (!isAd) {
                                restoreAllAdMedia();
                              } else {
                                syncAllMedia();
                              }
                            }
                          }
                        } catch {}
                      }
                      return origSuccess(payload);
                    }
                  });
                }
              }
            }
          }
        } catch {}
      }
      return fn.call(this, call);
    };
    wrapped.__tempoAdWrapped = true;
    return wrapped;
  }

  try {
    let currentEsperanto = wrapEsperantoCall(window.executeEsperantoCall);
    Object.defineProperty(window, 'executeEsperantoCall', {
      configurable: true,
      enumerable: true,
      get() { return currentEsperanto; },
      set(next) { currentEsperanto = wrapEsperantoCall(next); },
    });
  } catch {}

  const origPlay = HTMLMediaElement.prototype.play;
  if (typeof origPlay === 'function') {
    HTMLMediaElement.prototype.play = function tempoPlay() {
      trackMediaElement(this);
      applyMediaGuard(this, 'play');
      if (enabled && classifyAdMedia(this) === 'card') {
        return Promise.resolve();
      }
      return origPlay.apply(this, arguments);
    };
  }

  for (const capEvt of ['loadstart', 'play', 'loadedmetadata', 'durationchange', 'ended', 'emptied']) {
    document.addEventListener(capEvt, (e) => {
      if (e && e.target instanceof HTMLMediaElement) {
        applyMediaGuard(e.target, capEvt);
      }
    }, true);
  }

  const origSendBeacon = navigator.sendBeacon?.bind(navigator);
  if (typeof origSendBeacon === 'function') {
    navigator.sendBeacon = function tempoSendBeacon(url) {
      if (enabled && typeof url === 'string' && TELEMETRY_RE.test(url)) {
        return true;
      }
      return origSendBeacon.apply(navigator, arguments);
    };
  }

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function tempoFetch(input, init) {
      if (!enabled) return origFetch.apply(this, arguments);
      const url = typeof input === 'string' ? input : (input && typeof input.url === 'string' ? input.url : '');
      if (url && TELEMETRY_RE.test(url)) {
        return Promise.resolve(new Response('{}', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }));
      }

      const isPathfinder = url && (url.includes('/pathfinder/') || url.includes('api-partner.spotify.com'));
      if (!isPathfinder) {
        return origFetch.apply(this, arguments);
      }

      let isAccountAttrs = url.includes('accountAttributes')
        || (typeof init?.body === 'string' && init.body.includes('accountAttributes'));
      let reqBodyPromise = null;
      if (!isAccountAttrs && typeof Request !== 'undefined' && input instanceof Request && input.method === 'POST') {
        try {
          reqBodyPromise = input.clone().text().catch(() => '');
        } catch {}
      }

      const fetchPromise = origFetch.apply(this, arguments);
      if (!isAccountAttrs && !reqBodyPromise) {
        return fetchPromise;
      }

      return fetchPromise.then(async (response) => {
        try {
          if (!response || !response.ok) return response;
          if (!isAccountAttrs && reqBodyPromise) {
            const reqText = await reqBodyPromise;
            isAccountAttrs = reqText.includes('accountAttributes');
          }
          if (!isAccountAttrs) return response;
          const payload = await response.clone().json();
          const attrs = payload?.data?.me?.account?.attributes;
          if (attrs && typeof attrs === 'object' && attrs.ads === true) {
            attrs.ads = false;
            const headers = new Headers(response.headers);
            headers.delete('content-length');
            return new Response(JSON.stringify(payload), {
              status: response.status,
              statusText: response.statusText,
              headers,
            });
          }
        } catch {}
        return response;
      });
    };
  }

  window.chrome?.webview?.addEventListener('message', ({ data }) => {
    if (data === 'tempo:adblock:on') setEnabled(true);
    else if (data === 'tempo:adblock:off') setEnabled(false);
  });

  if (document.documentElement) {
    ensureStyleAndAttr();
  }

  function mutationsRequireSync(mutations) {
    if (!styleEl || !styleEl.isConnected || activeAdElements.size > 0 || trackedMedia.size === 0) {
      return true;
    }
    for (let i = 0; i < mutations.length; i++) {
      const added = mutations[i].addedNodes;
      for (let j = 0; j < added.length; j++) {
        const node = added[j];
        if (!node || node.nodeType !== 1) continue;
        const tag = node.tagName;
        if (tag === 'AUDIO' || tag === 'VIDEO' || tag === 'STYLE') return true;
        const tid = node.getAttribute && node.getAttribute('data-testid');
        if (tid && (tid.includes('ad') || tid === 'context-item-link')) return true;
      }
      const removed = mutations[i].removedNodes;
      for (let j = 0; j < removed.length; j++) {
        const node = removed[j];
        if (node && node.nodeType === 1 && node.getAttribute?.('data-testid')?.includes('ad')) return true;
      }
    }
    return false;
  }

  const observer = new MutationObserver((mutations) => {
    if (mutationsRequireSync(mutations)) {
      scheduleSync();
    }
  });
  observer.observe(document, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureStyleAndAttr();
      syncAllMedia();
    }, { once: true });
  }
})();
";
}
