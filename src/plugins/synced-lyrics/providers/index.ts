import * as z from 'zod';

import type { LyricResult } from '../types';

export enum ProviderNames {
  LRCLib = 'LRCLib',
  YTMusic = 'YTMusic',
  // MusixMatch = 'MusixMatch',
  // LyricsGenius = 'LyricsGenius',
  // Megalobiz = 'Megalobiz',
}

export const ProviderNameSchema = z.enum(ProviderNames);
export type ProviderName = z.infer<typeof ProviderNameSchema>;
export const providerNames = ProviderNameSchema.options;

export const resolvePreferredProvider = (
  preferred: unknown,
): ProviderName | null => {
  if (preferred === null) return null;
  const parsed = ProviderNameSchema.safeParse(preferred);
  return parsed.success ? parsed.data : ProviderNames.LRCLib;
};

export type ProviderState = {
  state: 'fetching' | 'done' | 'error';
  data: LyricResult | null;
  error: Error | null;
};
