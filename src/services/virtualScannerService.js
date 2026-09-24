import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';
import { db } from '../firebase/config';

const SESSIONS_COLLECTION = 'scannerSessions';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const CODE_LENGTH = 6;

export const VIRTUAL_SCAN_EVENT = 'virtual-scanner:scan';

const sessionRef = (code) => doc(db, SESSIONS_COLLECTION, code);
const scansCollection = (code) => collection(db, SESSIONS_COLLECTION, code, 'scans');

const generateCode = () => {
  const values = new Uint32Array(1);
  window.crypto.getRandomValues(values);
  return String(values[0] % 10 ** CODE_LENGTH).padStart(CODE_LENGTH, '0');
};

export const normalizeSessionCode = (value) => String(value || '').replace(/\D/g, '').slice(0, CODE_LENGTH);

export const isSessionExpired = (session) => !session?.expiresAt || session.expiresAt < Date.now();

export const isSessionUsable = (session) => Boolean(session) && session.status !== 'closed' && !isSessionExpired(session);

// Crea la sesion desde la computadora. El codigo es el id del documento para que
// el celular lo encuentre directo sin necesitar consultas.
export const createScannerSession = async ({ user, profile }) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    const existing = await getDoc(sessionRef(code));
    if (existing.exists() && isSessionUsable(existing.data())) continue;

    const session = {
      code,
      status: 'waiting',
      hostUid: user.uid,
      hostName: profile?.name || user.email || '',
      pairedUid: null,
      pairedName: null,
      deviceLabel: null,
      createdAt: serverTimestamp(),
      pairedAt: null,
      expiresAt: Date.now() + SESSION_TTL_MS
    };
    await setDoc(sessionRef(code), session);
    return code;
  }

  throw new Error('No se pudo generar un codigo unico. Intenta de nuevo.');
};

export const pairScannerSession = async ({ code, user, profile, deviceLabel }) => {
  const normalizedCode = normalizeSessionCode(code);
  if (normalizedCode.length !== CODE_LENGTH) {
    throw new Error('El codigo debe tener 6 digitos.');
  }

  const snapshot = await getDoc(sessionRef(normalizedCode));
  const session = snapshot.exists() ? snapshot.data() : null;
  if (!isSessionUsable(session)) {
    throw new Error('Codigo invalido o expirado. Crea una nueva sesion en la computadora.');
  }

  if (session.status === 'paired' && session.pairedUid && session.pairedUid !== user.uid) {
    throw new Error('Esta sesion ya esta vinculada a otro dispositivo.');
  }

  await updateDoc(sessionRef(normalizedCode), {
    status: 'paired',
    pairedUid: user.uid,
    pairedName: profile?.name || user.email || '',
    deviceLabel: deviceLabel || null,
    pairedAt: serverTimestamp()
  });

  return normalizedCode;
};

export const unpairScannerSession = (code) => updateDoc(sessionRef(code), {
  status: 'waiting',
  pairedUid: null,
  pairedName: null,
  deviceLabel: null,
  pairedAt: null
});

export const closeScannerSession = (code) => updateDoc(sessionRef(code), { status: 'closed' });

export const subscribeScannerSession = (code, onChange, onError) => onSnapshot(
  sessionRef(code),
  (snapshot) => onChange(snapshot.exists() ? snapshot.data() : null),
  onError
);

export const sendVirtualScan = ({ code, barcode, user }) => addDoc(scansCollection(code), {
  barcode: String(barcode || '').trim(),
  uid: user.uid,
  createdAt: serverTimestamp(),
  clientCreatedAt: Date.now()
});

// Cada lectura se entrega una sola vez: la computadora la procesa y la borra, asi
// no se repiten lecturas al recargar la pagina.
export const subscribeVirtualScans = (code, onScan, onError) => {
  const scansQuery = query(scansCollection(code), orderBy('clientCreatedAt', 'asc'));
  const handledIds = new Set();

  return onSnapshot(scansQuery, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type !== 'added' || handledIds.has(change.doc.id)) return;
      handledIds.add(change.doc.id);

      const data = change.doc.data();
      if (data.barcode) onScan(data.barcode);

      deleteDoc(change.doc.ref).catch((error) => {
        console.error('Error clearing virtual scan:', error);
      });
    });
  }, onError);
};
