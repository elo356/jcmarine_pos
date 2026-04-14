import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart3, TrendingUp, DollarSign, ShoppingBag, Calendar, Download } from 'lucide-react';
import { loadData, formatCurrency } from '../data/demoData';
import Notification from '../components/Notification';
import { subscribeSales } from '../services/salesService';
import { subscribeProducts } from '../services/inventoryService';
import { normalizePaymentMethod } from '../utils/paymentUtils';
import { getNetSaleTotal, isReportableSale } from '../utils/salesUtils';
import { subscribeSpecialOrderPayments, subscribeSpecialOrders } from '../services/specialOrdersService';
import { normalizeSpecialOrder, SPECIAL_ORDER_STATUS } from '../utils/specialOrderUtils';

const Reports = () => {
  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [specialOrders, setSpecialOrders] = useState([]);
  const [specialOrderPayments, setSpecialOrderPayments] = useState([]);
  const [dateRange, setDateRange] = useState('week');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notification, setNotification] = useState(null);

  const formatDateInputValue = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const parseLocalDate = (value, endOfDay = false) => {
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;
    return endOfDay
      ? new Date(year, month - 1, day, 23, 59, 59, 999)
      : new Date(year, month - 1, day, 0, 0, 0, 0);
  };

  const setDefaultDateRange = useCallback(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    setStartDate(formatDateInputValue(start));
    setEndDate(formatDateInputValue(end));
  }, []);

  useEffect(() => {
    const data = loadData();
    setSales(data.sales || []);
    setProducts(data.products || []);
    setSpecialOrders(data.specialOrders || []);
    setSpecialOrderPayments(data.specialOrderPayments || []);
    setDefaultDateRange();
    const unsubSales = subscribeSales((rows) => setSales(rows), (err) => console.error(err));
    const unsubProducts = subscribeProducts((rows) => setProducts(rows), (err) => console.error(err));
    const unsubSpecialOrders = subscribeSpecialOrders((rows) => setSpecialOrders(rows), (err) => console.error(err));
    const unsubSpecialPayments = subscribeSpecialOrderPayments((rows) => setSpecialOrderPayments(rows), (err) => console.error(err));

    return () => {
      unsubSales();
      unsubProducts();
      unsubSpecialOrders();
      unsubSpecialPayments();
    };
  }, [setDefaultDateRange]);

  const hydratedSpecialOrders = useMemo(
    () => (specialOrders || []).map((order) => normalizeSpecialOrder({
      ...order,
      payments: specialOrderPayments.filter((payment) => payment.specialOrderId === order.id)
    })),
    [specialOrderPayments, specialOrders]
  );

  const getDateRangeSales = () => {
    const start = parseLocalDate(startDate, false);
    const end = parseLocalDate(endDate, true);
    if (!start || !end) return [];

    return sales.filter(sale => {
      const saleDate = new Date(sale.date);
      return saleDate >= start && saleDate <= end && isReportableSale(sale);
    });
  };

  const handleDateRangePreset = (range) => {
    const end = new Date();
    const start = new Date();

    switch (range) {
      case 'today':
        start.setHours(0, 0, 0, 0);
        break;
      case 'week':
        start.setDate(start.getDate() - 7);
        break;
      case 'month':
        start.setMonth(start.getMonth() - 1);
        break;
      case 'year':
        start.setFullYear(start.getFullYear() - 1);
        break;
      default:
        break;
    }

    setStartDate(formatDateInputValue(start));
    setEndDate(formatDateInputValue(end));
    setDateRange(range);
  };

  const calculateMetrics = () => {
    const filteredSales = getDateRangeSales();
    const start = parseLocalDate(startDate, false);
    const end = parseLocalDate(endDate, true);
    const filteredSpecialPayments = specialOrderPayments
      .filter((payment) => {
        const paymentDate = new Date(payment.createdAt || payment.confirmed_at);
        return start && end && paymentDate >= start && paymentDate <= end;
      });
    
    const specialRevenue = filteredSpecialPayments.reduce((sum, payment) => (
      sum + (payment.kind === 'refund' ? -Number(payment.amount || 0) : Number(payment.amount || 0))
    ), 0);
    const totalRevenue = filteredSales.reduce((sum, sale) => sum + getNetSaleTotal(sale), 0) + specialRevenue;
    const totalItems = filteredSales.reduce((sum, sale) => 
      sum + sale.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
    );
    const totalTransactions = filteredSales.length + filteredSpecialPayments.length;
    const avgTransaction = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
    const totalProfit = filteredSales.reduce((sum, sale) => {
      return sum + sale.items.reduce((itemSum, item) => {
        const product = products.find(p => p.id === item.productId);
        const cost = product ? product.cost : 0;
        return itemSum + ((item.price - cost) * item.quantity);
      }, 0);
    }, 0);

    return {
      totalRevenue,
      totalItems,
      totalTransactions,
      avgTransaction,
      totalProfit
    };
  };

  const getSalesByCategory = () => {
    const filteredSales = getDateRangeSales();
    const categorySales = {};

    filteredSales.forEach(sale => {
      sale.items.forEach(item => {
        const product = products.find(p => p.id === item.productId);
        if (product) {
          if (!categorySales[product.category]) {
            categorySales[product.category] = { revenue: 0, items: 0 };
          }
          categorySales[product.category].revenue += item.price * item.quantity;
          categorySales[product.category].items += item.quantity;
        }
      });
    });

    return Object.entries(categorySales)
      .map(([category, data]) => ({
        category,
        ...data
      }))
      .sort((a, b) => b.revenue - a.revenue);
  };

  const getSalesByPaymentMethod = () => {
    const filteredSales = getDateRangeSales();
    const methodSales = {
      cash: 0,
      card: 0,
      ath_movil: 0,
      split: 0
    };

    filteredSales.forEach(sale => {
      if (Array.isArray(sale.payments) && sale.payments.length > 1) {
        sale.payments.forEach((payment) => {
          const method = normalizePaymentMethod(payment.method);
          if (methodSales.hasOwnProperty(method)) {
            methodSales[method] += Number(payment.amount || 0);
          }
        });
        methodSales.split += getNetSaleTotal(sale);
        return;
      }

      const method = normalizePaymentMethod(sale.paymentMethod);
      if (methodSales.hasOwnProperty(method)) {
        methodSales[method] += getNetSaleTotal(sale);
      }
    });

    return methodSales;
  };

  const getTopProducts = () => {
    const filteredSales = getDateRangeSales();
    const productSales = {};

    filteredSales.forEach(sale => {
      sale.items.forEach(item => {
        if (!productSales[item.productId]) {
          productSales[item.productId] = { 
            name: item.name, 
            quantity: 0, 
            revenue: 0 
          };
        }
        productSales[item.productId].quantity += item.quantity;
        productSales[item.productId].revenue += item.price * item.quantity;
      });
    });

    return Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  };

  const getHourlySales = () => {
    const filteredSales = getDateRangeSales();
    const hourlyData = Array(24).fill(0).map((_, i) => ({ hour: i, sales: 0 }));

    filteredSales.forEach(sale => {
      const hour = new Date(sale.date).getHours();
      hourlyData[hour].sales += getNetSaleTotal(sale);
    });

    return hourlyData;
  };

  const getDailySales = () => {
    const filteredSales = getDateRangeSales();
    const dailyData = {};

    filteredSales.forEach(sale => {
      const date = new Date(sale.date).toLocaleDateString();
      if (!dailyData[date]) {
        dailyData[date] = { date, revenue: 0, transactions: 0 };
      }
      dailyData[date].revenue += getNetSaleTotal(sale);
      dailyData[date].transactions += 1;
    });

    return Object.values(dailyData).sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    );
  };

  const exportReport = () => {
    const metrics = calculateMetrics();
    const topProducts = getTopProducts();
    const categorySales = getSalesByCategory();
    
    const report = {
      dateRange: { startDate, endDate },
      metrics,
      topProducts,
      categorySales,
      generatedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-report-${startDate}-to-${endDate}.json`;
    a.click();
    URL.revokeObjectURL(url);

    setNotification({ type: 'success', message: 'Reporte exportado correctamente' });
  };

  const metrics = calculateMetrics();
  const topProducts = getTopProducts();
  const categorySales = getSalesByCategory();
  const paymentMethods = getSalesByPaymentMethod();
  const hourlySales = getHourlySales();
  const dailySales = getDailySales();
  const specialOrderMetrics = useMemo(() => {
    const filtered = hydratedSpecialOrders.filter((order) => {
      const relevantDate = new Date(order.deliveredAt || order.createdAt);
      const start = parseLocalDate(startDate, false);
      const end = parseLocalDate(endDate, true);
      if (!start || !end) return false;
      return relevantDate >= start && relevantDate <= end;
    });

    return {
      deposits: filtered.reduce((sum, order) => sum + Number(order.depositAmount || 0), 0),
      pendingBalance: filtered
        .filter((order) => order.orderStatus !== SPECIAL_ORDER_STATUS.canceled)
        .reduce((sum, order) => sum + Number(order.balanceDue || 0), 0),
      readyCount: filtered.filter((order) => order.orderStatus === SPECIAL_ORDER_STATUS.ready_for_pickup).length,
      completedCount: filtered.filter((order) => order.orderStatus === SPECIAL_ORDER_STATUS.delivered).length,
      deliveredProfit: filtered
        .filter((order) => order.orderStatus === SPECIAL_ORDER_STATUS.delivered)
        .reduce(
          (sum, order) => sum + order.items.reduce(
            (itemSum, item) => itemSum + ((Number(item.unitPrice || 0) - Number(item.unitCost || 0)) * Number(item.quantity || 0)),
            0
          ),
          0
        )
    };
  }, [endDate, hydratedSpecialOrders, startDate]);
  const maxHourlySales = Math.max(...hourlySales.map(h => h.sales));
  const maxDailySales = Math.max(...dailySales.map(d => d.revenue));

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <BarChart3 className="text-primary-600" size={28} />
          <h1 className="page-title">Reportes y analitica</h1>
        </div>
        <button onClick={exportReport} className="btn-secondary">
          <Download size={16} className="mr-2" />
          Exportar reporte
        </button>
      </div>

      {/* Date Range Filter */}
      <div className="card p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar size={20} className="text-gray-500" />
            <span className="font-medium">Rango de fechas:</span>
          </div>
          <div className="flex gap-2">
            {['today', 'week', 'month', 'year'].map(range => (
              <button
                key={range}
                onClick={() => handleDateRangePreset(range)}
                className={`px-3 py-1 rounded text-sm ${
                  dateRange === range
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {{
                  today: 'Hoy',
                  week: 'Semana',
                  month: 'Mes',
                  year: 'Ano'
                }[range]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setDateRange('custom');
              }}
              className="input"
            />
            <span className="text-gray-500">a</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setDateRange('custom');
              }}
              className="input"
            />
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="stats-grid">
        <div className="card p-6">
          <div className="stat-label">Ingresos totales</div>
          <div className="stat-value">{formatCurrency(metrics.totalRevenue)}</div>
          <div className="stat-trend">
            <DollarSign size={16} className="text-green-500" />
            <span className="text-green-500">Ventas brutas</span>
          </div>
        </div>
        <div className="card p-6">
          <div className="stat-label">Ganancia total</div>
          <div className="stat-value text-green-600">{formatCurrency(metrics.totalProfit + specialOrderMetrics.deliveredProfit)}</div>
          <div className="stat-trend">
            <TrendingUp size={16} className="text-green-500" />
            <span className="text-green-500">Ventas + pedidos entregados</span>
          </div>
        </div>
        <div className="card p-6">
          <div className="stat-label">Transacciones</div>
          <div className="stat-value">{metrics.totalTransactions}</div>
          <div className="stat-trend">
            <ShoppingBag size={16} className="text-blue-500" />
            <span className="text-blue-500">Ordenes</span>
          </div>
        </div>
        <div className="card p-6">
          <div className="stat-label">Transaccion promedio</div>
          <div className="stat-value">{formatCurrency(metrics.avgTransaction)}</div>
          <div className="stat-trend">
            <TrendingUp size={16} className="text-purple-500" />
            <span className="text-purple-500">Por orden</span>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Daily Sales Chart */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-4">Ingresos diarios</h3>
          {dailySales.length > 0 ? (
            <div className="h-64 flex items-end gap-2">
              {dailySales.slice(-7).map((day, index) => (
                <div key={index} className="flex-1 flex flex-col items-center">
                  <div 
                    className="w-full bg-primary-500 rounded-t transition-all duration-300"
                    style={{ 
                      height: `${maxDailySales > 0 ? (day.revenue / maxDailySales) * 200 : 0}px`,
                      minHeight: day.revenue > 0 ? '4px' : '0'
                    }}
                  />
                  <div className="text-xs text-gray-500 mt-2 text-center">
                    {new Date(day.date).toLocaleDateString('es-ES', { weekday: 'short' })}
                  </div>
                  <div className="text-xs font-medium">
                    {formatCurrency(day.revenue)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-500">
              No hay datos para el periodo seleccionado
            </div>
          )}
        </div>

        {/* Hourly Sales Chart */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-4">Distribucion por hora</h3>
          <div className="h-64 flex items-end gap-1">
            {hourlySales.map((hour, index) => (
              <div key={index} className="flex-1 flex flex-col items-center group relative">
                <div 
                  className="w-full bg-blue-400 rounded-t transition-all duration-300 hover:bg-blue-500"
                  style={{ 
                    height: `${maxHourlySales > 0 ? (hour.sales / maxHourlySales) * 200 : 0}px`,
                    minHeight: hour.sales > 0 ? '2px' : '0'
                  }}
                />
                {index % 4 === 0 && (
                  <div className="text-xs text-gray-500 mt-1">
                    {hour.hour}:00
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Second Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Products */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-4">Top 10 productos</h3>
          {topProducts.length > 0 ? (
            <div className="space-y-3">
              {topProducts.map((product, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 font-bold text-sm">
                      {index + 1}
                    </div>
                    <div>
                      <div className="font-medium">{product.name}</div>
                      <div className="text-sm text-gray-500">{product.quantity} vendidos</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">{formatCurrency(product.revenue)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-gray-500">
              No se vendieron productos en este periodo
            </div>
          )}
        </div>

        {/* Sales by Category */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-4">Ventas por categoria</h3>
          {categorySales.length > 0 ? (
            <div className="space-y-3">
              {categorySales.map((cat, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{cat.category}</span>
                    <span className="font-bold">{formatCurrency(cat.revenue)}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${categorySales[0] ? (cat.revenue / categorySales[0].revenue) * 100 : 0}%` 
                      }}
                    />
                  </div>
                  <div className="text-sm text-gray-500 mt-1">{cat.items} articulos vendidos</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-gray-500">
              No hay datos por categoria para este periodo
            </div>
          )}
        </div>
      </div>

      {/* Payment Methods */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold mb-4">Distribucion por metodo de pago</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 bg-green-50 rounded-lg text-center">
            <div className="text-2xl font-bold text-green-600">{formatCurrency(paymentMethods.cash)}</div>
            <div className="text-sm text-gray-600 mt-1">Pagos en efectivo</div>
            <div className="text-xs text-gray-500">
              {metrics.totalRevenue > 0 
                ? Math.round((paymentMethods.cash / metrics.totalRevenue) * 100) 
                : 0}% del total
            </div>
          </div>
          <div className="p-4 bg-blue-50 rounded-lg text-center">
            <div className="text-2xl font-bold text-blue-600">{formatCurrency(paymentMethods.card)}</div>
            <div className="text-sm text-gray-600 mt-1">Pagos con tarjeta</div>
            <div className="text-xs text-gray-500">
              {metrics.totalRevenue > 0 
                ? Math.round((paymentMethods.card / metrics.totalRevenue) * 100) 
                : 0}% del total
            </div>
          </div>
          <div className="p-4 bg-purple-50 rounded-lg text-center">
            <div className="text-2xl font-bold text-purple-600">{formatCurrency(paymentMethods.ath_movil)}</div>
            <div className="text-sm text-gray-600 mt-1">Pagos por ATH Movil</div>
            <div className="text-xs text-gray-500">
              {metrics.totalRevenue > 0 
                ? Math.round((paymentMethods.ath_movil / metrics.totalRevenue) * 100) 
                : 0}% del total
            </div>
          </div>
          <div className="p-4 bg-amber-50 rounded-lg text-center">
            <div className="text-2xl font-bold text-amber-600">{formatCurrency(paymentMethods.split)}</div>
            <div className="text-sm text-gray-600 mt-1">Ventas split</div>
            <div className="text-xs text-gray-500">
              {metrics.totalRevenue > 0
                ? Math.round((paymentMethods.split / metrics.totalRevenue) * 100)
                : 0}% del total
            </div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-lg font-semibold mb-4">Pedidos especiales</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 bg-blue-50 rounded-lg text-center">
            <div className="text-2xl font-bold text-blue-600">{formatCurrency(specialOrderMetrics.deposits)}</div>
            <div className="text-sm text-gray-600 mt-1">Anticipos cobrados</div>
          </div>
          <div className="p-4 bg-amber-50 rounded-lg text-center">
            <div className="text-2xl font-bold text-amber-600">{formatCurrency(specialOrderMetrics.pendingBalance)}</div>
            <div className="text-sm text-gray-600 mt-1">Balance pendiente</div>
          </div>
          <div className="p-4 bg-green-50 rounded-lg text-center">
            <div className="text-2xl font-bold text-green-600">{specialOrderMetrics.readyCount}</div>
            <div className="text-sm text-gray-600 mt-1">Listos para recoger</div>
          </div>
          <div className="p-4 bg-indigo-50 rounded-lg text-center">
            <div className="text-2xl font-bold text-indigo-600">{specialOrderMetrics.completedCount}</div>
            <div className="text-sm text-gray-600 mt-1">Completados</div>
          </div>
          <div className="p-4 bg-emerald-50 rounded-lg text-center md:col-span-4">
            <div className="text-2xl font-bold text-emerald-600">{formatCurrency(specialOrderMetrics.deliveredProfit)}</div>
            <div className="text-sm text-gray-600 mt-1">Ganancia de pedidos especiales entregados</div>
          </div>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <Notification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}
    </div>
  );
};

export default Reports;
