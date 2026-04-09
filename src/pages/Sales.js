import React, { useState, useEffect } from 'react';
import { Eye, Printer, Undo, Calendar, Filter } from 'lucide-react';
import { loadData, saveData, formatCurrency, formatDate, formatQuantity } from '../data/demoData';
import { refundSale, subscribeSales } from '../services/salesService';
import { getPaymentMethodLabel, normalizePaymentMethod } from '../utils/paymentUtils';
import { getSaleStatusLabel, isRefundedSale } from '../utils/salesUtils';
import { useAuth } from '../contexts/AuthContext';

function Sales() {
  const { user, profile } = useAuth();
  const [sales, setSales] = useState([]);
  const [filterDate, setFilterDate] = useState('');
  const [filterMethod, setFilterMethod] = useState('');

  useEffect(() => {
    const data = loadData();
    setSales(data.sales);

    const unsubscribe = subscribeSales(
      (rows) => {
        if (rows.length > 0) {
          setSales(rows);
        }
      },
      (error) => {
        console.error('Error subscribing sales:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  const filteredSales = sales.filter(sale => {
    if (filterDate && !sale.date.startsWith(filterDate)) return false;
    if (filterMethod && normalizePaymentMethod(sale.paymentMethod) !== filterMethod) return false;
    return true;
  });

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

  const handleRefund = async (saleId) => {
    if (!window.confirm('¿Estás seguro de reembolsar esta venta?')) return;

    const data = loadData();
    const targetSale = (data.sales || []).find((sale) => sale.id === saleId);

    if (!targetSale || isRefundedSale(targetSale)) return;

    const refundedAt = new Date().toISOString();
    const refundedBy = profile?.name || user?.email || 'Sistema';
    const refundedSale = {
      ...targetSale,
      status: 'refunded',
      paymentStatus: 'refunded',
      refunded_at: refundedAt,
      refunded_by: refundedBy
    };

    const nextSales = (data.sales || []).map((sale) => (sale.id === saleId ? refundedSale : sale));
    saveData({
      ...data,
      sales: nextSales
    });
    setSales(nextSales);

    try {
      await refundSale(targetSale, refundedBy);
    } catch (error) {
      console.error('Error refunding sale:', error);
    }
  };

  return (
    <div className="space-y-6">
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
                <th>Método</th>
                <th>Estado</th>
                <th>Cajero</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.map((sale) => (
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
                  <td>
                    <span className={`badge badge-${normalizePaymentMethod(sale.paymentMethod) === 'card' ? 'info' : normalizePaymentMethod(sale.paymentMethod) === 'cash' ? 'success' : 'warning'}`}>
                      {getPaymentMethodLabel(sale.paymentMethod)}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${isRefundedSale(sale) ? 'badge-danger' : 'badge-success'}`}>
                      {getSaleStatusLabel(sale.status)}
                    </span>
                  </td>
                  <td>{sale.cashier}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg">
                        <Eye size={18} />
                      </button>
                      <button className="p-2 text-green-600 hover:bg-green-50 rounded-lg">
                        <Printer size={18} />
                      </button>
                      <button
                        onClick={() => handleRefund(sale.id)}
                        disabled={isRefundedSale(sale)}
                        className={`p-2 rounded-lg ${
                          isRefundedSale(sale)
                            ? 'text-gray-300 cursor-not-allowed'
                            : 'text-red-600 hover:bg-red-50'
                        }`}
                        title={isRefundedSale(sale) ? 'Venta ya reembolsada' : 'Reembolsar venta'}
                      >
                        <Undo size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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
    </div>
  );
}

export default Sales;
