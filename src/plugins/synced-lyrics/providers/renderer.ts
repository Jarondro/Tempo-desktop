import { ProviderNames } from './index';
import { LRCLib } from './LRCLib';
import { YTMusic } from './YTMusic';

export const providers = {
  [ProviderNames.LRCLib]: new LRCLib(),
  [ProviderNames.YTMusic]: new YTMusic(),
  // [ProviderNames.MusixMatch]: new MusixMatch(),
  // [ProviderNames.LyricsGenius]: new LyricsGenius(),
  // [ProviderNames.Megalobiz]: new Megalobiz(), // Disabled because it is too unstable and slow
} as const;
