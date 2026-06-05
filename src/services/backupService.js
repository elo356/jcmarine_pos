'use strict';

import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';

const BACKUP_STATE_KEY = 'pos:backup-state';

const COLLECTIONS = [
  'sales', 'products', 'inventoryLogs', 'categories', 'customers',
  'employees', 'shifts', 'weeklyShiftClosures', 'specialOrders',
  'specialOrderPayments', 'payments', 'financeCompanies',
  'storeStatusLogs', 'settings', 'expenses', 'invoices', 'notes', 'roles',
];

// ── Local state (per-device, not synced to Firestore) ─────────────────────────
export const getBackupState = () => {
  try {
    return JSON.parse(localStorage.getItem(BACKUP_STATE_KEY) || '{}');
  } catch {
    return {};
  }
};

export const setBackupState = (patch) => {
  localStorage.setItem(BACKUP_STATE_KEY, JSON.stringify({ ...getBackupState(), ...patch }));
};

// ── Helpers ───────────────────────────────────────────────────────────────────
export const isBackupDue = (intervalDays, lastBackupAt) => {
  if (!lastBackupAt) return true;
  const elapsed = Date.now() - new Date(lastBackupAt).getTime();
  return elapsed >= intervalDays * 24 * 60 * 60 * 1000;
};

export const nextBackupDate = (intervalDays, lastBackupAt) => {
  if (!lastBackupAt) return new Date();
  return new Date(new Date(lastBackupAt).getTime() + intervalDays * 24 * 60 * 60 * 1000);
};

const isElectron = () =>
  typeof window !== 'undefined' && /electron/i.test(navigator.userAgent);

// ── Core export ───────────────────────────────────────────────────────────────
export const exportFirestore = async (onProgress) => {
  const backup = { exportedAt: new Date().toISOString(), version: '1.0', collections: {} };

  for (let i = 0; i < COLLECTIONS.length; i++) {
    const name = COLLECTIONS[i];
    if (onProgress) onProgress({ collection: name, index: i, total: COLLECTIONS.length });
    try {
      const snapshot = await getDocs(collection(db, name));
      const docs = {};
      snapshot.forEach((d) => { docs[d.id] = d.data(); });
      backup.collections[name] = docs;
    } catch (err) {
      console.warn(`[backup] Skipping "${name}": ${err.message}`);
    }
  }

  return backup;
};

// ── Save / download ───────────────────────────────────────────────────────────
const buildFilename = () => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `cjmarine-backup-${ts}.json`;
};

const downloadJson = (data, filename) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const saveToElectron = (json, filename, folder) =>
  window.electronAPI.backup.save(json, filename, folder || null);

export const saveBackup = async (data, folder) => {
  const filename = buildFilename();
  const json = JSON.stringify(data, null, 2);

  if (isElectron() && window.electronAPI?.backup) {
    return saveToElectron(json, filename, folder);
  }

  downloadJson(data, filename);
  return { success: true, savedPath: filename };
};

export const chooseBackupFolder = () => {
  if (!isElectron() || !window.electronAPI?.backup) return Promise.resolve(null);
  return window.electronAPI.backup.chooseFolder();
};

// ── Main entry point ──────────────────────────────────────────────────────────
export const runBackup = async (folder, onProgress) => {
  const data = await exportFirestore(onProgress);
  const result = await saveBackup(data, folder);
  const now = new Date().toISOString();
  setBackupState({ lastBackupAt: now, lastBackupPath: result?.savedPath });
  return { ...result, exportedAt: data.exportedAt };
};
