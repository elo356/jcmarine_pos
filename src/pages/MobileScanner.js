import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Link2, Link2Off, Send } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getCameraAccessErrorMessage, startCameraBarcodeScanner } from '../utils/cameraBarcodeScanner';
import {
  isSessionUsable,
  normalizeSessionCode,
  pairScannerSession,
  sendVirtualScan,
  subscribeScannerSession
} from '../services/virtualScannerService';

const PAIRED_CODE_KEY = 'pos:virtual-scanner-paired-code';
// La camara detecta el mismo codigo varias veces por segundo; se ignora la
// repeticion hasta que pase este tiempo.
const SAME_CODE_COOLDOWN_MS = 2500;
const MAX_HISTORY = 15;

const detectDeviceLabel = () => {
  const userAgent = navigator.userAgent || '';
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/iPad/i.test(userAgent)) return 'iPad';
  if (/Android/i.test(userAgent)) return 'Android';
  return 'Navegador';
};

const readPairedCode = () => {
  try {
    return localStorage.getItem(PAIRED_CODE_KEY) || '';
  } catch {
    return '';
  }
};

const writePairedCode = (code) => {
  try {
    if (code) localStorage.setItem(PAIRED_CODE_KEY, code);
    else localStorage.removeItem(PAIRED_CODE_KEY);
  } catch {
    // Sin localStorage el celular tendra que volver a escribir el codigo al recargar.
  }
};

