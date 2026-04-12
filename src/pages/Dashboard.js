import React, { useState, useEffect } from 'react';
import { 
  ShoppingCart, 
  DollarSign, 
  Package, 
  Users, 
  TrendingUp,
  AlertTriangle,
  ArrowUpRight
} from 'lucide-react';
import { loadData, formatCurrency, formatDate } from '../data/demoData';
import { subscribeSales } from '../services/salesService';
import { subscribeProducts } from '../services/inventoryService';
import { subscribeEmployees } from '../services/employeesService';
import { getPaymentMethodLabel, normalizePaymentMethod } from '../utils/paymentUtils';
import { getNetSaleTotal, isRefundedSale, isReportableSale } from '../utils/salesUtils';
import { subscribeSpecialOrderPayments, subscribeSpecialOrders } from '../services/specialOrdersService';
import { normalizeSpecialOrder, SPECIAL_ORDER_STATUS } from '../utils/specialOrderUtils';

function Dashboard() {
  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [specialOrders, setSpecialOrders] = useState([]);
  const [specialOrderPayments, setSpecialOrderPayments] = useState([]);
  const [stats, setStats] = useState({});
  const [recentSales, setRecentSales] = useState([]);
  const [lowStockProducts, setLowStockProducts] = useState([]);
  const [topProducts, setTopProducts] = useState([]);

  useEffect(() => {
    const data = loadData();
    setSales(data.sales || []);
    setProducts(data.products || []);
    setEmployees(data.employees || []);
    setSpecialOrders(data.specialOrders || []);
    setSpecialOrderPayments(data.specialOrderPayments || []);

    const unsubSales = subscribeSales((rows) => setSales(rows), (err) => console.error(err));
    const unsubProducts = subscribeProducts((rows) => setProducts(rows), (err) => console.error(err));
    const unsubEmployees = subscribeEmployees((rows) => setEmployees(rows), (err) => console.error(err));
    const unsubSpecialOrders = subscribeSpecialOrders((rows) => setSpecialOrders(rows), (err) => console.error(err));
    const unsubSpecialPayments = subscribeSpecialOrderPayments((rows) => setSpecialOrderPayments(rows), (err) => console.error(err));

    return () => {
      unsubSales();
      unsubProducts();
      unsubEmployees();
      unsubSpecialOrders();
      unsubSpecialPayments();
    };
  }, []);

  const hydratedSpecialOrders = React.useMemo(
    () => (specialOrders || []).map((order) => normalizeSpecialOrder({
      ...order,
      payments: specialOrderPayments.filter((payment) => payment.specialOrderId === order.id)
    })),
    [specialOrderPayments, specialOrders]
  );

  useEffect(() => {
    // Calcular estadísticas
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const paidSales = sales.filter(isReportableSale);
    const todaySales = paidSales.filter(s => new Date(s.date) >= today);
    const totalSpecialRevenue = specialOrderPayments.reduce((sum, payment) => (
      sum + (payment.kind === 'refund' ? -Number(payment.amount || 0) : Number(payment.amount || 0))
    ), 0);
    const todaySpecialRevenue = specialOrderPayments
      .filter((payment) => new Date(payment.createdAt || payment.confirmed_at) >= today)
      .reduce((sum, payment) => (
        sum + (payment.kind === 'refund' ? -Number(payment.amount || 0) : Number(payment.amount || 0))
      ), 0);
    const totalRevenue = paidSales.reduce((sum, sale) => sum + getNetSaleTotal(sale), 0) + totalSpecialRevenue;
    const todayRevenue = todaySales.reduce((sum, sale) => sum + getNetSaleTotal(sale), 0) + todaySpecialRevenue;
    const lowStock = products.filter(p => p.stock <= p.lowStockThreshold);
    const readyOrders = hydratedSpecialOrders.filter((order) => order.orderStatus === SPECIAL_ORDER_STATUS.ready_for_pickup);
    const pendingBalance = hydratedSpecialOrders
      .filter((order) => order.orderStatus !== SPECIAL_ORDER_STATUS.canceled)
      .reduce((sum, order) => sum + Number(order.balanceDue || 0), 0);
    const deliveredSpecialOrdersToday = hydratedSpecialOrders.filter((order) => {
      if (order.orderStatus !== SPECIAL_ORDER_STATUS.delivered || !order.deliveredAt) return false;
      return new Date(order.deliveredAt) >= today;
    });
    const todaySpecialOrderProfit = deliveredSpecialOrdersToday.reduce(
      (sum, order) => sum + order.items.reduce(
        (itemSum, item) => itemSum + ((Number(item.unitPrice || 0) - Number(item.unitCost || 0)) * Number(item.quantity || 0)),
        0
      ),
      0
    );
    
    setStats({
      todaySales: todaySales.length,
      todayRevenue,
      totalProducts: products.length,
      lowStockCount: lowStock.length,
      totalRevenue,
      activeEmployees: employees.filter(e => e.active || e.status === 'active').length,
      readyOrders: readyOrders.length,
      pendingSpecialBalance: pendingBalance,
      todaySpecialOrderProfit
    });

    setRecentSales(sales.slice(0, 5));
    setLowStockProducts(lowStock);
    setTopProducts(products.slice(0, 5));
  }, [employees, hydratedSpecialOrders, products, sales, specialOrderPayments]);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card p-6 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">Ventas Hoy</p>
              <p className="text-3xl font-bold text-gray-900">{stats.todaySales || 0}</p>
              <p className="text-sm text-green-600 mt-2 flex items-center gap-1">
                <ArrowUpRight size={16} />
                +12% vs ayer
              </p>
            </div>
            <div className="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center">
              <ShoppingCart size={28} className="text-blue-600" />
            </div>
          </div>
        </div>

        <div className="card p-6 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">Ingresos Hoy</p>
              <p className="text-3xl font-bold text-gray-900">{formatCurrency(stats.todayRevenue || 0)}</p>
              <p className="text-sm text-green-600 mt-2 flex items-center gap-1">
                <ArrowUpRight size={16} />
                +8% vs ayer
              </p>
            </div>
            <div className="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center">
              <DollarSign size={28} className="text-green-600" />
            </div>
          </div>
        </div>

        <div className="card p-6 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">Productos</p>
              <p className="text-3xl font-bold text-gray-900">{stats.totalProducts || 0}</p>
              <p className="text-sm text-orange-600 mt-2 flex items-center gap-1">
                <AlertTriangle size={16} />
                {stats.lowStockCount || 0} bajo stock
              </p>
            </div>
            <div className="w-14 h-14 bg-purple-100 rounded-xl flex items-center justify-center">
              <Package size={28} className="text-purple-600" />
            </div>
          </div>
        </div>

        <div className="card p-6 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">Empleados Activos</p>
              <p className="text-3xl font-bold text-gray-900">{stats.activeEmployees || 0}</p>
              <p className="text-sm text-blue-600 mt-2 flex items-center gap-1">
                <TrendingUp size={16} />
                1 en turno
              </p>
            </div>
            <div className="w-14 h-14 bg-orange-100 rounded-xl flex items-center justify-center">
              <Users size={28} className="text-orange-600" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card p-6 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">Pedidos listos</p>
              <p className="text-3xl font-bold text-gray-900">{stats.readyOrders || 0}</p>
              <p className="text-sm text-green-600 mt-2">Pendientes de entrega</p>
            </div>
            <Package size={28} className="text-green-600" />
          </div>
        </div>
        <div className="card p-6 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">Balance de pedidos</p>
              <p className="text-3xl font-bold text-gray-900">{formatCurrency(stats.pendingSpecialBalance || 0)}</p>
              <p className="text-sm text-amber-600 mt-2">Pendiente por cobrar</p>
            </div>
            <DollarSign size={28} className="text-amber-600" />
          </div>
        </div>
        <div className="card p-6 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">Ganancia pedidos hoy</p>
              <p className="text-3xl font-bold text-gray-900">{formatCurrency(stats.todaySpecialOrderProfit || 0)}</p>
              <p className="text-sm text-indigo-600 mt-2">Solo pedidos entregados hoy</p>
            </div>
            <TrendingUp size={28} className="text-indigo-600" />
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly Sales Chart */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-4">Ventas de la Semana</h3>
          <div className="h-64 flex items-end justify-around gap-2">
            {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day, i) => {
              const heights = [120, 180, 150, 200, 170, 250, 220];
              return (
                <div key={day} className="flex flex-col items-center gap-2">
                  <div 
                    className="w-10 bg-gradient-to-t from-blue-600 to-blue-400 rounded-t-lg transition-all hover:from-blue-700 hover:to-blue-500 cursor-pointer"
                    style={{ height: `${heights[i]}px` }}
                  />
                  <span className="text-xs text-gray-500 font-medium">{day}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Products */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-4">Productos Más Vendidos</h3>
          <div className="space-y-4">
            {topProducts.map((product, index) => (
              <div key={product.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm">
                    {index + 1}
                  </span>
                  <div>
                    <p className="font-medium text-gray-900">{product.name}</p>
                    <p className="text-sm text-gray-500">{product.category}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-green-600">{formatCurrency(product.price)}</p>
                  <p className="text-xs text-gray-500">{Math.floor(Math.random() * 50 + 10)} vendidos</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Sales &amp; Low Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Sales */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-4">Ventas Recientes</h3>
          <div className="max-h-[26rem] overflow-y-auto pr-2 space-y-3">
            {recentSales.map((sale) => (
              <div key={sale.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <div>
                  <p className="font-medium text-gray-900">#{sale.id.split('_')[1].toUpperCase()}</p>
                  <p className="text-sm text-gray-500">{formatDate(sale.date)} - {sale.cashier}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-green-600">{formatCurrency(sale.total)}</p>
                  <span className={`badge ${
                    isRefundedSale(sale)
                      ? 'badge-danger'
                      : normalizePaymentMethod(sale.paymentMethod) === 'card'
                        ? 'badge-info'
                        : normalizePaymentMethod(sale.paymentMethod) === 'cash'
                          ? 'badge-success'
                          : 'badge-warning'
                  }`}>
                    {isRefundedSale(sale) ? 'Reembolsada' : getPaymentMethodLabel(sale.paymentMethod)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle size={20} className="text-orange-500" />
            Alertas de Stock Bajo
          </h3>
          <div className="max-h-[26rem] overflow-y-auto pr-2 space-y-3">
            {lowStockProducts.length > 0 ? (
              lowStockProducts.map((product) => (
                <div key={product.id} className="flex items-center justify-between p-4 bg-orange-50 border border-orange-200 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{product.name}</p>
                    <p className="text-sm text-gray-500">{product.category}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-orange-600">{product.stock} unidades</p>
                    <p className="text-xs text-gray-500">Mín: {product.lowStockThreshold}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Package size={48} className="mx-auto mb-2" />
                <p>Todos los productos tienen stock suficiente</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
