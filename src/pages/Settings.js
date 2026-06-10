import React, { useEffect, useMemo, useState } from 'react';
import { Archive, CalendarDays, Clock, Save, ShieldCheck } from 'lucide-react';
import Notification from '../components/Notification';
import RolesPermissions from './RolesPermissions';
import BackupSettings from '../components/BackupSettings';
import {
  DEFAULT_SYSTEM_SETTINGS,
  saveSystemSettings,
  subscribeSystemSettings
} from '../services/settingsService';

const DAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
import { getBackupState, isBackupDue, runBackup } from '../services/backupService';

const DAY_OPTIONS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miercoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sabado' }
];

function SettingsPage() {
  const [activeSection, setActiveSection] = useState('weekly');
  const [settings, setSettings] = useState(DEFAULT_SYSTEM_SETTINGS);
  const [form, setForm] = useState(DEFAULT_SYSTEM_SETTINGS.weeklyShift);
  const [hoursForm, setHoursForm] = useState(DEFAULT_SYSTEM_SETTINGS.storeHours);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState(null);
  const [syncMeta, setSyncMeta] = useState({ fromCache: true, failed: false });

  useEffect(() => {
    const unsubscribe = subscribeSystemSettings(
      (nextSettings, meta = {}) => {
        setSettings(nextSettings);
        setForm(nextSettings.weeklyShift);
        setHoursForm(nextSettings.storeHours);
        setSyncMeta(meta);

        // Auto-run backup if enabled and due (runs once after settings load from server)
        if (!meta.fromCache && nextSettings.backup?.enabled) {
          const { lastBackupAt, folder } = getBackupState();
          if (isBackupDue(nextSettings.backup.intervalDays, lastBackupAt)) {
            runBackup(folder).catch((err) =>
              console.error('[backup] Auto-backup failed:', err)
            );
          }
        }
      },
      (error) => console.error('Error loading system settings:', error)
    );

    return () => unsubscribe();
  }, []);

  const closeSummary = useMemo(() => {
    const day = DAY_OPTIONS.find((option) => option.value === Number(form.closeDay))?.label || 'Sabado';
    const [hours = '23', minutes = '00'] = String(form.closeTime || '23:00').split(':');
    const date = new Date();
    date.setHours(Number(hours), Number(minutes), 0, 0);

    return `${day} a las ${date.toLocaleTimeString('es-PR', {
      hour: 'numeric',
      minute: '2-digit'
    })}`;
  }, [form.closeDay, form.closeTime]);

  const showNotification = (type, message) => {
    setNotification({ id: Date.now(), type, message });
  };

  const handleSaveWeeklySettings = async () => {
    setSaving(true);
    try {
      await saveSystemSettings({
        ...settings,
        weeklyShift: { closeDay: Number(form.closeDay), closeTime: form.closeTime },
      });
      showNotification('success', 'Configuracion semanal guardada.');
    } catch (error) {
      console.error(error);
      showNotification('warning', 'Se guardo localmente, pero no se pudo sincronizar con Firestore.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveStoreHours = async () => {
    setSaving(true);
    try {
      await saveSystemSettings({ ...settings, storeHours: hoursForm });
      showNotification('success', 'Horario de la tienda guardado.');
    } catch (error) {
      console.error(error);
      showNotification('warning', 'Se guardo localmente, pero no se pudo sincronizar con Firestore.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBackup = async (backupConfig) => {
    setSaving(true);
    try {
      const updated = { ...settings, backup: backupConfig };
      await saveSystemSettings(updated);
      setSettings(updated);
      showNotification('success', 'Configuracion de copias de seguridad guardada.');
    } catch (error) {
      console.error(error);
      showNotification('warning', 'Se guardo localmente, pero no se pudo sincronizar con Firestore.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      {notification && (
        <Notification
          key={notification.id}
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Configuracion</h1>
          <p className="text-sm text-gray-500">Ajustes administrativos del sistema.</p>
        </div>
        <div className={`rounded-lg border px-3 py-2 text-sm font-medium ${
          syncMeta.failed
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : syncMeta.fromCache
              ? 'border-blue-200 bg-blue-50 text-blue-800'
              : 'border-green-200 bg-green-50 text-green-800'
        }`}>
          {syncMeta.failed ? 'Configuracion desde cache local' : syncMeta.fromCache ? 'Cargando configuracion...' : 'Configuracion sincronizada'}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveSection('weekly')}
          className={`btn ${activeSection === 'weekly' ? 'btn-primary' : 'btn-secondary'}`}
        >
          <Clock size={18} />
          Cierre semanal
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('storeHours')}
          className={`btn ${activeSection === 'storeHours' ? 'btn-primary' : 'btn-secondary'}`}
        >
          <CalendarDays size={18} />
          Horario de tienda
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('backup')}
          className={`btn ${activeSection === 'backup' ? 'btn-primary' : 'btn-secondary'}`}
        >
          <Archive size={18} />
          Copia de seguridad
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('roles')}
          className={`btn ${activeSection === 'roles' ? 'btn-primary' : 'btn-secondary'}`}
        >
          <ShieldCheck size={18} />
          Roles y permisos
        </button>
      </div>

      {activeSection === 'storeHours' ? (
        <div className="card p-6 space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Horario de la tienda</h2>
            <p className="mt-1 text-sm text-gray-500">
              Configure los dias y horas de operacion para cada dia de la semana.
            </p>
          </div>

          <div className="space-y-2">
            {DAY_LABELS.map((label, day) => {
              const h = hoursForm[day];
              return (
                <div
                  key={day}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border px-4 py-3 transition-colors ${
                    h.open ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'
                  }`}
                >
                  <span className="w-24 text-sm font-medium text-gray-700">{label}</span>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={h.open}
                      onClick={() =>
                        setHoursForm((prev) => ({
                          ...prev,
                          [day]: { ...prev[day], open: !prev[day].open },
                        }))
                      }
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                        h.open ? 'bg-blue-600' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          h.open ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <span className={`w-14 text-sm ${h.open ? 'text-gray-700' : 'text-gray-400'}`}>
                      {h.open ? 'Abierto' : 'Cerrado'}
                    </span>
                  </div>

                  <div className={`flex flex-wrap items-center gap-3 ${!h.open ? 'pointer-events-none opacity-40' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Apertura</span>
                      <input
                        type="time"
                        value={h.openTime}
                        onChange={(e) =>
                          setHoursForm((prev) => ({
                            ...prev,
                            [day]: { ...prev[day], openTime: e.target.value },
                          }))
                        }
                        className="input"
                      />
                    </div>
                    <span className="text-gray-400">—</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Cierre</span>
                      <input
                        type="time"
                        value={h.closeTime}
                        onChange={(e) =>
                          setHoursForm((prev) => ({
                            ...prev,
                            [day]: { ...prev[day], closeTime: e.target.value },
                          }))
                        }
                        className="input"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSaveStoreHours}
              className="btn btn-primary"
              disabled={saving}
            >
              <Save size={18} />
              {saving ? 'Guardando...' : 'Guardar horario'}
            </button>
          </div>
        </div>
      ) : activeSection === 'backup' ? (
        <div className="card p-6 space-y-6">
          <BackupSettings
            backup={settings.backup}
            onChange={handleSaveBackup}
          />
        </div>
      ) : activeSection === 'weekly' ? (
        <div className="card p-6 space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Cierre automatico de shifts semanales</h2>
            <p className="mt-1 text-sm text-gray-500">
              El sistema cerrara automaticamente los shifts semanales cuando llegue este dia y hora.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Dia de cierre</label>
              <select
                value={form.closeDay}
                onChange={(event) => setForm((current) => ({ ...current, closeDay: Number(event.target.value) }))}
                className="input w-full"
              >
                {DAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Hora de cierre</label>
              <input
                type="time"
                value={form.closeTime}
                onChange={(event) => setForm((current) => ({ ...current, closeTime: event.target.value }))}
                className="input w-full"
              />
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            Cierre configurado: <span className="font-semibold text-gray-900">{closeSummary}</span>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSaveWeeklySettings}
              className="btn btn-primary"
              disabled={saving}
            >
              <Save size={18} />
              {saving ? 'Guardando...' : 'Guardar configuracion'}
            </button>
          </div>
        </div>
      ) : (
        <RolesPermissions />
      )}

    </div>
  );
}

export default SettingsPage;
