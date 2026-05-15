import React, { useEffect, useMemo, useState } from 'react';
import {
  Globe2,
  Eye,
  PackageCheck,
  UserRound,
  Mail,
  Phone,
  MapPin,
  CreditCard,
  Truck,
  Search,
  ShoppingBag,
  XCircle,
  Settings,
  Save
} from 'lucide-react';
import Modal from '../components/Modal';
import Notification from '../components/Notification';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, formatDateTime, loadData } from '../data/demoData';
import {
  DEFAULT_ONLINE_STORE_SETTINGS,
  cancelOnlineOrder,
  saveOnlineStoreSettings,
  subscribeOnlineOrders,
  subscribeOnlineStoreSettings
} from '../services/onlineOrdersService';

const ONLINE_ORDER_STATUS_LABELS = {
  pending: 'Pendiente',
  new: 'Nueva',
  processing: 'Procesando',
  paid: 'Pagada',
  fulfilled: 'Completada',
  completed: 'Completada',
  shipped: 'Enviada',
  delivered: 'Entregada',
  cancelled: 'Cancelada',
  canceled: 'Cancelada',
  refunded: 'Reembolsada'
};

const ONLINE_ORDER_BADGE_CLASSES = {
  pending: 'badge-warning',
  new: 'badge-blue',
  processing: 'badge-blue',
  paid: 'badge-green',
  fulfilled: 'badge-green',
  completed: 'badge-green',
  shipped: 'badge-purple',
  delivered: 'badge-green',
  cancelled: 'badge-red',
  canceled: 'badge-red',
  refunded: 'badge-gray'
};

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const toSearchText = (value) => String(value || '').trim().toLowerCase();

const formatSafeDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : formatDateTime(value);
};

const formatStatus = (status) => {
  const normalized = String(status || '').toLowerCase();
  return ONLINE_ORDER_STATUS_LABELS[normalized] || (status ? String(status) : '-');
};

const getOnlineOrderBadgeClass = (status) => {
  const normalized = String(status || '').toLowerCase();
  return `badge ${ONLINE_ORDER_BADGE_CLASSES[normalized] || 'badge-gray'}`;
};

const formatAddress = (address = {}) => (
  [
    address.line1,
    address.line2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(', '),
    address.country
  ]
    .filter(Boolean)
    .join(' - ') || '-'
);

const isOnlineOrderCancellable = (order) => {
  const blockedStatuses = new Set(['cancelled', 'canceled', 'refunded', 'completed', 'fulfilled', 'delivered']);
  return Boolean(order?.id) && !blockedStatuses.has(String(order.status || '').toLowerCase());
};

const buildSettingsForm = (settings = DEFAULT_ONLINE_STORE_SETTINGS) => ({
  shippingEnabled: settings.shippingEnabled === true,
  pickupEnabled: settings.pickupEnabled === true,
  shippingFlatRate: String(settings.shippingFlatRate ?? 0),
  freeShippingMinimum: String(settings.freeShippingMinimum ?? 0),
  maxShippingOrderItems: String(settings.maxShippingOrderItems ?? 0),
  maxShippingOrderQuantity: String(settings.maxShippingOrderQuantity ?? 0),
  maxQuantityPerLineItem: String(settings.maxQuantityPerLineItem ?? 0),
  shippingPolicyNote: settings.shippingPolicyNote || ''
});

const parseSettingsForm = (form) => ({
  shippingEnabled: form.shippingEnabled === true,
  pickupEnabled: form.pickupEnabled === true,
  shippingFlatRate: Number(form.shippingFlatRate || 0),
  freeShippingMinimum: Number(form.freeShippingMinimum || 0),
  maxShippingOrderItems: Number(form.maxShippingOrderItems || 0),
  maxShippingOrderQuantity: Number(form.maxShippingOrderQuantity || 0),
  maxQuantityPerLineItem: Number(form.maxQuantityPerLineItem || 0),
  shippingPolicyNote: String(form.shippingPolicyNote || '').trim()
});

