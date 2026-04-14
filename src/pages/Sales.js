import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Eye, Filter, Printer, Receipt, RotateCcw } from 'lucide-react';
import Modal from '../components/Modal';
import Notification from '../components/Notification';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatQuantity,
  loadData,
  normalizePrintSettings,
  saveData
} from '../data/demoData';
import { refundSale, subscribeSales } from '../services/salesService';
import { upsertWeeklyCachedSale } from '../services/weeklySalesCacheService';
import { getPaymentMethodLabel, normalizePaymentMethod } from '../utils/paymentUtils';
import {
  getNetSaleTotal,
  getSaleRefundTotal,
  getSaleRefunds,
  getSaleStatusLabel,
  isPartiallyRefundedSale,
  isRefundedSale,
  normalizeSaleRefund,
  normalizeSaleStatus
} from '../utils/salesUtils';
import { useAuth } from '../contexts/AuthContext';
import { buildSalePrintHtml, buildSaleRefundPrintHtml } from '../utils/printTemplates';
import { printHtmlDocument } from '../services/printService';

const DEFAULT_REFUND_FORM = {
  amount: '',
  method: '',
  reason: '',
  notes: ''
};

function Sales() {
  const { user, profile } = useAuth();
  const [sales, setSales] = useState([]);
  const [filterDate, setFilterDate] = useState('');
  const [filterMethod, setFilterMethod] = useState('');
  const [notification, setNotification] = useState(null);
  const [selectedSale, setSelectedSale] = useState(null);
  const [refundTarget, setRefundTarget] = useState(null);
  const [refundForm, setRefundForm] = useState(DEFAULT_REFUND_FORM);

  useEffect(() => {
    const data = loadData();
    setSales(data.sales || []);

    const unsubscribe = subscribeSales(
      (rows) => {
        setSales(rows || []);
      },
      (error) => {
        console.error('Error subscribing sales:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  const showNotification = (type, message) => {
    setNotification({ id: Date.now(), type, message });
  };

  const filteredSales = useMemo(() => sales.filter((sale) => {
    if (filterDate && !sale.date.startsWith(filterDate)) return false;
    if (filterMethod && normalizePaymentMethod(sale.paymentMethod) !== filterMethod) return false;
    return true;
  }), [filterDate, filterMethod, sales]);

  const getReceiptNumber = (saleId = '') => {
    if (!saleId) return 'N/A';
    const parts = String(saleId).split('_');
    return (parts[1] || parts[0] || saleId).toUpperCase();
  };

  const getReceiptReference = (sale = {}) => {
    const paymentReference = sale?.payments?.[0]?.reference;
    if (paymentReference) return paymentReference;
    return sale?.paymentReference || '';
  };

  const getAssignedReceiptPrinter = () => {
    const data = loadData();
    const store = {
      ...(data.store || {}),
      ...normalizePrintSettings(data.store || {})
    };
    const printerId = store.printRouting?.receiptPrinterId;
    return (store.printers || []).find((printer) => printer.id === printerId) || null;
  };

  const handlePrintSaleReceipt = async (sale) => {
    if (!sale) return;

    const printer = getAssignedReceiptPrinter();

    try {
      await printHtmlDocument({
        title: `Recibo ${sale.id}`,
        html: buildSalePrintHtml({
          sale,
          documentType: 'receipt',
          printerName: printer?.name || ''
        }),
        printer
      });
      showNotification('success', 'Recibo abierto en el diálogo de impresión.');
    } catch (error) {
      console.error('Error printing sale receipt:', error);
      showNotification('error', 'No se pudo imprimir el recibo.');
    }
  };

  const handlePrintRefundReceipt = async (sale, refund) => {
    const printer = getAssignedReceiptPrinter();

    try {
      await printHtmlDocument({
        title: `Reembolso ${refund.id}`,
        html: buildSaleRefundPrintHtml({
          sale,
          refund,
          printerName: printer?.name || ''
        }),
        printer
      });
      showNotification('success', 'Recibo de reembolso abierto en el diálogo de impresión.');
    } catch (error) {
      console.error('Error printing refund receipt:', error);
      showNotification('warning', 'El reembolso se guardó, pero no se pudo abrir el recibo.');
    }
  };

  const openRefundModal = (sale) => {
    const remaining = Math.max(0, Number(sale.total || 0) - getSaleRefundTotal(sale));
    setRefundTarget(sale);
    setRefundForm({
      amount: remaining > 0 ? remaining.toFixed(2) : '',
      method: normalizePaymentMethod(sale.paymentMethod) || 'cash',
      reason: '',
      notes: ''
    });
  };

  const handleRefund = async () => {
    if (!refundTarget) return;

    const refundAmount = Number(refundForm.amount || 0);
    const maxRefund = Math.max(0, Number(refundTarget.total || 0) - getSaleRefundTotal(refundTarget));

    if (refundAmount <= 0) {
      showNotification('error', 'Indica un monto válido para reembolsar.');
      return;
    }

    if (refundAmount > maxRefund) {
      showNotification('error', 'El reembolso no puede exceder el balance disponible para devolver.');
      return;
    }

    const refundRecord = normalizeSaleRefund({
      amount: refundAmount,
      method: refundForm.method || normalizePaymentMethod(refundTarget.paymentMethod) || 'cash',
      reason: refundForm.reason,
      notes: refundForm.notes,
      refundedBy: profile?.name || user?.email || 'Sistema',
      refundedAt: new Date().toISOString()
    });

    const data = loadData();
    const targetSale = (data.sales || []).find((sale) => sale.id === refundTarget.id);

    if (!targetSale) {
      showNotification('error', 'No se encontró la venta para registrar el reembolso.');
      return;
    }

    const refunds = [...getSaleRefunds(targetSale), refundRecord];
    const nextSale = {
      ...targetSale,
      refunds,
      status: normalizeSaleStatus(targetSale.status, { ...targetSale, refunds }),
      paymentStatus: normalizeSaleStatus(targetSale.status, { ...targetSale, refunds }),
      refunded_at: refundRecord.refundedAt,
      refunded_by: refundRecord.refundedBy,
      refundedAmount: getSaleRefundTotal({ ...targetSale, refunds })
    };

    const nextSales = (data.sales || []).map((sale) => (sale.id === refundTarget.id ? nextSale : sale));
    saveData({
      ...data,
      sales: nextSales
    });
    upsertWeeklyCachedSale(nextSale);
    setSales(nextSales);
    setSelectedSale(nextSale);

    try {
      const persistedSale = await refundSale(targetSale, refundRecord);
      setRefundTarget(null);
      setRefundForm(DEFAULT_REFUND_FORM);
      showNotification('success', refundAmount >= Number(targetSale.total || 0)
        ? 'Venta reembolsada completamente.'
        : 'Reembolso parcial registrado.');
      await handlePrintRefundReceipt(persistedSale, refundRecord);
    } catch (error) {
      console.error('Error refunding sale:', error);
      showNotification('error', 'El reembolso se guardó localmente, pero falló la sincronización.');
    }
  };

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

      <div className="card">
        <div className="p-6 border-b">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <h3 className="text-lg font-semibold">Historial de Ventas</h3>
            <div className="flex gap-2">
              <div className="relative">
                <Calendar size={20} className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="input pl-10"
                />
              </div>
              <select
                value={filterMethod}
                onChange={(e) => setFilterMethod(e.target.value)}
                className="input"
              >
                <option value="">Todos los métodos</option>
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="ath_movil">ATH Móvil</option>
                <option value="split">Split</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Recibo</th>
                <th>Fecha</th>
                <th>Productos</th>
                <th>Total</th>
                <th>Refunds</th>
                <th>Neto</th>
                <th>Método</th>
                <th>Estado</th>
                <th>Cajero</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.map((sale) => {
                const refundTotal = getSaleRefundTotal(sale);
                const netTotal = getNetSaleTotal(sale);
                const saleStatus = normalizeSaleStatus(sale.status, sale);

                return (
                  <tr key={sale.id} className="hover:bg-gray-50">
                    <td className="font-mono text-sm">
                      <div>#{getReceiptNumber(sale.id)}</div>
                      {getReceiptReference(sale) && (
                        <div className="text-xs font-sans text-gray-500">Ref: {getReceiptReference(sale)}</div>
                      )}
                    </td>
                    <td>{formatDate(sale.date)}</td>
                    <td>
                      <div className="space-y-1">
                        {(sale.items || []).slice(0, 3).map((item, index) => (
                          <div
                            key={`${sale.id}_${item.productId || index}`}
                            className="text-sm text-gray-700"
                          >
                            {item.name} x {formatQuantity(item.quantity, item.unitType || 'unit')}
                            {item.selectedSize ? ` (${item.selectedSize})` : ''}
                          </div>
                        ))}
                        {sale.items?.length > 3 && (
                          <div className="text-xs text-gray-500">+{sale.items.length - 3} productos más</div>
                        )}
                      </div>
                    </td>
                    <td className="font-bold text-green-600">{formatCurrency(sale.total)}</td>
                    <td className={`font-semibold ${refundTotal > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {refundTotal > 0 ? `-${formatCurrency(refundTotal)}` : formatCurrency(0)}
                    </td>
                    <td className="font-bold text-emerald-700">{formatCurrency(netTotal)}</td>
                    <td>
                      <span className={`badge badge-${normalizePaymentMethod(sale.paymentMethod) === 'card' ? 'info' : normalizePaymentMethod(sale.paymentMethod) === 'cash' ? 'success' : 'warning'}`}>
                        {getPaymentMethodLabel(sale.paymentMethod)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${
                        isRefundedSale(sale)
                          ? 'badge-danger'
                          : isPartiallyRefundedSale(sale)
                            ? 'badge-warning'
                            : 'badge-success'
                      }`}>
                        {getSaleStatusLabel(saleStatus)}
                      </span>
                    </td>
                    <td>{sale.cashier}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          className="inline-flex items-center gap-2 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 rounded-lg"
                          onClick={() => setSelectedSale(sale)}
                          title="Ver detalles de la venta"
                        >
                          <Eye size={18} />
                          Ver
                        </button>
                        <button
                          className="inline-flex items-center gap-2 px-3 py-2 text-sm text-green-700 hover:bg-green-50 rounded-lg"
                          onClick={() => handlePrintSaleReceipt(sale)}
                          title="Reimprimir recibo"
                        >
                          <Printer size={18} />
                          Reimprimir
                        </button>
                        <button
                          onClick={() => openRefundModal(sale)}
                          disabled={isRefundedSale(sale)}
                          className={`inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg ${
                            isRefundedSale(sale)
                              ? 'text-gray-300 cursor-not-allowed'
                              : 'text-red-700 hover:bg-red-50'
                          }`}
                          title={isRefundedSale(sale) ? 'Venta ya reembolsada por completo' : 'Registrar reembolso parcial o total'}
                        >
                          <RotateCcw size={18} />
                          Refund
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredSales.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Filter size={48} className="mx-auto mb-2" />
            <p>No se encontraron ventas</p>
          </div>
        )}
      </div>

      <Modal
        isOpen={Boolean(selectedSale)}
        onClose={() => setSelectedSale(null)}
        title={selectedSale ? `Venta #${getReceiptNumber(selectedSale.id)}` : 'Detalle de venta'}
        size="xl"
      >
        {selectedSale && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="card p-4">
                <h3 className="font-semibold mb-3">Resumen</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Fecha</span><strong>{formatDateTime(selectedSale.date)}</strong></div>
                  <div className="flex justify-between"><span>Cajero</span><strong>{selectedSale.cashier || '-'}</strong></div>
                  <div className="flex justify-between"><span>Método</span><strong>{getPaymentMethodLabel(selectedSale.paymentMethod)}</strong></div>
                  <div className="flex justify-between"><span>Estado</span><strong>{getSaleStatusLabel(normalizeSaleStatus(selectedSale.status, selectedSale))}</strong></div>
                </div>
              </div>
              <div className="card p-4">
                <h3 className="font-semibold mb-3">Totales</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Subtotal</span><strong>{formatCurrency(selectedSale.subtotal || 0)}</strong></div>
                  <div className="flex justify-between"><span>IVU</span><strong>{formatCurrency(selectedSale.tax || 0)}</strong></div>
                  <div className="flex justify-between"><span>Total</span><strong>{formatCurrency(selectedSale.total || 0)}</strong></div>
                  <div className="flex justify-between"><span>Refunds</span><strong className="text-red-600">-{formatCurrency(getSaleRefundTotal(selectedSale))}</strong></div>
                  <div className="flex justify-between"><span>Neto</span><strong className="text-emerald-700">{formatCurrency(getNetSaleTotal(selectedSale))}</strong></div>
                </div>
              </div>
              <div className="card p-4">
                <h3 className="font-semibold mb-3">Acciones</h3>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-secondary flex items-center gap-2" onClick={() => handlePrintSaleReceipt(selectedSale)}>
                    <Receipt size={16} />
                    Reimprimir recibo
                  </button>
                  <button
                    className="btn btn-secondary"
                    disabled={isRefundedSale(selectedSale)}
                    onClick={() => openRefundModal(selectedSale)}
                  >
                    Registrar refund
                  </button>
                </div>
              </div>
            </div>

            <div className="card p-4">
              <h3 className="font-semibold mb-3">Productos</h3>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Cantidad</th>
                      <th>Precio</th>
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedSale.items || []).map((item, index) => (
                      <tr key={`${selectedSale.id}_item_${index}`}>
                        <td>{item.name}</td>
                        <td>{formatQuantity(item.quantity, item.unitType || 'unit')}</td>
                        <td>{formatCurrency(item.price || 0)}</td>
                        <td>{formatCurrency(item.taxableSubtotal || item.subtotal || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card p-4">
              <h3 className="font-semibold mb-3">Historial de refunds</h3>
              <div className="space-y-3">
                {getSaleRefunds(selectedSale).length > 0 ? getSaleRefunds(selectedSale).map((refund) => (
                  <div key={refund.id} className="rounded-lg border border-gray-200 p-3 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div>
                      <p className="font-medium text-red-700">-{formatCurrency(refund.amount)}</p>
                      <p className="text-sm text-gray-600">{getPaymentMethodLabel(refund.method)}</p>
                      {refund.reason && <p className="text-sm text-gray-600">Razón: {refund.reason}</p>}
                      {refund.notes && <p className="text-xs text-gray-500 mt-1">{refund.notes}</p>}
                    </div>
                    <div className="text-sm text-gray-500">
                      <p>{formatDateTime(refund.refundedAt)}</p>
                      <p>{refund.refundedBy || 'Sistema'}</p>
                    </div>
                  </div>
                )) : (
                  <p className="text-sm text-gray-500">No hay refunds registrados para esta venta.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(refundTarget)}
        onClose={() => {
          setRefundTarget(null);
          setRefundForm(DEFAULT_REFUND_FORM);
        }}
        title={refundTarget ? `Refund para venta #${getReceiptNumber(refundTarget.id)}` : 'Registrar refund'}
        size="md"
      >
        {refundTarget && (
          <div className="space-y-4">
            <div className="rounded-lg bg-gray-50 p-4 text-sm space-y-2">
              <div className="flex justify-between"><span>Total venta</span><strong>{formatCurrency(refundTarget.total || 0)}</strong></div>
              <div className="flex justify-between"><span>Ya refund</span><strong className="text-red-600">-{formatCurrency(getSaleRefundTotal(refundTarget))}</strong></div>
              <div className="flex justify-between"><span>Máximo disponible</span><strong className="text-emerald-700">{formatCurrency(Math.max(0, Number(refundTarget.total || 0) - getSaleRefundTotal(refundTarget)))}</strong></div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto a reembolsar</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={refundForm.amount}
                onChange={(e) => setRefundForm((current) => ({ ...current, amount: e.target.value }))}
                className="input w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Método del refund</label>
              <select
                value={refundForm.method}
                onChange={(e) => setRefundForm((current) => ({ ...current, method: e.target.value }))}
                className="input w-full"
              >
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="ath_movil">ATH Móvil</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Razón</label>
              <input
                type="text"
                value={refundForm.reason}
                onChange={(e) => setRefundForm((current) => ({ ...current, reason: e.target.value }))}
                className="input w-full"
                placeholder="Ej. pieza incorrecta, devolución parcial, ajuste"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
              <textarea
                value={refundForm.notes}
                onChange={(e) => setRefundForm((current) => ({ ...current, notes: e.target.value }))}
                className="input w-full min-h-[96px]"
                placeholder="Detalles adicionales del reembolso"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setRefundTarget(null);
                  setRefundForm(DEFAULT_REFUND_FORM);
                }}
              >
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={handleRefund}>
                Guardar refund
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default Sales;
