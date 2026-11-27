export type LocaleId = 'en' | 'ta' | 'ar';
export type LocaleDirection = 'ltr' | 'rtl';

export const SECURITY_CONSENT_VERSION = 1;

export interface LocaleMessages {
  readonly 'app.title': string;
  readonly 'command.settings': string;
  readonly 'command.palette': string;
  readonly 'command.save': string;
  readonly 'security.cloudConsent': string;
  readonly 'recovery.notBackup': string;
  readonly 'keybindings.conflict': string;
  readonly 'keybindings.reset': string;
}

export type LocaleKey = keyof LocaleMessages;

const EN_MESSAGES: LocaleMessages = {
  'app.title': 'Wrytrove',
  'command.settings': 'Open Settings',
  'command.palette': 'Open Command Palette',
  'command.save': 'Save',
  'security.cloudConsent': 'Cloud AI requests send selected text to an external provider.',
  'recovery.notBackup': 'Draft recovery is not a substitute for backups.',
  'keybindings.conflict': 'Shortcut {chord} is already assigned to {command}.',
  'keybindings.reset': 'Reset all shortcuts to defaults',
};

const LOCALE_BUNDLES: Readonly<Record<LocaleId, Partial<LocaleMessages>>> = {
  en: EN_MESSAGES,
  ta: {
    'app.title': 'Wrytrove',
    'command.settings': 'அமைப்புகளைத் திற',
    'command.palette': 'கட்டளைப் பலகையைத் திற',
    'command.save': 'சேமி',
  },
  ar: {
    'app.title': 'Wrytrove',
    'command.settings': 'فتح الإعدادات',
    'command.palette': 'فتح لوحة الأوامر',
    'command.save': 'حفظ',
  },
};

export function getDirection(locale: LocaleId): LocaleDirection {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export function resolveLocale(requested: unknown): LocaleId {
  if (typeof requested !== 'string') return 'en';
  const normalized = requested.trim().toLowerCase().split('-')[0];
  if (normalized === 'ta' || normalized === 'ar' || normalized === 'en') {
    return normalized;
  }
  return 'en';
}

export function t(
  locale: LocaleId,
  key: LocaleKey,
  params?: Readonly<Record<string, string>>,
  customOverrides?: unknown,
): string {
  const overrideMap =
    customOverrides && typeof customOverrides === 'object' && !Array.isArray(customOverrides)
      ? (customOverrides as Record<string, unknown>)
      : null;

  const overrideVal = overrideMap?.[key];
  const bundleVal = LOCALE_BUNDLES[locale]?.[key];
  let template =
    typeof overrideVal === 'string' && overrideVal.length > 0
      ? overrideVal
      : typeof bundleVal === 'string' && bundleVal.length > 0
        ? bundleVal
        : EN_MESSAGES[key];

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      template = template.replaceAll(`{${k}}`, v);
    }
  }
  return template;
}
