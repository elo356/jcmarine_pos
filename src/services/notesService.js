import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const NOTES_COLLECTION = 'notes';
const NOTES_CACHE_KEY = 'pos:notes-cache';

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
  createdAt: normalizeDateValue(note.createdAt),
  updatedAt: normalizeDateValue(note.updatedAt),
  createdBy: String(note.createdBy || '').trim(),
  createdByName: String(note.createdByName || '').trim(),
  updatedBy: String(note.updatedBy || '').trim(),
  updatedByName: String(note.updatedByName || '').trim()
});

const loadNotesCache = () => {
  if (typeof window === 'undefined') return [];

  const cached = localStorage.getItem(NOTES_CACHE_KEY);
  if (!cached) return [];

  try {
    const parsed = JSON.parse(cached);
    return (Array.isArray(parsed) ? parsed : []).map(normalizeNote).filter((note) => note.id);
  } catch (error) {
    console.error('Error parsing notes cache:', error);
    localStorage.removeItem(NOTES_CACHE_KEY);
    return [];
  }
};

const sortNotes = (notes = []) => (
  [...notes].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
);

const saveNotesCache = (notes = []) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(NOTES_CACHE_KEY, JSON.stringify(sortNotes(notes).map(normalizeNote)));
};

const upsertCachedNote = (note) => {
  const normalized = normalizeNote(note);
  saveNotesCache([
    normalized,
    ...loadNotesCache().filter((item) => item.id !== normalized.id)
  ]);
  return normalized;
};

export const subscribeNotes = (onData, onError) => {
  onData(loadNotesCache(), { fromCache: true });

  const q = query(collection(db, NOTES_COLLECTION), orderBy('updatedAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs
        .map((docSnap) => normalizeNote({ id: docSnap.id, ...docSnap.data() }))
        .filter((note) => note.id);
      saveNotesCache(rows);
      onData(rows, { fromCache: false });
    },
    (error) => {
      const cached = loadNotesCache();
      onData(cached, { fromCache: true, failed: true });
      if (onError) onError(error);
    }
  );
};

export const saveNote = async (note) => {
  const now = new Date().toISOString();
  const cachedExisting = loadNotesCache().find((item) => item.id === note.id);
  const normalized = normalizeNote({
    ...cachedExisting,
    ...note,
    createdAt: note.createdAt || cachedExisting?.createdAt || now,
    updatedAt: now
  });

  upsertCachedNote(normalized);

  try {
    await setDoc(doc(db, NOTES_COLLECTION, normalized.id), normalized, { merge: true });
    return { ...normalized, localOnly: false };
  } catch (error) {
    console.error('Error saving note remotely:', error);
    return { ...normalized, localOnly: true };
  }
};

export const deleteNote = async (noteId) => {
  const normalizedId = String(noteId || '').trim();
  if (!normalizedId) return { id: normalizedId, localOnly: true };

  saveNotesCache(loadNotesCache().filter((note) => note.id !== normalizedId));

  try {
    await deleteDoc(doc(db, NOTES_COLLECTION, normalizedId));
    return { id: normalizedId, localOnly: false };
  } catch (error) {
    console.error('Error deleting note remotely:', error);
    return { id: normalizedId, localOnly: true };
  }
};
