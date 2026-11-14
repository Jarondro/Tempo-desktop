/*
 * Source: https://addons.mozilla.org/en-US/firefox/addon/adblock-for-youtube/
 * https://robwu.nl/crxviewer/?crx=https%3A%2F%2Faddons.mozilla.org%2Fen-US%2Ffirefox%2Faddon%2Fadblock-for-youtube%2F
 *
 * Parts of this code is derived from set-constant.js:
 * https://github.com/gorhill/uBlock/blob/5de0ce975753b7565759ac40983d31978d1f84ca/assets/resources/scriptlets.js#L704
 */

import type { ContextBridge } from 'electron';

interface PrunableResponse {
  playerAds?: unknown;
  adPlacements?: unknown;
  adSlots?: unknown;
  playerResponse?: PrunableResponse;
  ytInitialPlayerResponse?: PrunableResponse;
  [key: string]: unknown;
}

interface MainWorldWindow extends Window {
  __tempoAdblockActive?: boolean;
  __tempoAdblockInstalled?: boolean;
  _pruner?: (o: unknown) => unknown;
  ytInitialPlayerResponse?: unknown;
  playerResponse?: unknown;
}

let injected = false;

export const isInjected = (): boolean => injected;

export const inject = (contextBridge: ContextBridge): void => {
  injected = true;

  const pruner = (o: unknown): unknown => {
    if (!o || typeof o !== 'object' || Object.isFrozen(o)) {
      return o;
    }

    const obj = o as PrunableResponse;
    delete obj.playerAds;
    delete obj.adPlacements;
    delete obj.adSlots;
    if (
      obj.playerResponse &&
      typeof obj.playerResponse === 'object' &&
      !Object.isFrozen(obj.playerResponse)
    ) {
      delete obj.playerResponse.playerAds;
      delete obj.playerResponse.adPlacements;
      delete obj.playerResponse.adSlots;
    }
    if (
      obj.ytInitialPlayerResponse &&
      typeof obj.ytInitialPlayerResponse === 'object' &&
      !Object.isFrozen(obj.ytInitialPlayerResponse)
    ) {
      delete obj.ytInitialPlayerResponse.playerAds;
      delete obj.ytInitialPlayerResponse.adPlacements;
      delete obj.ytInitialPlayerResponse.adSlots;
    }

    return obj;
  };

  contextBridge.exposeInMainWorld('_pruner', pruner);
};

function installInMainWorld() {
  const win = window as unknown as MainWorldWindow;
  win.__tempoAdblockActive = true;
  if (win.__tempoAdblockInstalled) return;
  win.__tempoAdblockInstalled = true;

  const _prunerFn = win._pruner;
  win._pruner = undefined;
  if (typeof _prunerFn !== 'function') return;
  const pruner = _prunerFn;

  function prune<T>(value: T): T {
    return (win.__tempoAdblockActive ? pruner(value) : value) as T;
  }

  JSON.parse = new Proxy(JSON.parse, {
    apply(target, thisArg, argArray) {
      return prune(Reflect.apply(target, thisArg, argArray) as unknown);
    },
  });

  const originalResponseJson = Reflect.get(Response.prototype, 'json') as
    | (() => Promise<unknown>)
    | undefined;
  if (typeof originalResponseJson === 'function') {
    Response.prototype.json = new Proxy(originalResponseJson, {
      apply(target, thisArg, argArray) {
        return (Reflect.apply(target, thisArg, argArray) as Promise<unknown>).then(
          prune,
        );
      },
    });
  }

  if (win.ytInitialPlayerResponse && win.__tempoAdblockActive) {
    prune(win.ytInitialPlayerResponse);
  }
  if (win.playerResponse && win.__tempoAdblockActive) {
    prune(win.playerResponse);
  }

  type PropertyOwner = Record<string, unknown>;
  interface TrapHandler {
    v: unknown;
    init(value: unknown): boolean;
    getter(): unknown;
    setter(value: unknown): void;
  }

  const chains = [
    'playerResponse.adPlacements',
    'playerResponse.playerAds',
    'playerResponse.adSlots',
    'ytInitialPlayerResponse.playerAds',
    'ytInitialPlayerResponse.adPlacements',
    'ytInitialPlayerResponse.adSlots',
  ];

  const trapProp = (
    owner: PropertyOwner,
    prop: string,
    configurable: boolean,
    handler: TrapHandler,
  ) => {
    if (!handler.init(owner[prop])) return;

    const odesc = Object.getOwnPropertyDescriptor(owner, prop);
    let previousGetter: (() => unknown) | undefined;
    let previousSetter: ((value: unknown) => void) | undefined;
    if (odesc instanceof Object) {
      if (odesc.configurable === false) return;
      if (odesc.get instanceof Function) {
        // oxlint-disable-next-line typescript/unbound-method
        previousGetter = odesc.get;
      }
      if (odesc.set instanceof Function) {
        // oxlint-disable-next-line typescript/unbound-method
        previousSetter = odesc.set;
      }
    }

    Object.defineProperty(owner, prop, {
      configurable,
      get() {
        if (previousGetter !== undefined) previousGetter();
        return handler.getter();
      },
      set(a: unknown) {
        if (previousSetter !== undefined) previousSetter(a);
        handler.setter(a);
      },
    });
  };

  const trapChain = (owner: PropertyOwner, chain: string) => {
    const pos = chain.indexOf('.');
    if (pos === -1) {
      trapProp(owner, chain, false, {
        v: undefined,
        getter() {
          return win.__tempoAdblockActive ? undefined : this.v;
        },
        setter(a) {
          this.v = a;
        },
        init(v) {
          this.v = v;
          return true;
        },
      });
      return;
    }

    const prop = chain.slice(0, pos);
    const v = owner[prop];
    const remainingChain = chain.slice(pos + 1);
    if (v instanceof Object || (typeof v === 'object' && v !== null)) {
      trapChain(v as PropertyOwner, remainingChain);
      return;
    }

    trapProp(owner, prop, true, {
      v: undefined,
      getter() {
        return this.v;
      },
      setter(a) {
        this.v = a;
        if (a instanceof Object) {
          trapChain(a as PropertyOwner, remainingChain);
        }
      },
      init(initialValue) {
        this.v = initialValue;
        return true;
      },
    });
  };

  for (const chain of chains) {
    trapChain(window as unknown as PropertyOwner, chain);
  }
}

export const buildMainWorldScript = (): string =>
  `(${installInMainWorld.toString()})(); 0`;
