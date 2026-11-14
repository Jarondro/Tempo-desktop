import i18next, { init, t as i18t, changeLanguage } from 'i18next';
import { languageResources } from 'virtual:i18n';

export const APPLICATION_NAME = 'Tempo Desktop';
export const SUPPORTED_LANGUAGES = ['cs', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Normalizes configured or OS locale codes to one of the bundled languages. */
export const resolveLanguage = (
  language?: string | null,
): SupportedLanguage => {
  const normalized = language?.trim().toLowerCase();
  if (
    normalized === 'cs' ||
    normalized?.startsWith('cs-') ||
    normalized?.startsWith('cs_')
  ) {
    return 'cs';
  }
  return 'en';
};

export const loadI18n = async () =>
  await init({
    resources: await languageResources(),
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export const setLanguage = async (language: string) =>
  await changeLanguage(language);

export const t = i18t.bind(i18next);
