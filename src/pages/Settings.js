import React, { useMemo, useState } from 'react';
import { ImagePlus, Receipt, FileText, Save, Trash2 } from 'lucide-react';
import Notification from '../components/Notification';
import { loadData, saveData, normalizePrintSettings } from '../data/demoData';

const DOCUMENT_OPTIONS = [
  { id: 'receipt', label: 'Recibo', icon: Receipt },
  { id: 'invoice', label: 'Factura', icon: FileText }
];

const toPreviewLines = (value) => String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);

function Settings() {
  const data = loadData();
  const store = {
    ...(data.store || {}),
    ...normalizePrintSettings(data.store || {})
  };

  const [activeDocument, setActiveDocument] = useState('receipt');
  const [form, setForm] = useState(store.documentBranding);
  const [notification, setNotification] = useState(null);

  const currentConfig = form[activeDocument];
  const activeMeta = DOCUMENT_OPTIONS.find((item) => item.id === activeDocument) || DOCUMENT_OPTIONS[0];

  const showNotification = (type, message) => {
    setNotification({ type, message, id: Date.now() });
  };

  const updateCurrent = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [activeDocument]: {
        ...prev[activeDocument],
        [field]: value
      }
    }));
  };

  const handleLogoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      updateCurrent('logoUrl', reader.result || '');
      showNotification('success', `Imagen cargada para ${activeMeta.label.toLowerCase()}`);
    };
    reader.onerror = () => {
      showNotification('error', 'No se pudo leer la imagen seleccionada');
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    const current = loadData();
    saveData({
      ...current,
      store: {
        ...(current.store || {}),
        documentBranding: form
      }
    });
    showNotification('success', 'Configuracion de documentos guardada');
  };

  const handleResetLogo = () => {
    updateCurrent('logoUrl', '');
    showNotification('info', 'Se quitó la imagen personalizada');
  };

  const previewLines = useMemo(
    () => toPreviewLines(currentConfig.headerLines),
    [currentConfig.headerLines]
  );

  return (
    <div className="space-y-6">
      {notification && (
        <Notification
          key={notification.id}
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      <div className="card p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Configuracion</h2>
            <p className="text-sm text-gray-500">
              Personaliza el recibo y la factura con imagen, encabezado y contenido.
            </p>
          </div>
          <button type="button" onClick={handleSave} className="btn btn-primary">
            <Save size={18} />
            Guardar cambios
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">
        <div className="card p-6 space-y-6">
          <div className="flex flex-wrap gap-3">
            {DOCUMENT_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isActive = activeDocument === option.id;

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setActiveDocument(option.id)}
                  className={`px-4 py-3 rounded-xl border flex items-center gap-2 transition-colors ${
                    isActive
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Icon size={18} />
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Titulo</label>
              <input
                type="text"
                value={currentConfig.title}
                onChange={(e) => updateCurrent('title', e.target.value)}
                className="input w-full"
                placeholder="Nombre del negocio"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subtitulo</label>
              <input
                type="text"
                value={currentConfig.subtitle}
                onChange={(e) => updateCurrent('subtitle', e.target.value)}
                className="input w-full"
                placeholder="Texto secundario"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contenido del encabezado</label>
            <textarea
              value={currentConfig.headerLines}
              onChange={(e) => updateCurrent('headerLines', e.target.value)}
              className="input w-full min-h-[120px]"
              placeholder={'Una linea por renglon\nDireccion\nTelefono'}
            />
            <p className="text-xs text-gray-500 mt-2">Cada linea se mostrara por separado en el documento.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contenido del pie</label>
            <textarea
              value={currentConfig.footerText}
              onChange={(e) => updateCurrent('footerText', e.target.value)}
              className="input w-full min-h-[120px]"
              placeholder="Mensaje final del documento"
            />
          </div>

          <div className="rounded-xl border border-dashed border-gray-300 p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="font-medium text-gray-900">Imagen o logo</p>
                <p className="text-sm text-gray-500">Sube la foto que quieres mostrar en {activeMeta.label.toLowerCase()}.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="btn btn-secondary cursor-pointer">
                  <ImagePlus size={18} />
                  Seleccionar imagen
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                </label>
                <button type="button" onClick={handleResetLogo} className="btn btn-secondary">
                  <Trash2 size={18} />
                  Quitar imagen
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Vista previa</h3>
            <span className="badge badge-info">{activeMeta.label}</span>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 max-w-md mx-auto">
            {currentConfig.logoUrl ? (
              <img
                src={currentConfig.logoUrl}
                alt={`${activeMeta.label} logo`}
                className="w-24 h-auto mx-auto mb-4 object-contain"
              />
            ) : (
              <img
                src="/logo3-removebg-preview.png"
                alt="CJ Marine"
                className="w-24 h-auto mx-auto mb-4 object-contain"
              />
            )}

            <div className="text-center space-y-1">
              <h4 className="text-xl font-bold text-gray-900">{currentConfig.title}</h4>
              {currentConfig.subtitle && <p className="text-sm text-gray-500">{currentConfig.subtitle}</p>}
              {previewLines.map((line) => (
                <p key={line} className="text-sm text-gray-500">{line}</p>
              ))}
            </div>

            <div className="my-5 border-t border-dashed border-gray-300" />

            <div className="space-y-2 text-sm text-gray-700">
              <div className="flex justify-between">
                <span>Documento</span>
                <strong>{activeMeta.label}</strong>
              </div>
              <div className="flex justify-between">
                <span>Cliente</span>
                <strong>Mostrador</strong>
              </div>
              <div className="flex justify-between">
                <span>Total</span>
                <strong>$125.00</strong>
              </div>
            </div>

            <div className="my-5 border-t border-dashed border-gray-300" />

            <p className="text-xs leading-5 text-gray-600 whitespace-pre-line">
              {currentConfig.footerText}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
