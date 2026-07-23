import React, { useEffect, useState } from 'react';
import { CheckCircle, FolderOpen, Play, RefreshCw } from 'lucide-react';
import {
  chooseBackupFolder,
  getBackupState,
  isBackupDue,
  nextBackupDate,
  runBackup,
} from '../services/backupService';

const INTERVAL_OPTIONS = [
  { value: 1,  label: 'Diario (1 día)' },
  { value: 7,  label: 'Semanal (7 días)' },
  { value: 14, label: 'Quincenal (14 días)' },
  { value: 30, label: 'Mensual (30 días)' },
];

const isElectron = () =>
  typeof window !== 'undefined' && /electron/i.test(navigator.userAgent);

function fmt(isoStr) {
  if (!isoStr) return null;
  return new Date(isoStr).toLocaleString('es-PR', {
    dateStyle: 'medium', timeStyle: 'short',
  });
}

function BackupSettings({ backup, onChange }) {
  const [state, setState] = useState(getBackupState);
  const [progress, setProgress] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => { setState(getBackupState()); }, []);

  const handleToggle = () => onChange({ ...backup, enabled: !backup.enabled });
  const handleInterval = (e) => onChange({ ...backup, intervalDays: Number(e.target.value) });

  const handleChooseFolder = async () => {
    const folder = await chooseBackupFolder();
    if (folder) setState((s) => ({ ...s, folder }));
  };

  const handleRunBackup = async () => {
    setProgress({ label: 'Iniciando...', pct: 0 });
    setStatus(null);
    try {
      const result = await runBackup(
        state.folder,
        ({ collection, index, total }) => {
          setProgress({
            label: `Exportando ${collection}...`,
            pct: Math.round(((index + 1) / total) * 100),
          });
        }
      );
      setState(getBackupState());
      setStatus({ ok: true, path: result.savedPath });
    } catch (err) {
      setStatus({ ok: false, msg: err.message });
    } finally {
      setProgress(null);
    }
  };

  const { lastBackupAt, folder } = state;
  const due = isBackupDue(backup.intervalDays, lastBackupAt);
  const next = backup.enabled ? nextBackupDate(backup.intervalDays, lastBackupAt) : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Copia de seguridad automática</h2>
        <p className="mt-1 text-sm text-gray-500">
          Exporta todos los datos de Firestore a un archivo JSON local.
        </p>
      </div>

      {/* Toggle */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
        <div>
          <p className="font-medium text-gray-800">Copias automáticas</p>
          <p className="text-sm text-gray-500">El sistema hará la copia cuando esté abierto y toque</p>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          className={`relative h-6 w-11 rounded-full transition-colors focus:outline-none ${
            backup.enabled ? 'bg-blue-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              backup.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Interval */}
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">Frecuencia</label>
        <select
          value={backup.intervalDays}
          onChange={handleInterval}
          className="input w-full md:w-64"
        >
          {INTERVAL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Folder (Electron only) */}
      {isElectron() && (
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Carpeta de destino</label>
          <div className="flex items-center gap-3">
            <div className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 truncate">
              {folder || 'Documentos / CJMarine-Backups  (por defecto)'}
            </div>
            <button type="button" onClick={handleChooseFolder} className="btn btn-secondary">
              <FolderOpen size={16} />
              Cambiar
            </button>
          </div>
        </div>
      )}

      {/* Status info */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
          <p className="text-gray-500">Última copia</p>
          <p className="font-semibold text-gray-800">
            {fmt(lastBackupAt) || 'Ninguna'}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
          <p className="text-gray-500">Próxima copia automática</p>
          <p className={`font-semibold ${due ? 'text-amber-600' : 'text-gray-800'}`}>
            {!backup.enabled
              ? 'Desactivada'
              : due
                ? 'Pendiente ahora'
                : fmt(next?.toISOString())}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {progress && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{progress.label}</span>
            <span>{progress.pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-200"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Result status */}
      {status && (
        <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
          status.ok
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          <CheckCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            {status.ok ? (
              <>
                <p className="font-medium">Copia completada</p>
                {status.path && <p className="text-xs opacity-75 break-all">{status.path}</p>}
              </>
            ) : (
              <p>{status.msg}</p>
            )}
          </div>
        </div>
      )}

      {/* Manual backup button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleRunBackup}
          disabled={!!progress}
          className="btn btn-primary"
        >
          {progress ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
          {progress ? 'Haciendo copia...' : 'Hacer copia ahora'}
        </button>
        <p className="text-xs text-gray-500">
          {isElectron()
            ? 'Se guarda como archivo JSON en la carpeta configurada'
            : 'Se descargará un archivo JSON'}
        </p>
      </div>
    </div>
  );
}

export default BackupSettings;