function MobileScanner() {
  const { user, profile } = useAuth();
  const [codeInput, setCodeInput] = useState('');
  const [pairedCode, setPairedCode] = useState(readPairedCode);
  const [session, setSession] = useState(null);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [history, setHistory] = useState([]);
  const [flash, setFlash] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const stopCameraRef = useRef(null);
  const lastSentRef = useRef({ barcode: '', at: 0 });

  const disconnect = useCallback((message = '') => {
    writePairedCode('');
    setPairedCode('');
    setSession(null);
    setPairError(message);
  }, []);

  useEffect(() => {
    if (!pairedCode) return undefined;

    return subscribeScannerSession(
      pairedCode,
      (nextSession) => {
        if (!isSessionUsable(nextSession)) {
          disconnect('La sesion fue terminada en la computadora.');
          return;
        }
        if (nextSession.status !== 'paired' || nextSession.pairedUid !== user?.uid) {
          disconnect('La computadora desvinculo este celular.');
          return;
        }
        setSession(nextSession);
      },
      (error) => {
        console.error('Error subscribing to scanner session:', error);
        setPairError('Se perdio la conexion con la sesion.');
      }
    );
  }, [pairedCode, user?.uid, disconnect]);

  const handlePair = async (event) => {
    event.preventDefault();
    setPairing(true);
    setPairError('');
    try {
      const code = await pairScannerSession({
        code: codeInput,
        user,
        profile,
        deviceLabel: detectDeviceLabel()
      });
      writePairedCode(code);
      setPairedCode(code);
      setCodeInput('');
    } catch (error) {
      console.error('Error pairing scanner:', error);
      setPairError(error.message || 'No se pudo vincular.');
    } finally {
      setPairing(false);
    }
  };

  const sendBarcode = useCallback(async (rawBarcode, { fromCamera = false } = {}) => {
    const barcode = String(rawBarcode || '').trim();
    if (!barcode || !pairedCode) return;

    const now = Date.now();
    if (fromCamera
      && lastSentRef.current.barcode === barcode
      && now - lastSentRef.current.at < SAME_CODE_COOLDOWN_MS) {
      return;
    }
    lastSentRef.current = { barcode, at: now };

    const entry = { id: `${now}-${barcode}`, barcode, at: now, status: 'sending' };
    setHistory((current) => [entry, ...current].slice(0, MAX_HISTORY));
    setFlash({ id: entry.id, barcode });
    navigator.vibrate?.(80);

    try {
      await sendVirtualScan({ code: pairedCode, barcode, user });
      setHistory((current) => current.map((item) => (item.id === entry.id ? { ...item, status: 'sent' } : item)));
    } catch (error) {
      console.error('Error sending virtual scan:', error);
      setHistory((current) => current.map((item) => (item.id === entry.id ? { ...item, status: 'error' } : item)));
    }
  }, [pairedCode, user]);

  const sendBarcodeRef = useRef(sendBarcode);
  useEffect(() => {
    sendBarcodeRef.current = sendBarcode;
  }, [sendBarcode]);

  const stopCamera = useCallback(() => {
    stopCameraRef.current?.();
    stopCameraRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (!videoRef.current) return;
    setCameraError('');
    try {
      stopCameraRef.current = await startCameraBarcodeScanner({
        videoElement: videoRef.current,
        streamRef,
        onDetected: (barcode) => sendBarcodeRef.current(barcode, { fromCamera: true })
      });
      setCameraActive(true);
    } catch (error) {
      console.error('Error starting camera scanner:', error);
      if (error?.message === 'INSECURE_CONTEXT') {
        setCameraError('La camara requiere abrir el sistema por HTTPS.');
      } else if (error?.message === 'MEDIA_DEVICES_UNSUPPORTED') {
        setCameraError('Este navegador no permite usar la camara. Usa Chrome o Safari.');
      } else {
        setCameraError(getCameraAccessErrorMessage(error));
      }
    }
  }, []);

  const sessionReady = Boolean(session);
  useEffect(() => {
    if (!sessionReady) return undefined;
    startCamera();
    return () => stopCamera();
  }, [sessionReady, startCamera, stopCamera]);

  useEffect(() => {
    if (!flash) return undefined;
    const timeoutId = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(timeoutId);
  }, [flash]);

  const handleManualSubmit = (event) => {
    event.preventDefault();
    sendBarcode(manualBarcode);
    setManualBarcode('');
  };

  if (!pairedCode) {
    return (
      <div className="mx-auto max-w-md space-y-6">
        <div className="card p-6 space-y-5">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-primary-600">
              <Link2 size={28} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Vincular scanner</h1>
            <p className="mt-2 text-sm text-gray-500">
              En la computadora ve a Configuracion → Scanner virtual, crea una sesion y escribe aqui el codigo.
            </p>
          </div>

          <form onSubmit={handlePair} className="space-y-4">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={codeInput}
              onChange={(event) => setCodeInput(normalizeSessionCode(event.target.value))}
              className="input w-full text-center font-mono text-3xl tracking-[0.5em]"
              autoFocus
            />
            {pairError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{pairError}</div>
            )}
            <button
              type="submit"
              className="btn btn-primary w-full justify-center"
              disabled={pairing || codeInput.length !== 6}
            >
              {pairing ? 'Vinculando...' : 'Vincular'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-green-800">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          {session ? `Conectado a ${session.hostName || 'la computadora'}` : 'Conectando...'}
        </div>
        <button
          type="button"
          onClick={() => disconnect()}
          className="flex items-center gap-1 text-sm font-medium text-gray-600"
        >
          <Link2Off size={16} />
          Salir
        </button>
      </div>

      <div className="relative overflow-hidden rounded-xl bg-black aspect-[3/4]">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-32 -translate-y-1/2 rounded-lg border-2 border-white/70" />
        {flash && (
          <div className="absolute inset-x-4 bottom-4 flex items-center gap-2 rounded-lg bg-green-600 px-4 py-3 text-white shadow-lg">
            <CheckCircle2 size={20} />
            <span className="font-mono font-semibold">{flash.barcode}</span>
          </div>
        )}
        {!cameraActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
            <Camera size={36} />
            <p className="text-sm">{cameraError || 'Iniciando camara...'}</p>
            {cameraError && (
              <button type="button" onClick={startCamera} className="btn btn-secondary">
                Reintentar
              </button>
            )}
          </div>
        )}
      </div>

      <form onSubmit={handleManualSubmit} className="flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          placeholder="Escribir codigo manual"
          value={manualBarcode}
          onChange={(event) => setManualBarcode(event.target.value)}
          className="input flex-1"
        />
        <button type="submit" className="btn btn-primary" disabled={!manualBarcode.trim()}>
          <Send size={18} />
        </button>
      </form>

      {history.length > 0 && (
        <div className="card divide-y divide-gray-100">
          {history.map((item) => (
            <div key={item.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="font-mono text-gray-900">{item.barcode}</span>
              <span className={
                item.status === 'sent'
                  ? 'text-green-600'
                  : item.status === 'error'
                    ? 'text-red-600'
                    : 'text-gray-400'
              }>
                {item.status === 'sent' ? 'Enviado' : item.status === 'error' ? 'Error' : 'Enviando...'}
                {' • '}
                {new Date(item.at).toLocaleTimeString('es-PR', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MobileScanner;
