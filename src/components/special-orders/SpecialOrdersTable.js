import React from 'react';
import { Eye, DollarSign, PackageCheck, Truck, XCircle } from 'lucide-react';
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
                <div className="flex items-center gap-2">
                  <button className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg" onClick={() => onView(order)}>
                    <Eye size={18} />
                  </button>
                  {order.balanceDue > 0 && order.orderStatus !== 'canceled' && order.orderStatus !== 'delivered' && (
                    <button className="p-2 text-green-600 hover:bg-green-50 rounded-lg" onClick={() => onRegisterPayment(order)}>
                      <DollarSign size={18} />
                    </button>
                  )}
                  {order.orderStatus !== 'ready_for_pickup' && order.orderStatus !== 'delivered' && order.orderStatus !== 'canceled' && (
                    <button className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg" onClick={() => onMarkReady(order)}>
                      <PackageCheck size={18} />
                    </button>
                  )}
                  {order.orderStatus === 'ready_for_pickup' && (
                    <button className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg" onClick={() => onDeliver(order)}>
                      <Truck size={18} />
                    </button>
                  )}
                  {order.orderStatus !== 'delivered' && order.orderStatus !== 'canceled' && (
                    <button className="p-2 text-red-600 hover:bg-red-50 rounded-lg" onClick={() => onCancel(order)}>
                      <XCircle size={18} />
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
