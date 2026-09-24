import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  VIRTUAL_SCAN_EVENT,
  closeScannerSession,
  createScannerSession,
  isSessionUsable,
  subscribeScannerSession,
  subscribeVirtualScans,
  unpairScannerSession
} from '../services/virtualScannerService';

const VirtualScannerContext = createContext(null);

const storageKey = (uid) => `pos:virtual-scanner-session:${uid}`;

const readStoredCode = (uid) => {
  try {
    return uid ? localStorage.getItem(storageKey(uid)) : null;
  } catch {
    return null;
  }
};

const writeStoredCode = (uid, code) => {
  try {
    if (code) localStorage.setItem(storageKey(uid), code);
    else localStorage.removeItem(storageKey(uid));
  } catch {
    // localStorage no disponible; la sesion solo dura mientras la pagina este abierta.
  }
};

export const VirtualScannerProvider = ({ children }) => {
  const { user, profile } = useAuth();
  const [sessionCode, setSessionCode] = useState(null);
  const [session, setSession] = useState(null);
  const [lastScan, setLastScan] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSessionCode(readStoredCode(user?.uid));
    setSession(null);
    setLastScan(null);
  }, [user?.uid]);

  const clearLocalSession = useCallback(() => {
    writeStoredCode(user?.uid, null);
    setSessionCode(null);
    setSession(null);
  }, [user?.uid]);

  useEffect(() => {
    if (!sessionCode) return undefined;

    return subscribeScannerSession(
      sessionCode,
      (nextSession) => {
        if (!isSessionUsable(nextSession)) {
          clearLocalSession();
          return;
        }
        setSession(nextSession);
      },
      (subscribeError) => {
        console.error('Error subscribing to scanner session:', subscribeError);
        setError('No se pudo conectar con la sesion del scanner virtual.');
      }
    );
  }, [sessionCode, clearLocalSession]);

  useEffect(() => {
    if (!sessionCode) return undefined;

    return subscribeVirtualScans(
      sessionCode,
      (barcode) => {
        setLastScan({ barcode, at: Date.now() });
        window.dispatchEvent(new CustomEvent(VIRTUAL_SCAN_EVENT, { detail: { barcode } }));
      },
      (subscribeError) => console.error('Error subscribing to virtual scans:', subscribeError)
    );
  }, [sessionCode]);

  const startSession = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      if (sessionCode) {
        await closeScannerSession(sessionCode).catch(() => {});
      }
      const code = await createScannerSession({ user, profile });
      writeStoredCode(user.uid, code);
      setSession(null);
      setSessionCode(code);
    } catch (startError) {
      console.error('Error creating scanner session:', startError);
      setError(startError.message || 'No se pudo crear la sesion.');
    } finally {
      setBusy(false);
    }
  }, [user, profile, sessionCode]);

  const endSession = useCallback(async () => {
    if (!sessionCode) return;
    setBusy(true);
    try {
      await closeScannerSession(sessionCode);
    } catch (endError) {
      console.error('Error closing scanner session:', endError);
    } finally {
      clearLocalSession();
      setBusy(false);
    }
  }, [sessionCode, clearLocalSession]);

  const unpairDevice = useCallback(async () => {
    if (!sessionCode) return;
    try {
      await unpairScannerSession(sessionCode);
    } catch (unpairError) {
      console.error('Error unpairing scanner device:', unpairError);
      setError('No se pudo desvincular el dispositivo.');
    }
  }, [sessionCode]);

  const value = useMemo(() => ({
    sessionCode,
    session,
    isPaired: session?.status === 'paired',
    lastScan,
    error,
    busy,
    startSession,
    endSession,
    unpairDevice
  }), [sessionCode, session, lastScan, error, busy, startSession, endSession, unpairDevice]);

  return (
    <VirtualScannerContext.Provider value={value}>
      {children}
    </VirtualScannerContext.Provider>
  );
};

export const useVirtualScanner = () => {
  const context = useContext(VirtualScannerContext);
  if (!context) {
    throw new Error('useVirtualScanner must be used within VirtualScannerProvider');
  }
  return context;
};
