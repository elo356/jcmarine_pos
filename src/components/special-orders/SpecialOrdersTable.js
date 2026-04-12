import React from 'react';
import { Eye, DollarSign, PackageCheck, RotateCcw, Truck, XCircle } from 'lucide-react';
import { formatCurrency, formatDate } from '../../data/demoData';
import {
  getSpecialOrderPaymentStatusBadge,
  getSpecialOrderPaymentStatusLabel,
  getSpecialOrderStatusBadge,
  getSpecialOrderStatusLabel
} from '../../utils/specialOrderUtils';

function SpecialOrdersTable({
  orders,
  onView,
  onRegisterPayment,
  onMarkReady,
  onDeliver,
  onUndoDelivered,
  onCancel
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Cliente</th>
            <th>Estado</th>
            <th>Pago</th>
            <th>Total</th>
            <th>Balance</th>
            <th>Fecha estimada</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="hover:bg-gray-50">
              <td>
                <div className="font-medium">{order.orderNumber}</div>
                <div className="text-xs text-gray-500">{formatDate(order.createdAt)}</div>
              </td>
              <td>
                <div className="font-medium">{order.customerName}</div>
                <div className="text-xs text-gray-500">{order.customerPhone}</div>
              </td>
              <td>
                <span className={`badge ${getSpecialOrderStatusBadge(order.orderStatus)}`}>
                  {getSpecialOrderStatusLabel(order.orderStatus)}
                </span>
              </td>
              <td>
                <span className={`badge ${getSpecialOrderPaymentStatusBadge(order.paymentStatus)}`}>
                  {getSpecialOrderPaymentStatusLabel(order.paymentStatus)}
                </span>
              </td>
              <td className="font-semibold">{formatCurrency(order.totalAmount)}</td>
              <td className="font-semibold text-amber-600">{formatCurrency(order.balanceDue)}</td>
              <td>{order.expectedDate ? formatDate(order.expectedDate) : 'Sin fecha'}</td>
              <td>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 rounded-lg"
                    onClick={() => onView(order)}
                    title="Ver detalles del pedido"
                  >
                    <Eye size={18} />
                    Ver
                  </button>
                  {order.balanceDue > 0 && order.orderStatus !== 'canceled' && order.orderStatus !== 'delivered' && (
                    <button
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm text-green-700 hover:bg-green-50 rounded-lg"
                      onClick={() => onRegisterPayment(order)}
                      title="Registrar pago"
                    >
                      <DollarSign size={18} />
                      Cobrar
                    </button>
                  )}
                  {order.orderStatus !== 'ready_for_pickup' && order.orderStatus !== 'delivered' && order.orderStatus !== 'canceled' && (
                    <button
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 rounded-lg"
                      onClick={() => onMarkReady(order)}
                      title="Marcar como listo"
                    >
                      <PackageCheck size={18} />
                      Listo
                    </button>
                  )}
                  {order.orderStatus === 'ready_for_pickup' && (
                    <button
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-50 rounded-lg"
                      onClick={() => onDeliver(order)}
                      title="Marcar como entregado"
                    >
                      <Truck size={18} />
                      Entregar
                    </button>
                  )}
                  {order.orderStatus === 'delivered' && (
                    <button
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm text-amber-700 hover:bg-amber-50 rounded-lg"
                      onClick={() => onUndoDelivered(order)}
                      title="Volver el pedido a listo para recoger"
                    >
                      <RotateCcw size={18} />
                      Deshacer entrega
                    </button>
                  )}
                  {order.orderStatus !== 'delivered' && order.orderStatus !== 'canceled' && (
                    <button
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm text-red-700 hover:bg-red-50 rounded-lg"
                      onClick={() => onCancel(order)}
                      title="Cancelar pedido"
                    >
                      <XCircle size={18} />
                      Cancelar
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default SpecialOrdersTable;
