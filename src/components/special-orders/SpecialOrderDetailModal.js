import React from 'react';
import { Phone, Printer, Wallet } from 'lucide-react';
import Modal from '../Modal';
import { formatCurrency, formatDateTime, loadData, normalizePrintSettings } from '../../data/demoData';
import {
  canDeliverSpecialOrder,
  getSpecialOrderPaymentStatusBadge,
  getSpecialOrderPaymentStatusLabel,
  getSpecialOrderStatusBadge,
  getSpecialOrderStatusLabel
} from '../../utils/specialOrderUtils';
import { getPaymentMethodLabel } from '../../utils/paymentUtils';
import { buildSpecialOrderPrintHtml } from '../../utils/printTemplates';
import { printHtmlDocument } from '../../services/printService';

function SpecialOrderDetailModal({
  isOpen,
  onClose,
  order,
  auditLogs,
  onRegisterPayment,
  onRegisterRefund,
  onEdit,
  onMarkOrdered,
  onMarkWaiting,
  onMarkReady,
  onDeliver,
  onCancel
}) {
  if (!order) return null;

  const handlePrint = async () => {
    const data = loadData();
    const store = {
      ...(data.store || {}),
      ...normalizePrintSettings(data.store || {})
    };
    const printer =
      store.printers?.find((entry) => entry.id === store.printRouting?.receiptPrinterId) || null;
    const printerName = printer?.name || 'Impresora principal';

    await printHtmlDocument({
      title: `Pedido ${order.orderNumber}`,
      html: buildSpecialOrderPrintHtml({
        order,
        printerName
      }),
      printer
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Pedido ${order.orderNumber}`} size="xl">
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <span className={`badge ${getSpecialOrderStatusBadge(order.orderStatus)}`}>
            {getSpecialOrderStatusLabel(order.orderStatus)}
          </span>
          <span className={`badge ${getSpecialOrderPaymentStatusBadge(order.paymentStatus)}`}>
            {getSpecialOrderPaymentStatusLabel(order.paymentStatus)}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="card p-4">
            <h3 className="font-semibold mb-3">Cliente</h3>
            <p className="font-medium">{order.customerName}</p>
            <p className="text-sm text-gray-500">{order.customerPhone}</p>
            {order.customerEmail && <p className="text-sm text-gray-500">{order.customerEmail}</p>}
            <div className="flex gap-2 mt-4">
              <a
                href={`tel:${order.customerPhone}`}
                className="btn btn-secondary flex items-center gap-2"
              >
                <Phone size={16} />
                Llamar
              </a>
            </div>
          </div>

          <div className="card p-4">
            <h3 className="font-semibold mb-3">Cobros</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Total</span>
                <strong>{formatCurrency(order.totalAmount)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Cobrado</span>
                <strong>{formatCurrency(order.amountPaid)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Anticipo</span>
                <strong>{formatCurrency(order.depositAmount)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Balance pendiente</span>
                <strong className="text-amber-600">{formatCurrency(order.balanceDue)}</strong>
              </div>
            </div>
            <div className="flex gap-2 mt-4 flex-wrap">
              {order.orderStatus !== 'canceled' && order.orderStatus !== 'delivered' && order.balanceDue > 0 && (
                <button className="btn btn-primary flex items-center gap-2" onClick={() => onRegisterPayment(order)}>
                  <Wallet size={16} />
                  Registrar pago
                </button>
              )}
              {order.amountPaid > 0 && order.orderStatus !== 'delivered' && (
                <button className="btn btn-secondary" onClick={() => onRegisterRefund(order)}>
                  Registrar reembolso
                </button>
              )}
            </div>
          </div>

          <div className="card p-4">
            <h3 className="font-semibold mb-3">Fechas</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Creado</span>
                <strong>{formatDateTime(order.createdAt)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Estimada</span>
                <strong>{order.expectedDate ? formatDateTime(order.expectedDate) : 'Sin fecha'}</strong>
              </div>
              <div className="flex justify-between">
                <span>Listo</span>
                <strong>{order.readyAt ? formatDateTime(order.readyAt) : 'Pendiente'}</strong>
              </div>
              <div className="flex justify-between">
                <span>Entregado</span>
                <strong>{order.deliveredAt ? formatDateTime(order.deliveredAt) : 'Pendiente'}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="font-semibold mb-3">Items del pedido</h3>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Pieza</th>
                  <th>SKU</th>
                  <th>Cantidad</th>
                  <th>Costo</th>
                  <th>Precio</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="font-medium">{item.name}</div>
                      {item.description && <div className="text-xs text-gray-500">{item.description}</div>}
                    </td>
                    <td>{item.sku || 'N/A'}</td>
                    <td>{item.quantity}</td>
                    <td>{formatCurrency(item.unitCost || 0)}</td>
                    <td>{formatCurrency(item.unitPrice || 0)}</td>
                    <td>{formatCurrency(item.subtotal || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-4">
            <h3 className="font-semibold mb-3">Historial de pagos</h3>
            <div className="space-y-3">
              {order.payments.length > 0 ? order.payments.map((payment) => (
                <div key={payment.id} className="p-3 rounded-lg border border-gray-200">
                  <div className="flex justify-between gap-4">
                    <div>
                      <p className="font-medium">
                        {payment.kind === 'deposit' ? 'Anticipo' : payment.kind === 'refund' ? 'Reembolso' : 'Pago'}
                      </p>
                      <p className="text-sm text-gray-500">{getPaymentMethodLabel(payment.method)}</p>
                      {payment.reference && <p className="text-xs text-gray-400">Ref: {payment.reference}</p>}
                    </div>
                    <div className="text-right">
                      <p className={`font-semibold ${payment.kind === 'refund' ? 'text-red-600' : 'text-green-600'}`}>
                        {payment.kind === 'refund' ? '-' : ''}{formatCurrency(payment.amount)}
                      </p>
                      <p className="text-xs text-gray-400">{formatDateTime(payment.createdAt)}</p>
                      <p className="text-xs text-gray-400">{payment.confirmedBy}</p>
                    </div>
                  </div>
                </div>
              )) : (
                <p className="text-sm text-gray-500">No hay pagos registrados.</p>
              )}
            </div>
          </div>

          <div className="card p-4">
            <h3 className="font-semibold mb-3">Auditoría</h3>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {auditLogs.length > 0 ? auditLogs.map((log) => (
                <div key={log.id} className="p-3 rounded-lg border border-gray-200">
                  <div className="flex justify-between gap-4">
                    <div>
                      <p className="font-medium">{log.description}</p>
                      <p className="text-xs text-gray-500">{log.performedBy || 'Sistema'}</p>
                    </div>
                    <p className="text-xs text-gray-400">{formatDateTime(log.createdAt)}</p>
                  </div>
                </div>
              )) : (
                <p className="text-sm text-gray-500">No hay eventos registrados.</p>
              )}
            </div>
          </div>
        </div>

        {order.internalNotes && (
          <div className="card p-4">
            <h3 className="font-semibold mb-2">Notas internas</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{order.internalNotes}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 justify-between">
          <div className="flex flex-wrap gap-2">
            {order.orderStatus === 'pending_order' && (
              <button className="btn btn-secondary" onClick={() => onMarkOrdered(order)}>
                Marcar como ordenado
              </button>
            )}
            {order.orderStatus !== 'delivered' && order.orderStatus !== 'canceled' && (
              <button className="btn btn-secondary" onClick={() => onEdit(order)}>
                Editar pedido
              </button>
            )}
            {order.orderStatus === 'ordered' && (
              <button className="btn btn-secondary" onClick={() => onMarkWaiting(order)}>
                Marcar en espera
              </button>
            )}
            {order.orderStatus !== 'ready_for_pickup' && order.orderStatus !== 'delivered' && order.orderStatus !== 'canceled' && (
              <button className="btn btn-secondary" onClick={() => onMarkReady(order)}>
                Marcar como listo
              </button>
            )}
            {canDeliverSpecialOrder(order) && (
              <button className="btn btn-primary" onClick={() => onDeliver(order)}>
                Entregar pedido
              </button>
            )}
            {order.orderStatus !== 'delivered' && order.orderStatus !== 'canceled' && (
              <button className="btn btn-secondary" onClick={() => onCancel(order)}>
                Cancelar pedido
              </button>
            )}
          </div>

          <button className="btn btn-secondary flex items-center gap-2" onClick={handlePrint}>
            <Printer size={16} />
            Imprimir
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default SpecialOrderDetailModal;
