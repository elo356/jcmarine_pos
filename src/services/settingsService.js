import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const SETTINGS_DOC_ID = 'business';
const SETTINGS_CACHE_KEY = 'pos:system-settings';

export const DEFAULT_WEEKLY_SHIFT_SETTINGS = {
  closeDay: 6,
  closeTime: '23:00'
};

export const DEFAULT_BACKUP_SETTINGS = {
  enabled: false,
  intervalDays: 7,
};

export const DEFAULT_STORE_HOURS = {
  0: { open: false, openTime: '08:00', closeTime: '17:00' },
  1: { open: true,  openTime: '08:00', closeTime: '17:00' },
  2: { open: true,  openTime: '08:00', closeTime: '17:00' },
  3: { open: true,  openTime: '08:00', closeTime: '17:00' },
  4: { open: true,  openTime: '08:00', closeTime: '17:00' },
  5: { open: true,  openTime: '08:00', closeTime: '17:00' },
  6: { open: true,  openTime: '08:00', closeTime: '14:00' },
};

export const DEFAULT_SYSTEM_SETTINGS = {
  weeklyShift: DEFAULT_WEEKLY_SHIFT_SETTINGS,
  backup: DEFAULT_BACKUP_SETTINGS,
  storeHours: DEFAULT_STORE_HOURS,
};

export const normalizeWeeklyShiftSettings = (settings = {}) => {
  const closeDay = Number(settings.closeDay);
  const closeTime = /^\d{2}:\d{2}$/.test(String(settings.closeTime || ''))
    ? String(settings.closeTime)
    : DEFAULT_WEEKLY_SHIFT_SETTINGS.closeTime;

  return {
    closeDay: Number.isInteger(closeDay) && closeDay >= 0 && closeDay <= 6
      ? closeDay
      : DEFAULT_WEEKLY_SHIFT_SETTINGS.closeDay,
    closeTime
  };
};

const normalizeBackupSettings = (s = {}) => ({
  enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_BACKUP_SETTINGS.enabled,
  intervalDays: [1, 7, 14, 30].includes(Number(s.intervalDays))
    ? Number(s.intervalDays)
    : DEFAULT_BACKUP_SETTINGS.intervalDays,
});

const normalizeStoreHours = (hours = {}) => {
  const result = {};
  for (let day = 0; day <= 6; day++) {
    const h = hours[day] || {};
    result[day] = {
      open: typeof h.open === 'boolean' ? h.open : DEFAULT_STORE_HOURS[day].open,
      openTime: /^\d{2}:\d{2}$/.test(String(h.openTime || '')) ? h.openTime : DEFAULT_STORE_HOURS[day].openTime,
      closeTime: /^\d{2}:\d{2}$/.test(String(h.closeTime || '')) ? h.closeTime : DEFAULT_STORE_HOURS[day].closeTime,
    };
  }
  return result;
};

export const normalizeSystemSettings = (settings = {}) => ({
  ...DEFAULT_SYSTEM_SETTINGS,
  ...settings,
  weeklyShift: normalizeWeeklyShiftSettings(settings.weeklyShift),
  backup: normalizeBackupSettings(settings.backup),
  storeHours: normalizeStoreHours(settings.storeHours),
});

const loadCache = () => {
  if (typeof window === 'undefined') return DEFAULT_SYSTEM_SETTINGS;

  const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
  if (!raw) return DEFAULT_SYSTEM_SETTINGS;

  try {
    return normalizeSystemSettings(JSON.parse(raw));
  } catch (error) {
    console.error('Error parsing system settings cache:', error);
    localStorage.removeItem(SETTINGS_CACHE_KEY);
    return DEFAULT_SYSTEM_SETTINGS;
  }
};

const saveCache = (settings) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(normalizeSystemSettings(settings)));
};

export const getCachedSystemSettings = () => loadCache();

export const subscribeSystemSettings = (onData, onError) => {
  onData(loadCache(), { fromCache: true });

  return onSnapshot(
    doc(db, 'settings', SETTINGS_DOC_ID),
    (snapshot) => {
      const settings = normalizeSystemSettings(snapshot.exists() ? snapshot.data() : DEFAULT_SYSTEM_SETTINGS);
      saveCache(settings);
      onData(settings, { fromCache: false });
    },
    (error) => {
      onData(loadCache(), { fromCache: true, failed: true });
      if (onError) onError(error);
    }
  );
};

export const saveSystemSettings = async (settings) => {
  const normalized = normalizeSystemSettings(settings);
  saveCache(normalized);
  await setDoc(doc(db, 'settings', SETTINGS_DOC_ID), normalized, { merge: true });
  return normalized;
};
