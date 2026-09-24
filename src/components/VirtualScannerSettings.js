import React from 'react';
import { Link2Off, Power, RefreshCw, Smartphone } from 'lucide-react';
import { useVirtualScanner } from '../contexts/VirtualScannerContext';

const formatCode = (code) => `${code.slice(0, 3)} ${code.slice(3)}`;

function VirtualScannerSettings() {
  const {
    sessionCode,
    session,
    isPaired,
    lastScan,
    error,
    busy,
    startSession,
    endSession,
    unpairDevice
  } = useVirtualScanner();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Scanner virtual</h2>
        <p className="mt-1 text-sm text-gray-500">
          Usa la camara de tu celular como scanner. Crea una sesion, abre el sistema en el celular
          (version web), entra a <span className="font-medium text-gray-700">Scanner</span> y escribe el codigo.
          Lo que escanees aparecera en esta computadora como si fuera el scanner USB.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}

      {!sessionCode ? (
        <button type="button" onClick={startSession} className="btn btn-primary" disabled={busy}>
          <Smartphone size={18} />
          {busy ? 'Creando sesion...' : 'Crear nueva sesion'}
        </button>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
            <p className="text-sm font-medium text-gray-500">Codigo de vinculacion</p>
            <p className="mt-2 font-mono text-5xl font-bold tracking-widest text-gray-900">
              {formatCode(sessionCode)}
            </p>
            <div className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
              isPaired ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
            }`}>
              <span className={`h-2 w-2 rounded-full ${isPaired ? 'bg-green-500' : 'bg-amber-500 animate-pulse'}`} />
              {isPaired
                ? `Vinculado: ${session?.pairedName || 'celular'}${session?.deviceLabel ? ` (${session.deviceLabel})` : ''}`
                : 'Esperando que el celular se vincule...'}
            </div>
          </div>

          {lastScan && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              Ultima lectura: <span className="font-mono font-semibold">{lastScan.barcode}</span>
              {' • '}
              {new Date(lastScan.at).toLocaleTimeString('es-PR')}
            </div>
          )}

          <p className="text-sm text-gray-500">
            La sesion se mantiene activa aunque cambies de pagina o recargues. Expira en 12 horas.
          </p>

          <div className="flex flex-wrap gap-2">
            {isPaired && (
              <button type="button" onClick={unpairDevice} className="btn btn-secondary" disabled={busy}>
                <Link2Off size={18} />
                Desvincular celular
              </button>
            )}
            <button type="button" onClick={startSession} className="btn btn-secondary" disabled={busy}>
              <RefreshCw size={18} />
              Nuevo codigo
            </button>
            <button type="button" onClick={endSession} className="btn btn-danger" disabled={busy}>
              <Power size={18} />
              Terminar sesion
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default VirtualScannerSettings;
