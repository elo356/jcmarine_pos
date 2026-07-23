import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const NOTES_COLLECTION = 'notes';
const NOTES_CACHE_KEY = 'pos:notes-cache';
const TRASH_CACHE_KEY = 'pos:notes-trash-cache';
export const NOTE_TRASH_RETENTION_DAYS = 10;
const RETENTION_MS = NOTE_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const normalizeDateValue = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return '';
};

export const normalizeNote = (note = {}) => ({
  id: String(note.id || '').trim(),
  title: String(note.title || '').trim(),
  content: String(note.content || note.body || '').trim(),
  status: note.status === 'done' ? 'done' : 'pending',
  createdAt: normalizeDateValue(note.createdAt),
  updatedAt: normalizeDateValue(note.updatedAt),
  createdBy: String(note.createdBy || '').trim(),
  createdByName: String(note.createdByName || '').trim(),
  updatedBy: String(note.updatedBy || '').trim(),
  updatedByName: String(note.updatedByName || '').trim(),
  deletedAt: normalizeDateValue(note.deletedAt),
  expiresAt: normalizeDateValue(note.expiresAt),
  deletedBy: String(note.deletedBy || '').trim(),
  deletedByName: String(note.deletedByName || '').trim()
});

const sortNotes = (notes = [], dateField = 'updatedAt') => (
  [...notes].sort((a, b) => new Date(b[dateField] || b.updatedAt || b.createdAt || 0) - new Date(a[dateField] || a.updatedAt || a.createdAt || 0))
);

const loadCache = (key) => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return (Array.isArray(parsed) ? parsed : []).map(normalizeNote).filter((note) => note.id);
  } catch (error) {
    console.error('Error parsing notes cache:', error);
    localStorage.removeItem(key);
    return [];
  }
};

const saveCache = (key, notes, dateField) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(key, JSON.stringify(sortNotes(notes, dateField).map(normalizeNote)));
  }
};

const isExpired = (note) => {
  const expiry = new Date(note.expiresAt || 0).getTime();
  return Boolean(expiry) && expiry <= Date.now();
};

const purgeExpiredCachedNotes = () => {
  const trash = loadCache(TRASH_CACHE_KEY);
  const validTrash = trash.filter((note) => !isExpired(note));
  if (validTrash.length !== trash.length) saveCache(TRASH_CACHE_KEY, validTrash, 'deletedAt');
  return validTrash;
};

export const subscribeNotes = (onData, onError) => {
  onData(loadCache(NOTES_CACHE_KEY), { fromCache: true });
  const q = query(collection(db, NOTES_COLLECTION), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const rows = snapshot.docs.map((item) => normalizeNote({ id: item.id, ...item.data() }))
      .filter((note) => note.id && !note.deletedAt);
    saveCache(NOTES_CACHE_KEY, rows, 'updatedAt');
    onData(rows, { fromCache: false });
  }, (error) => {
    onData(loadCache(NOTES_CACHE_KEY), { fromCache: true, failed: true });
    if (onError) onError(error);
  });
};

export const subscribeDeletedNotes = (onData, onError) => {
  onData(purgeExpiredCachedNotes(), { fromCache: true });
  const q = query(collection(db, NOTES_COLLECTION), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const trashed = snapshot.docs.map((item) => normalizeNote({ id: item.id, ...item.data() }))
      .filter((note) => note.id && note.deletedAt);
    const activeTrash = trashed.filter((note) => !isExpired(note));
    saveCache(TRASH_CACHE_KEY, activeTrash, 'deletedAt');
    onData(activeTrash, { fromCache: false });
    trashed.filter(isExpired).forEach((note) => deleteDoc(doc(db, NOTES_COLLECTION, note.id)).catch((error) => {
      console.error('Error purging expired note:', error);
    }));
  }, (error) => {
    onData(purgeExpiredCachedNotes(), { fromCache: true, failed: true });
    if (onError) onError(error);
  });
};

export const saveNote = async (note) => {
  const now = new Date().toISOString();
  const cachedExisting = loadCache(NOTES_CACHE_KEY).find((item) => item.id === note.id);
  const normalized = normalizeNote({ ...cachedExisting, ...note, createdAt: note.createdAt || cachedExisting?.createdAt || now, updatedAt: now });
  saveCache(NOTES_CACHE_KEY, [normalized, ...loadCache(NOTES_CACHE_KEY).filter((item) => item.id !== normalized.id)], 'updatedAt');
  saveCache(TRASH_CACHE_KEY, purgeExpiredCachedNotes().filter((item) => item.id !== normalized.id), 'deletedAt');
  try {
    await setDoc(doc(db, NOTES_COLLECTION, normalized.id), normalized, { merge: true });
    return { ...normalized, localOnly: false };
  } catch (error) {
    console.error('Error saving note remotely:', error);
    return { ...normalized, localOnly: true };
  }
};

export const deleteNote = async (note, deletedBy = {}) => {
  const normalizedId = String(note?.id || '').trim();
  if (!normalizedId) return { id: normalizedId, localOnly: true };
  const now = new Date();
  const trashedNote = normalizeNote({
    ...note,
    deletedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RETENTION_MS).toISOString(),
    deletedBy: deletedBy.id || '',
    deletedByName: deletedBy.name || '',
    updatedAt: now.toISOString()
  });
  saveCache(NOTES_CACHE_KEY, loadCache(NOTES_CACHE_KEY).filter((item) => item.id !== normalizedId), 'updatedAt');
  saveCache(TRASH_CACHE_KEY, [trashedNote, ...purgeExpiredCachedNotes().filter((item) => item.id !== normalizedId)], 'deletedAt');
  try {
    await setDoc(doc(db, NOTES_COLLECTION, normalizedId), trashedNote, { merge: true });
    return { ...trashedNote, localOnly: false };
  } catch (error) {
    console.error('Error moving note to trash remotely:', error);
    return { ...trashedNote, localOnly: true };
  }
};

export const restoreNote = async (note, restoredBy = {}) => {
  const restored = normalizeNote({ ...note, deletedAt: '', expiresAt: '', deletedBy: '', deletedByName: '', updatedAt: new Date().toISOString(), updatedBy: restoredBy.id || '', updatedByName: restoredBy.name || '' });
  saveCache(TRASH_CACHE_KEY, purgeExpiredCachedNotes().filter((item) => item.id !== restored.id), 'deletedAt');
  saveCache(NOTES_CACHE_KEY, [restored, ...loadCache(NOTES_CACHE_KEY).filter((item) => item.id !== restored.id)], 'updatedAt');
  try {
    await setDoc(doc(db, NOTES_COLLECTION, restored.id), restored, { merge: true });
    return { ...restored, localOnly: false };
  } catch (error) {
    console.error('Error restoring note remotely:', error);
    return { ...restored, localOnly: true };
  }
};
