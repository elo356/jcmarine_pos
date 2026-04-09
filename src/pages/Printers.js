import React, { useMemo, useState } from 'react';
import { Printer, PlayCircle } from 'lucide-react';
import { loadData, saveData, normalizePrintSettings } from '../data/demoData';
import Notification from '../components/Notification';
import { buildPrinterTestHtml } from '../utils/printTemplates';
import { printHtmlDocument } from '../services/printService';

function Printers() {
  const data = loadData();
  const normalizedStore = {
    ...(data.store || {}),
    ...normalizePrintSettings(data.store || {})
  };

  const [printers] = useState(normalizedStore.printers || []);
  const [printRouting, setPrintRouting] = useState(normalizedStore.printRouting || {});
  const [notification, setNotification] = useState(null);

  const showNotification = (type, message) => {
    setNotification({ type, message, id: Date.now() });
  };

  const persist = (nextPrinters, nextRouting) => {
    const current = loadData();
    saveData({
      ...current,
      store: {
        ...(current.store || {}),
        printers: nextPrinters,
        printRouting: nextRouting
      }
    });
  };

  const handleRoutingChange = (field, value) => {
    const nextRouting = {
      ...printRouting,
      [field]: value
    };
    setPrintRouting(nextRouting);
    persist(printers, nextRouting);
    showNotification('success', 'Asignación de impresión actualizada');
  };

  const handlePrintTest = async (printer) => {
    try {
      await printHtmlDocument({
        title: `Prueba ${printer.name}`,
        html: buildPrinterTestHtml({ printer }),
        printer
      });
      showNotification(
        'info',
        `Abriendo dialogo de impresion para ${printer.name}`
      );
    } catch (error) {
      console.error(error);
      showNotification('error', 'No se pudo abrir la impresión de prueba');
    }
  };

  const printerOptions = useMemo(
    () => printers.map((printer) => ({ value: printer.id, label: `${printer.name} (${printer.model || printer.brand || 'Sin modelo'})` })),
    [printers]
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
        <div className="flex items-center gap-3 mb-6">
          <Printer className="text-primary-600" size={26} />
          <div>
            <h2 className="text-xl font-bold text-gray-900">Impresoras</h2>
            <p className="text-sm text-gray-500">Descubre impresoras del sistema operativo y asigna cuál usar para recibos y facturas.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-4">Metodo de impresion</h3>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
              <p className="font-medium">Impresion desde el navegador</p>
              <p className="mt-1">
                La app abre el dialogo de impresion del navegador para recibos, facturas y pruebas.
              </p>
            </div>
            <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              Selecciona la impresora final desde el dialogo del navegador al momento de imprimir.
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-4">Asignación por documento</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Impresora para recibo</label>
                <select
                  value={printRouting.receiptPrinterId || ''}
                  onChange={(e) => handleRoutingChange('receiptPrinterId', e.target.value)}
                  className="input w-full"
                >
                  <option value="">Sin asignar</option>
                  {printerOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Impresora para factura</label>
                <select
                  value={printRouting.invoicePrinterId || ''}
                  onChange={(e) => handleRoutingChange('invoicePrinterId', e.target.value)}
                  className="input w-full"
                >
                  <option value="">Sin asignar</option>
                  {printerOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700">
              Estas asignaciones funcionan como referencia visual dentro del sistema.
            </div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Impresoras configuradas</h3>
        {printers.length === 0 ? (
          <p className="text-sm text-gray-500">No hay impresoras agregadas.</p>
        ) : (
          <div className="space-y-3">
            {printers.map((printer) => (
              <div key={printer.id} className="rounded-lg border border-gray-200 p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-gray-900">{printer.name}</p>
                  <p className="text-sm text-gray-500">
                    {printer.brand || 'Sin marca'} {printer.model ? `• ${printer.model}` : ''} {printer.connectionType ? `• ${printer.connectionType}` : ''}
                  </p>
                  <div className="flex gap-2 mt-2 text-xs">
                    {printRouting.receiptPrinterId === printer.id && <span className="badge badge-success">Recibo</span>}
                    {printRouting.invoicePrinterId === printer.id && <span className="badge badge-info">Factura</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handlePrintTest(printer)}
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                  title="Imprimir prueba"
                >
                  <PlayCircle size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Printers;