const OnlineStore = () => {
  const { user, profile } = useAuth();
  const [onlineOrders, setOnlineOrders] = useState([]);
  const [onlineStoreSettings, setOnlineStoreSettings] = useState(DEFAULT_ONLINE_STORE_SETTINGS);
  const [settingsForm, setSettingsForm] = useState(buildSettingsForm(DEFAULT_ONLINE_STORE_SETTINGS));
  const [selectedOnlineOrder, setSelectedOnlineOrder] = useState(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [orderToCancel, setOrderToCancel] = useState(null);
  const [cancelNote, setCancelNote] = useState('');
  const [isCancellingOrder, setIsCancellingOrder] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [onlineOrderSearchTerm, setOnlineOrderSearchTerm] = useState('');
  const [onlineOrderStatusFilter, setOnlineOrderStatusFilter] = useState('all');
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    const data = loadData();
    setOnlineOrders(data.onlineOrders || []);

    const unsubscribe = subscribeOnlineOrders(
      (rows) => setOnlineOrders(rows),
      (error) => console.error('Error subscribing online orders:', error)
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeOnlineStoreSettings(
      (settings) => {
        setOnlineStoreSettings(settings);
        setSettingsForm(buildSettingsForm(settings));
      },
      (error) => console.error('Error subscribing online store settings:', error)
    );

    return () => unsubscribe();
  }, []);

  const onlineOrderStatusOptions = useMemo(() => {
    const statuses = [...new Set(onlineOrders.map((order) => order.status).filter(Boolean))];
    return statuses.sort((a, b) => formatStatus(a).localeCompare(formatStatus(b), 'es'));
  }, [onlineOrders]);

  const filteredOnlineOrders = useMemo(() => {
    const search = toSearchText(onlineOrderSearchTerm);

    return onlineOrders.filter((order) => {
      const matchesStatus = onlineOrderStatusFilter === 'all' || order.status === onlineOrderStatusFilter;
      if (!matchesStatus) return false;
      if (!search) return true;

      const searchableText = [
        order.orderNumber,
        order.id,
        order.customerName,
        order.customerEmail,
        order.customerPhone,
        order.paymentStatus,
        order.deliveryMethod,
        ...(order.items || []).flatMap((item) => [item.name, item.sku])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchableText.includes(search);
    });
  }, [onlineOrderSearchTerm, onlineOrderStatusFilter, onlineOrders]);

  const onlineOrderSummary = useMemo(() => {
    const openStatuses = new Set(['pending', 'new', 'processing', 'paid']);
    const cancelledStatuses = new Set(['cancelled', 'canceled', 'refunded']);

    return onlineOrders.reduce(
      (summary, order) => {
        summary.totalOrders += 1;
        summary.totalRevenue = roundMoney(summary.totalRevenue + Number(order.total || 0));
        summary.totalItems += Number(order.itemCount || 0);

        if (openStatuses.has(order.status)) summary.openOrders += 1;
        if (cancelledStatuses.has(order.status)) summary.cancelledOrders += 1;

        return summary;
      },
      {
        totalOrders: 0,
        openOrders: 0,
        cancelledOrders: 0,
        totalItems: 0,
        totalRevenue: 0
      }
    );
  }, [onlineOrders]);

  const openCancelModal = (order) => {
    setOrderToCancel(order);
    setCancelNote('');
  };

  const openSettingsModal = () => {
    setSettingsForm(buildSettingsForm(onlineStoreSettings));
    setShowSettingsModal(true);
  };

  const updateSettingsField = (key, value) => {
    setSettingsForm((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSaveSettings = async () => {
    if (isSavingSettings) return;

    const nextSettings = parseSettingsForm(settingsForm);
    const numericFields = [
      nextSettings.shippingFlatRate,
      nextSettings.freeShippingMinimum,
      nextSettings.maxShippingOrderItems,
      nextSettings.maxShippingOrderQuantity,
      nextSettings.maxQuantityPerLineItem
    ];

    if (numericFields.some((value) => !Number.isFinite(value) || value < 0)) {
      setNotification({ type: 'error', message: 'Los valores de configuracion deben ser numeros positivos.' });
      return;
    }

    setIsSavingSettings(true);
    try {
      const saved = await saveOnlineStoreSettings(nextSettings, {
        id: user?.uid || profile?.id || '',
        name: profile?.name || user?.email || 'Usuario'
      });

      setOnlineStoreSettings(saved);
      setSettingsForm(buildSettingsForm(saved));
      setShowSettingsModal(false);
      setNotification({ type: 'success', message: 'Settings de tienda online guardados.' });
    } catch (error) {
      console.error('Error saving online store settings:', error);
      setNotification({ type: 'error', message: 'No se pudo guardar la configuracion de tienda online.' });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleCancelOnlineOrder = async () => {
    if (!orderToCancel?.id || isCancellingOrder) return;

    setIsCancellingOrder(true);
    try {
      await cancelOnlineOrder({
        orderId: orderToCancel.id,
        cancelledBy: profile?.name || user?.email || 'Usuario',
        cancelledById: user?.uid || profile?.id || '',
        note: cancelNote
      });

      setOnlineOrders((prev) => prev.map((order) => (
        order.id === orderToCancel.id
          ? {
            ...order,
            status: 'cancelled',
            orderStatus: 'cancelled',
            fulfillmentStatus: 'cancelled',
            cancellationNote: cancelNote,
            cancelledAt: new Date().toISOString()
          }
          : order
      )));

      if (selectedOnlineOrder?.id === orderToCancel.id) {
        setSelectedOnlineOrder((prev) => prev ? {
          ...prev,
          status: 'cancelled',
          orderStatus: 'cancelled',
          fulfillmentStatus: 'cancelled',
          cancellationNote: cancelNote,
          cancelledAt: new Date().toISOString()
        } : prev);
      }

      setOrderToCancel(null);
      setCancelNote('');
      setNotification({ type: 'success', message: 'Orden online cancelada.' });
    } catch (error) {
      console.error('Error cancelling online order:', error);
      setNotification({ type: 'error', message: 'No se pudo cancelar la orden online.' });
    } finally {
      setIsCancellingOrder(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Globe2 className="text-primary-600" size={28} />
          <div>
            <h1 className="page-title">Tienda online</h1>
            <p className="text-sm text-gray-500">Ordenes cargadas desde Firebase en la coleccion onlineOrders.</p>
          </div>
        </div>
        <button type="button" onClick={openSettingsModal} className="btn-secondary">
          <Settings size={16} />
          Settings
        </button>
      </div>

      <div className="stats-grid">
        <div className="card">
          <div className="stat-label">Ordenes online</div>
          <div className="stat-value">{onlineOrderSummary.totalOrders}</div>
          <div className="stat-trend text-gray-500">
            <ShoppingBag size={16} />
            Total recibido
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Ordenes abiertas</div>
          <div className="stat-value">{onlineOrderSummary.openOrders}</div>
          <div className="stat-trend text-blue-500">
            <PackageCheck size={16} />
            Pendientes o en proceso
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Ingresos online</div>
          <div className="stat-value">{formatCurrency(onlineOrderSummary.totalRevenue)}</div>
          <div className="stat-trend text-emerald-600">
            <CreditCard size={16} />
            Total de ordenes
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Items vendidos</div>
          <div className="stat-value">{onlineOrderSummary.totalItems}</div>
          <div className="stat-trend text-purple-500">
            <PackageCheck size={16} />
            Unidades online
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Envio</p>
            <p className="font-semibold text-gray-900">
              {onlineStoreSettings.shippingEnabled ? formatCurrency(onlineStoreSettings.shippingFlatRate) : 'Desactivado'}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Envio gratis desde</p>
            <p className="font-semibold text-gray-900">
              {onlineStoreSettings.freeShippingMinimum > 0 ? formatCurrency(onlineStoreSettings.freeShippingMinimum) : 'No aplica'}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Maximo por envio</p>
            <p className="font-semibold text-gray-900">
              {onlineStoreSettings.maxShippingOrderQuantity > 0 ? `${onlineStoreSettings.maxShippingOrderQuantity} unidades` : 'Sin limite'}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Pickup</p>
            <p className="font-semibold text-gray-900">{onlineStoreSettings.pickupEnabled ? 'Activo' : 'Desactivado'}</p>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="filter-container">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={onlineOrderSearchTerm}
              onChange={(e) => setOnlineOrderSearchTerm(e.target.value)}
              placeholder="Buscar por orden, cliente, email, telefono, producto o SKU"
              className="input w-full pl-10"
            />
          </div>
          <select
            value={onlineOrderStatusFilter}
            onChange={(e) => setOnlineOrderStatusFilter(e.target.value)}
            className="input w-full md:w-56"
          >
            <option value="all">Todos los estados</option>
            {onlineOrderStatusOptions.map((status) => (
              <option key={status} value={status}>{formatStatus(status)}</option>
            ))}
          </select>
        </div>

        <div className="table-container max-h-[42rem] overflow-y-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Orden</th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th>Estado</th>
                <th>Pago</th>
                <th>Entrega</th>
                <th>Items</th>
                <th>Total</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredOnlineOrders.length === 0 ? (
                <tr>
                  <td colSpan="9" className="text-center py-8 text-gray-500">
                    {onlineOrders.length === 0 ? 'No hay ordenes online todavia.' : 'No se encontraron ordenes con esos filtros.'}
                  </td>
                </tr>
              ) : (
                filteredOnlineOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td>
                      <div className="font-semibold text-gray-900">#{order.orderNumber || order.id}</div>
                      <div className="text-xs text-gray-500">{order.id}</div>
                    </td>
                    <td>
                      <div className="font-medium text-gray-900">{order.customerName}</div>
                      <div className="text-xs text-gray-500">{order.customerEmail || order.customerPhone || '-'}</div>
                    </td>
                    <td>{formatSafeDateTime(order.createdAt)}</td>
                    <td>
                      <span className={getOnlineOrderBadgeClass(order.status)}>{formatStatus(order.status)}</span>
                    </td>
                    <td>
                      <div className="capitalize">{formatStatus(order.paymentStatus)}</div>
                      <div className="text-xs text-gray-500">{order.paymentMethod || '-'}</div>
                    </td>
                    <td>{order.deliveryMethod || '-'}</td>
                    <td>{Number(order.itemCount || 0)}</td>
                    <td className="font-semibold text-gray-900">{formatCurrency(order.total || 0)}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedOnlineOrder(order)}
                          className="btn-secondary inline-flex items-center gap-2"
                        >
                          <Eye size={14} />
                          Ver
                        </button>
                        {isOnlineOrderCancellable(order) && (
                          <button
                            type="button"
                            onClick={() => openCancelModal(order)}
                            className="btn-danger inline-flex items-center gap-2"
                          >
                            <XCircle size={14} />
                            Cancelar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedOnlineOrder && (
        <Modal
          isOpen={Boolean(selectedOnlineOrder)}
          onClose={() => setSelectedOnlineOrder(null)}
          title={`Orden online #${selectedOnlineOrder.orderNumber || selectedOnlineOrder.id}`}
          size="full"
        >
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm text-gray-500">Estado</p>
                <span className={getOnlineOrderBadgeClass(selectedOnlineOrder.status)}>
                  {formatStatus(selectedOnlineOrder.status)}
                </span>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm text-gray-500">Pago</p>
                <p className="font-semibold text-gray-900">{formatStatus(selectedOnlineOrder.paymentStatus)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm text-gray-500">Total</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(selectedOnlineOrder.total || 0)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm text-gray-500">Fecha</p>
                <p className="font-semibold text-gray-900">{formatSafeDateTime(selectedOnlineOrder.createdAt)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="rounded-lg border border-gray-200 p-4">
                <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <UserRound size={16} />
                  Cliente
                </h3>
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-gray-900">{selectedOnlineOrder.customerName}</p>
                  <p className="flex items-center gap-2 text-gray-600">
                    <Mail size={14} />
                    {selectedOnlineOrder.customerEmail || '-'}
                  </p>
                  <p className="flex items-center gap-2 text-gray-600">
                    <Phone size={14} />
                    {selectedOnlineOrder.customerPhone || '-'}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-4">
                <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Truck size={16} />
                  Entrega
                </h3>
                <div className="space-y-2 text-sm text-gray-600">
                  <p><strong>Metodo:</strong> {selectedOnlineOrder.deliveryMethod || '-'}</p>
                  <p><strong>Estado:</strong> {formatStatus(selectedOnlineOrder.fulfillmentStatus)}</p>
                  <p className="flex items-start gap-2">
                    <MapPin size={14} className="mt-0.5 flex-shrink-0" />
                    <span>{formatAddress(selectedOnlineOrder.shippingAddress)}</span>
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-4">
                <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <CreditCard size={16} />
                  Facturacion
                </h3>
                <div className="space-y-2 text-sm text-gray-600">
                  <p><strong>Metodo:</strong> {selectedOnlineOrder.paymentMethod || '-'}</p>
                  <p><strong>Subtotal:</strong> {formatCurrency(selectedOnlineOrder.subtotal || 0)}</p>
                  <p><strong>Tax:</strong> {formatCurrency(selectedOnlineOrder.tax || 0)}</p>
                  <p><strong>Shipping:</strong> {formatCurrency(selectedOnlineOrder.shippingCost || 0)}</p>
                  <p><strong>Descuento:</strong> {formatCurrency(selectedOnlineOrder.discount || 0)}</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <PackageCheck size={16} />
                <h3 className="font-semibold text-gray-900">Productos</h3>
              </div>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>SKU</th>
                      <th>Opciones</th>
                      <th>Cantidad</th>
                      <th>Precio</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedOnlineOrder.items || []).length === 0 ? (
                      <tr>
                        <td colSpan="6" className="text-center py-8 text-gray-500">
                          Esta orden no trae productos en el campo items/cartItems/products.
                        </td>
                      </tr>
                    ) : (
                      selectedOnlineOrder.items.map((item, index) => (
                        <tr key={`${item.id}_${index}`}>
                          <td className="font-medium text-gray-900">{item.name}</td>
                          <td>{item.sku || '-'}</td>
                          <td>{[item.selectedSize, item.selectedColor].filter(Boolean).join(' / ') || '-'}</td>
                          <td>{item.quantity}</td>
                          <td>{formatCurrency(item.price || 0)}</td>
                          <td className="font-semibold text-gray-900">{formatCurrency(item.total || 0)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {(selectedOnlineOrder.notes || selectedOnlineOrder.internalNotes) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-gray-200 p-4">
                  <h3 className="font-semibold text-gray-900 mb-2">Nota del cliente</h3>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{selectedOnlineOrder.notes || '-'}</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-4">
                  <h3 className="font-semibold text-gray-900 mb-2">Nota interna</h3>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{selectedOnlineOrder.internalNotes || '-'}</p>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
              <button
                type="button"
                onClick={() => setSelectedOnlineOrder(null)}
                className="btn-secondary"
              >
                Cerrar
              </button>
              {isOnlineOrderCancellable(selectedOnlineOrder) && (
                <button
                  type="button"
                  onClick={() => openCancelModal(selectedOnlineOrder)}
                  className="btn-danger"
                >
                  <XCircle size={16} />
                  Cancelar orden
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {orderToCancel && (
        <Modal
          isOpen={Boolean(orderToCancel)}
          onClose={() => !isCancellingOrder && setOrderToCancel(null)}
          title={`Cancelar orden #${orderToCancel.orderNumber || orderToCancel.id}`}
          size="md"
        >
          <div className="space-y-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="font-semibold text-red-900">Esta accion marcara la orden como cancelada.</p>
              <p className="text-sm text-red-700">
                No procesa reembolsos automaticamente. Si la orden fue pagada, el reembolso debe manejarse en el proveedor de pago o en la tienda online.
              </p>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">Cliente</span>
                <strong className="text-gray-900 text-right">{orderToCancel.customerName}</strong>
              </div>
              <div className="flex justify-between gap-3 mt-2">
                <span className="text-gray-500">Total</span>
                <strong className="text-gray-900">{formatCurrency(orderToCancel.total || 0)}</strong>
              </div>
              <div className="flex justify-between gap-3 mt-2">
                <span className="text-gray-500">Pago</span>
                <strong className="text-gray-900">{formatStatus(orderToCancel.paymentStatus)}</strong>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nota de cancelacion
              </label>
              <textarea
                value={cancelNote}
                onChange={(e) => setCancelNote(e.target.value)}
                className="input w-full min-h-[6rem]"
                placeholder="Ej. Cliente solicito cancelar, producto no disponible, orden duplicada..."
                disabled={isCancellingOrder}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOrderToCancel(null)}
                className="btn-secondary"
                disabled={isCancellingOrder}
              >
                Volver
              </button>
              <button
                type="button"
                onClick={handleCancelOnlineOrder}
                className="btn-danger"
                disabled={isCancellingOrder}
              >
                <XCircle size={16} />
                {isCancellingOrder ? 'Cancelando...' : 'Confirmar cancelacion'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showSettingsModal && (
        <Modal
          isOpen={showSettingsModal}
          onClose={() => !isSavingSettings && setShowSettingsModal(false)}
          title="Settings de tienda online"
          size="lg"
        >
          <div className="space-y-5">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="font-semibold text-blue-900">Firebase: onlineStoreSettings/config</p>
              <p className="text-sm text-blue-700">
                La tienda online debe leer este documento para calcular envio y validar limites antes de crear una orden.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-4">
                <span>
                  <span className="block font-medium text-gray-900">Permitir envios</span>
                  <span className="text-sm text-gray-500">Si esta apagado, la tienda no debe ofrecer shipping.</span>
                </span>
                <input
                  type="checkbox"
                  checked={settingsForm.shippingEnabled}
                  onChange={(e) => updateSettingsField('shippingEnabled', e.target.checked)}
                  className="h-5 w-5"
                  disabled={isSavingSettings}
                />
              </label>

              <label className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-4">
                <span>
                  <span className="block font-medium text-gray-900">Permitir pickup</span>
                  <span className="text-sm text-gray-500">Activa recogido en tienda como metodo disponible.</span>
                </span>
                <input
                  type="checkbox"
                  checked={settingsForm.pickupEnabled}
                  onChange={(e) => updateSettingsField('pickupEnabled', e.target.checked)}
                  className="h-5 w-5"
                  disabled={isSavingSettings}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Costo fijo de envio</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={settingsForm.shippingFlatRate}
                  onChange={(e) => updateSettingsField('shippingFlatRate', e.target.value)}
                  className="input w-full"
                  disabled={isSavingSettings}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Envio gratis desde</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={settingsForm.freeShippingMinimum}
                  onChange={(e) => updateSettingsField('freeShippingMinimum', e.target.value)}
                  className="input w-full"
                  disabled={isSavingSettings}
                />
                <p className="mt-1 text-xs text-gray-500">Usa 0 para no ofrecer envio gratis automatico.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Maximo de lineas por orden con envio</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={settingsForm.maxShippingOrderItems}
                  onChange={(e) => updateSettingsField('maxShippingOrderItems', e.target.value)}
                  className="input w-full"
                  disabled={isSavingSettings}
                />
                <p className="mt-1 text-xs text-gray-500">Usa 0 para no limitar cantidad de productos distintos.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Maximo de unidades por orden con envio</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={settingsForm.maxShippingOrderQuantity}
                  onChange={(e) => updateSettingsField('maxShippingOrderQuantity', e.target.value)}
                  className="input w-full"
                  disabled={isSavingSettings}
                />
                <p className="mt-1 text-xs text-gray-500">Usa 0 para no limitar unidades totales.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Maximo de unidades por producto</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={settingsForm.maxQuantityPerLineItem}
                  onChange={(e) => updateSettingsField('maxQuantityPerLineItem', e.target.value)}
                  className="input w-full"
                  disabled={isSavingSettings}
                />
                <p className="mt-1 text-xs text-gray-500">Usa 0 para no limitar cantidad por linea.</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nota/politica de envio</label>
              <textarea
                value={settingsForm.shippingPolicyNote}
                onChange={(e) => updateSettingsField('shippingPolicyNote', e.target.value)}
                className="input w-full min-h-[6rem]"
                placeholder="Ej. Enviamos solo dentro de Puerto Rico. Ordenes grandes requieren confirmacion."
                disabled={isSavingSettings}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="btn-secondary"
                disabled={isSavingSettings}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                className="btn-primary"
                disabled={isSavingSettings}
              >
                <Save size={16} />
                {isSavingSettings ? 'Guardando...' : 'Guardar settings'}
              </button>
            </div>
          </div>
        </Modal>
      )}

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

export default OnlineStore;
