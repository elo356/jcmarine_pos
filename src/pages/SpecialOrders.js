import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, DollarSign, PackageCheck, Plus, Search, XCircle } from 'lucide-react';
import { formatCurrency, generateId, loadData, saveData } from '../data/demoData';
import Notification from '../components/Notification';
import SpecialOrderForm from '../components/special-orders/SpecialOrderForm';
import SpecialOrdersTable from '../components/special-orders/SpecialOrdersTable';
import SpecialOrderDetailModal from '../components/special-orders/SpecialOrderDetailModal';
import RegisterSpecialOrderPaymentModal from '../components/special-orders/RegisterSpecialOrderPaymentModal';
import SpecialOrderCancellationModal from '../components/special-orders/SpecialOrderCancellationModal';
import { useAuth } from '../contexts/AuthContext';
import { saveAuditLog } from '../services/auditLogService';
import { subscribeCategories } from '../services/categoryService';
import { saveCustomer, subscribeCustomers } from '../services/customersService';
import { subscribeProducts } from '../services/inventoryService';
import {
  applySpecialOrderPayment,
  saveSpecialOrder,
  saveSpecialOrderWithPayments,
  syncSpecialOrderPaymentArtifacts,
  subscribeSpecialOrderPayments,
  subscribeSpecialOrders
} from '../services/specialOrdersService';
import { buildPaymentEntry } from '../utils/paymentUtils';
import {
  buildSpecialOrderPaymentSale,
  buildSpecialOrderAuditEntry,
  buildSpecialOrderPaymentSaleId,
  canDeliverSpecialOrder,
  calculateSpecialOrderPaymentSummary,
  formatSpecialOrderNumber,
  getSpecialOrderStatusLabel,
  isSpecialOrderArchived,
  normalizeSpecialOrder,
  SPECIAL_ORDER_PAYMENT_KIND,
  SPECIAL_ORDER_STATUS
} from '../utils/specialOrderUtils';
import { calculateItemPricing, roundMoney } from '../utils/cartPricing';

const TAB_OPTIONS = [
  { id: 'all', label: 'Todos' },
  { id: 'pending', label: 'Pendientes' },
  { id: 'ready', label: 'Listos' },
  { id: 'delivered', label: 'Entregados' },
  { id: 'canceled', label: 'Cancelados' }
];

const getCurrentUserIdentity = (user, profile, fallbackUser) => ({
  name: profile?.name || user?.email || fallbackUser?.name || 'Sistema',
  id: user?.uid || fallbackUser?.id || 'system'
});

function SpecialOrders({ onCreateProductRequested = () => {} }) {
  const { user, profile } = useAuth();
  const [rawOrders, setRawOrders] = useState([]);
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [notification, setNotification] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTab, setSelectedTab] = useState('all');
  const [filterDate, setFilterDate] = useState('');
  const [showBalanceOnly, setShowBalanceOnly] = useState(false);
  const [showArchivedHistory, setShowArchivedHistory] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [detailOrder, setDetailOrder] = useState(null);
  const [paymentModalState, setPaymentModalState] = useState({ open: false, order: null, mode: 'payment' });
  const [cancellationOrder, setCancellationOrder] = useState(null);

  useEffect(() => {
    const data = loadData();
    setRawOrders(data.specialOrders || []);
    setPayments(data.specialOrderPayments || []);
    setCustomers(data.customers || []);
    setProducts(data.products || []);
    setCategories(data.categories || []);
    setAuditLogs(data.auditLogs || []);

    const unsubOrders = subscribeSpecialOrders(
      (rows) => {
        if (rows.length > 0) setRawOrders(rows);
      },
      (error) => console.error('Error subscribing special orders:', error)
    );
    const unsubPayments = subscribeSpecialOrderPayments(
      (rows) => {
        if (rows.length > 0) setPayments(rows);
      },
      (error) => console.error('Error subscribing special order payments:', error)
    );
    const unsubCustomers = subscribeCustomers(
      (rows) => {
        if (rows.length > 0) setCustomers(rows);
      },
      (error) => console.error('Error subscribing customers:', error)
    );
    const unsubProducts = subscribeProducts(
      (rows) => {
        if (rows.length > 0) setProducts(rows);
      },
      (error) => console.error('Error subscribing products in special orders:', error)
    );
    const unsubCategories = subscribeCategories(
      (rows) => {
        if (rows.length > 0) setCategories(rows.filter((entry) => entry.active !== false));
      },
      (error) => console.error('Error subscribing categories in special orders:', error)
    );

    return () => {
      unsubOrders();
      unsubPayments();
      unsubCustomers();
      unsubProducts();
      unsubCategories();
    };
  }, []);

  const hydratedOrders = useMemo(
    () => rawOrders.map((order) =>
      {
        const relatedPayments = payments.filter((payment) => payment.specialOrderId === order.id);
        return normalizeSpecialOrder({
          ...order,
          payments: relatedPayments.length > 0 ? relatedPayments : (order.payments || [])
        });
      }
    ),
    [rawOrders, payments]
  );

  const matchesOrderFilters = useCallback((order, includeArchived = false) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesQuery = !query || [
      order.orderNumber,
      order.customerName,
      order.customerPhone,
      ...order.items.map((item) => `${item.name} ${item.sku} ${item.description}`)
    ].join(' ').toLowerCase().includes(query);

    const matchesTab = (() => {
      switch (selectedTab) {
        case 'pending':
          return [SPECIAL_ORDER_STATUS.pending_order, SPECIAL_ORDER_STATUS.ordered, SPECIAL_ORDER_STATUS.waiting_arrival].includes(order.orderStatus);
        case 'ready':
          return order.orderStatus === SPECIAL_ORDER_STATUS.ready_for_pickup;
        case 'delivered':
          return order.orderStatus === SPECIAL_ORDER_STATUS.delivered;
        case 'canceled':
          return order.orderStatus === SPECIAL_ORDER_STATUS.canceled;
        default:
          return true;
      }
    })();

    const matchesDate = !filterDate || String(order.createdAt || '').startsWith(filterDate) || String(order.expectedDate || '').startsWith(filterDate);
    const matchesBalance = !showBalanceOnly || Number(order.balanceDue || 0) > 0;
    const archived = isSpecialOrderArchived(order);

    return matchesQuery && matchesTab && matchesDate && matchesBalance && (includeArchived ? archived : !archived);
  }, [filterDate, searchQuery, selectedTab, showBalanceOnly]);

  const filteredOrders = useMemo(
    () => hydratedOrders.filter((order) => matchesOrderFilters(order, false)),
    [hydratedOrders, matchesOrderFilters]
  );

  const archivedOrders = useMemo(
    () => hydratedOrders.filter((order) => matchesOrderFilters(order, true)),
    [hydratedOrders, matchesOrderFilters]
  );

  const metrics = useMemo(() => {
    const reportable = hydratedOrders.filter((order) => order.orderStatus !== SPECIAL_ORDER_STATUS.canceled);
    const deliveredOrders = hydratedOrders.filter((order) => order.orderStatus === SPECIAL_ORDER_STATUS.delivered);
    return {
      pendingCount: reportable.filter((order) => [
        SPECIAL_ORDER_STATUS.pending_order,
        SPECIAL_ORDER_STATUS.ordered,
        SPECIAL_ORDER_STATUS.waiting_arrival
      ].includes(order.orderStatus)).length,
      readyCount: reportable.filter((order) => order.orderStatus === SPECIAL_ORDER_STATUS.ready_for_pickup).length,
      deliveredCount: hydratedOrders.filter((order) => order.orderStatus === SPECIAL_ORDER_STATUS.delivered).length,
      canceledCount: hydratedOrders.filter((order) => order.orderStatus === SPECIAL_ORDER_STATUS.canceled).length,
      totalDeposits: reportable.reduce((sum, order) => sum + Number(order.depositAmount || 0), 0),
      totalPendingBalance: reportable.reduce((sum, order) => sum + Number(order.balanceDue || 0), 0),
      deliveredProfit: deliveredOrders.reduce(
        (sum, order) => sum + order.items.reduce(
          (itemSum, item) => itemSum + ((Number(item.unitPrice || 0) - Number(item.unitCost || 0)) * Number(item.quantity || 0)),
          0
        ),
        0
      )
    };
  }, [hydratedOrders]);

  const showNotification = (type, message) => {
    setNotification({ id: Date.now(), type, message });
  };

  const markOrderAsDelivered = (order) => {
    if (!canDeliverSpecialOrder(order)) {
      showNotification('error', 'No se puede entregar el pedido mientras tenga balance pendiente.');
      return;
    }
    commitStatusChange({
      order,
      nextStatus: SPECIAL_ORDER_STATUS.delivered,
      description: 'Pedido entregado al cliente.',
      patch: {
        deliveredAt: new Date().toISOString()
      }
    });
  };

  const undoDeliveredOrder = (order) => {
    commitStatusChange({
      order,
      nextStatus: SPECIAL_ORDER_STATUS.ready_for_pickup,
      description: 'Entrega revertida. Pedido marcado nuevamente como listo para recoger.',
      patch: {
        deliveredAt: ''
      }
    });
  };

  const updateLocalState = ({
    nextOrders,
    nextPayments,
    nextCustomers,
    nextAuditLogs,
    nextSales,
    nextRegisterPayments
  }) => {
    const current = loadData();
    const updated = {
      ...current,
      specialOrders: nextOrders ?? current.specialOrders ?? [],
      specialOrderPayments: nextPayments ?? current.specialOrderPayments ?? [],
      customers: nextCustomers ?? current.customers ?? [],
      auditLogs: nextAuditLogs ?? current.auditLogs ?? [],
      sales: nextSales ?? current.sales ?? [],
      payments: nextRegisterPayments ?? current.payments ?? []
    };
    saveData(updated);
    if (nextOrders) setRawOrders(nextOrders);
    if (nextPayments) setPayments(nextPayments);
    if (nextCustomers) setCustomers(nextCustomers);
    if (nextAuditLogs) setAuditLogs(nextAuditLogs);
  };

  const appendMirroredPaymentArtifacts = (currentData, order, payment) => {
    const nextRegisterPayments = [payment, ...(currentData.payments || []).filter((entry) => entry.id !== payment.id)];

    if (payment.kind === SPECIAL_ORDER_PAYMENT_KIND.refund) {
      return {
        nextSales: currentData.sales || [],
        nextRegisterPayments
      };
    }

    const mirroredSale = buildSpecialOrderPaymentSale({ order, payment });
    const nextSales = [mirroredSale, ...(currentData.sales || []).filter((sale) => sale.id !== mirroredSale.id)];

    return {
      nextSales,
      nextRegisterPayments
    };
  };

  useEffect(() => {
    if (hydratedOrders.length === 0 || payments.length === 0) return;

    const currentData = loadData();
    const currentSales = currentData.sales || [];
    const currentRegisterPayments = currentData.payments || [];
    const salesById = new Set(currentSales.map((sale) => sale.id));
    const missingMirrors = payments.filter((payment) => (
      payment.kind !== SPECIAL_ORDER_PAYMENT_KIND.refund &&
      !salesById.has(buildSpecialOrderPaymentSaleId(payment))
    ));

    if (missingMirrors.length === 0) {
      return;
    }

    const mirroredSales = [];
    const mirroredRegisterPayments = [...currentRegisterPayments];

    missingMirrors.forEach((payment) => {
      const order = hydratedOrders.find((entry) => entry.id === payment.specialOrderId);
      if (!order) return;

      const mirroredSale = buildSpecialOrderPaymentSale({ order, payment });
      mirroredSales.push(mirroredSale);

      if (!mirroredRegisterPayments.some((entry) => entry.id === payment.id)) {
        mirroredRegisterPayments.unshift(payment);
      }

      syncSpecialOrderPaymentArtifacts({ order, payment }).catch((error) => {
        console.error('Error syncing legacy special order payment to sales:', error);
      });
    });

    if (mirroredSales.length === 0) return;

    updateLocalState({
      nextSales: [...mirroredSales, ...currentSales.filter((sale) => !mirroredSales.some((entry) => entry.id === sale.id))],
      nextRegisterPayments: mirroredRegisterPayments
    });
  }, [hydratedOrders, payments]);

  const createOrReuseCustomer = async (customerPayload) => {
    const existing = customers.find((customer) =>
      customer.phone.trim() === customerPayload.customerPhone.trim() &&
      customer.name.trim().toLowerCase() === customerPayload.customerName.trim().toLowerCase()
    );

    if (existing) {
      const nextCustomer = {
        ...existing,
        name: customerPayload.customerName.trim(),
        phone: customerPayload.customerPhone.trim(),
        email: customerPayload.customerEmail.trim(),
        notes: customerPayload.customerNotes.trim(),
        updatedAt: new Date().toISOString()
      };
      await saveCustomer(nextCustomer);
      return nextCustomer;
    }

    const nextCustomer = {
      id: customerPayload.customerId || generateId('customer'),
      name: customerPayload.customerName.trim(),
      phone: customerPayload.customerPhone.trim(),
      email: customerPayload.customerEmail.trim(),
      notes: customerPayload.customerNotes.trim(),
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await saveCustomer(nextCustomer);
    return nextCustomer;
  };

  const handleCreateProduct = (productData) => {
    onCreateProductRequested({
      productTemplate: {
        sku: productData.sku || '',
        name: productData.name || '',
        barcode: productData.barcode || '',
        categoryId: productData.categoryId || categories?.[0]?.id || '',
        price: Number(productData.price || 0),
        cost: Number(productData.cost || 0),
        stock: Number(productData.stock || 0),
        lowStockThreshold: 0,
        description: productData.description || '',
        ivuStateEnabled: productData.ivuStateEnabled !== false,
        ivuMunicipalEnabled: productData.ivuMunicipalEnabled !== false
      }
    });
  };

  const handleCreateOrder = async ({ customer, items, depositAmount, depositMethod, expectedDate, internalNotes }) => {
    const currentUser = getCurrentUserIdentity(user, profile, loadData().currentUser);
    const specialOrderId = generateId('special_order');
    const orderNumber = formatSpecialOrderNumber();
    const normalizedItems = items.map((item) => ({
      ...item,
      id: item.id || generateId('special_order_item'),
      subtotal: calculateItemPricing(item).subtotal,
      taxableSubtotal: calculateItemPricing(item).taxableSubtotal,
      tax: calculateItemPricing(item).totalTax,
      taxBreakdown: {
        state: calculateItemPricing(item).stateTax,
        municipal: calculateItemPricing(item).municipalTax
      },
      total: calculateItemPricing(item).total
    }));
    const subtotalAmount = roundMoney(normalizedItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0));
    const taxBreakdown = {
      state: roundMoney(normalizedItems.reduce((sum, item) => sum + Number(item.taxBreakdown?.state || 0), 0)),
      municipal: roundMoney(normalizedItems.reduce((sum, item) => sum + Number(item.taxBreakdown?.municipal || 0), 0))
    };
    const taxAmount = roundMoney(taxBreakdown.state + taxBreakdown.municipal);
    const totalAmount = roundMoney(normalizedItems.reduce((sum, item) => sum + Number(item.total || 0), 0));

    try {
      const savedCustomer = await createOrReuseCustomer(customer);
      const depositPayment = depositAmount > 0
        ? {
            ...buildPaymentEntry({
              transactionId: specialOrderId,
              method: depositMethod || 'cash',
              amount: depositAmount,
              confirmedBy: currentUser.name,
              reference: `${orderNumber} - anticipo`
            }),
            specialOrderId,
            kind: SPECIAL_ORDER_PAYMENT_KIND.deposit,
            confirmedById: currentUser.id,
            createdAt: new Date().toISOString()
          }
        : null;

      const paymentSummary = calculateSpecialOrderPaymentSummary(depositPayment ? [depositPayment] : [], totalAmount);
      const newOrder = normalizeSpecialOrder({
        id: specialOrderId,
        orderNumber,
        customerId: savedCustomer.id,
        customerName: savedCustomer.name,
        customerPhone: savedCustomer.phone,
        customerEmail: savedCustomer.email,
        items: normalizedItems,
        subtotalAmount,
        taxAmount,
        taxBreakdown,
        totalAmount,
        depositAmount: paymentSummary.deposit,
        amountPaid: paymentSummary.netPaid,
        balanceDue: paymentSummary.balanceDue,
        orderStatus: SPECIAL_ORDER_STATUS.pending_order,
        paymentStatus: paymentSummary.paymentStatus,
        expectedDate,
        internalNotes,
        createdBy: currentUser.name,
        createdById: currentUser.id,
        updatedBy: currentUser.name,
        updatedById: currentUser.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        payments: depositPayment ? [depositPayment] : []
      });

      const auditEntries = [
        buildSpecialOrderAuditEntry({
          entityId: newOrder.id,
          action: 'special_order_created',
          description: `Pedido ${orderNumber} creado para ${savedCustomer.name}`,
          performedBy: currentUser.name,
          performedById: currentUser.id,
          metadata: {
            totalAmount: newOrder.totalAmount,
            depositAmount: depositAmount || 0
          }
        })
      ];

      if (depositPayment) {
        auditEntries.push(buildSpecialOrderAuditEntry({
          entityId: newOrder.id,
          action: 'deposit_registered',
          description: `Anticipo registrado por ${formatCurrency(depositPayment.amount)}`,
          performedBy: currentUser.name,
          performedById: currentUser.id,
          metadata: {
            paymentId: depositPayment.id,
            amount: depositPayment.amount
          }
        }));
      }

      const currentData = loadData();
      const nextCustomers = [savedCustomer, ...customers.filter((entry) => entry.id !== savedCustomer.id)];
      const nextOrders = [newOrder, ...rawOrders];
      const nextPayments = depositPayment ? [depositPayment, ...payments] : payments;
      const nextAuditLogs = [...auditEntries, ...auditLogs];
      const mirroredArtifacts = depositPayment
        ? appendMirroredPaymentArtifacts(currentData, newOrder, depositPayment)
        : {
            nextSales: currentData.sales || [],
            nextRegisterPayments: currentData.payments || []
          };

      updateLocalState({
        nextCustomers,
        nextOrders,
        nextPayments,
        nextAuditLogs,
        nextSales: mirroredArtifacts.nextSales,
        nextRegisterPayments: mirroredArtifacts.nextRegisterPayments
      });

      await saveSpecialOrderWithPayments({
        order: newOrder,
        payments: depositPayment ? [depositPayment] : [],
        auditLogs: auditEntries
      });

      showNotification('success', 'Pedido especial creado correctamente.');
      setShowCreateModal(false);
    } catch (error) {
      console.error('Error creating special order:', error);
      showNotification('error', 'No se pudo crear el pedido especial.');
    }
  };

  const handleUpdateOrder = async ({ customer, items, depositAmount, depositMethod, expectedDate, internalNotes }) => {
    if (!editingOrder) return;

    const currentUser = getCurrentUserIdentity(user, profile, loadData().currentUser);
    const savedCustomer = await createOrReuseCustomer(customer);
    const normalizedItems = items.map((item) => ({
      ...item,
      id: item.id || generateId('special_order_item'),
      subtotal: calculateItemPricing(item).subtotal,
      taxableSubtotal: calculateItemPricing(item).taxableSubtotal,
      tax: calculateItemPricing(item).totalTax,
      taxBreakdown: {
        state: calculateItemPricing(item).stateTax,
        municipal: calculateItemPricing(item).municipalTax
      },
      total: calculateItemPricing(item).total
    }));
    const subtotalAmount = roundMoney(normalizedItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0));
    const taxBreakdown = {
      state: roundMoney(normalizedItems.reduce((sum, item) => sum + Number(item.taxBreakdown?.state || 0), 0)),
      municipal: roundMoney(normalizedItems.reduce((sum, item) => sum + Number(item.taxBreakdown?.municipal || 0), 0))
    };
    const taxAmount = roundMoney(taxBreakdown.state + taxBreakdown.municipal);
    const totalAmount = roundMoney(normalizedItems.reduce((sum, item) => sum + Number(item.total || 0), 0));

    const paymentSummary = calculateSpecialOrderPaymentSummary(editingOrder.payments || [], totalAmount);
    const nextOrder = normalizeSpecialOrder({
      ...editingOrder,
      customerId: savedCustomer.id,
      customerName: savedCustomer.name,
      customerPhone: savedCustomer.phone,
      customerEmail: savedCustomer.email,
      items: normalizedItems,
      subtotalAmount,
      taxAmount,
      taxBreakdown,
      totalAmount,
      depositAmount: paymentSummary.deposit,
      amountPaid: paymentSummary.netPaid,
      balanceDue: paymentSummary.balanceDue,
      paymentStatus: paymentSummary.paymentStatus,
      expectedDate,
      internalNotes,
      updatedBy: currentUser.name,
      updatedById: currentUser.id,
      updatedAt: new Date().toISOString()
    });

    const auditEntry = buildSpecialOrderAuditEntry({
      entityId: editingOrder.id,
      action: 'special_order_updated',
      description: `Pedido ${editingOrder.orderNumber} actualizado`,
      performedBy: currentUser.name,
      performedById: currentUser.id,
      metadata: {
        totalAmount
      }
    });

    updateLocalState({
      nextOrders: rawOrders.map((entry) => entry.id === editingOrder.id ? nextOrder : entry),
      nextCustomers: [savedCustomer, ...customers.filter((entry) => entry.id !== savedCustomer.id)],
      nextAuditLogs: [auditEntry, ...auditLogs]
    });

    try {
      await saveSpecialOrder(nextOrder);
      await saveAuditLog(auditEntry);
      setEditingOrder(null);
      setDetailOrder(nextOrder);
      showNotification('success', 'Pedido actualizado correctamente.');
    } catch (error) {
      console.error('Error updating special order:', error);
      showNotification('error', 'No se pudo actualizar el pedido.');
    }
  };

  const commitStatusChange = async ({ order, nextStatus, description, patch = {} }) => {
    const currentUser = getCurrentUserIdentity(user, profile, loadData().currentUser);
    const nextOrder = normalizeSpecialOrder({
      ...order,
      ...patch,
      orderStatus: nextStatus,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.name,
      updatedById: currentUser.id
    });
    const auditEntry = buildSpecialOrderAuditEntry({
      entityId: order.id,
      action: 'status_changed',
      description,
      performedBy: currentUser.name,
      performedById: currentUser.id,
      metadata: {
        nextStatus
      }
    });

    updateLocalState({
      nextOrders: rawOrders.map((entry) => entry.id === order.id ? nextOrder : entry),
      nextAuditLogs: [auditEntry, ...auditLogs]
    });

    try {
      await saveSpecialOrder(nextOrder);
      await saveAuditLog(auditEntry);
      setDetailOrder(nextOrder);
      showNotification('success', `Pedido actualizado: ${getSpecialOrderStatusLabel(nextStatus)}.`);
    } catch (error) {
      console.error('Error updating special order status:', error);
      showNotification('error', 'No se pudo actualizar el pedido.');
    }
  };

  const handleRegisterPayment = async ({ amount, method, reference, notes }) => {
    const order = paymentModalState.order;
    if (!order) return;
    const currentUser = getCurrentUserIdentity(user, profile, loadData().currentUser);
    const payment = {
      ...buildPaymentEntry({
        transactionId: order.id,
        method,
        amount,
        confirmedBy: currentUser.name,
        reference
      }),
      specialOrderId: order.id,
      kind: paymentModalState.mode === 'refund' ? SPECIAL_ORDER_PAYMENT_KIND.refund : SPECIAL_ORDER_PAYMENT_KIND.payment,
      notes,
      confirmedById: currentUser.id,
      createdAt: new Date().toISOString()
    };

    if (paymentModalState.mode !== 'refund' && amount > Number(order.balanceDue || 0)) {
      showNotification('error', 'El pago no puede exceder el balance pendiente.');
      return;
    }
    if (paymentModalState.mode === 'refund' && amount > Number(order.amountPaid || 0)) {
      showNotification('error', 'El reembolso no puede exceder lo cobrado.');
      return;
    }

    const nextOrder = normalizeSpecialOrder({
      ...order,
      payments: [...(order.payments || []), payment]
    });
    const currentData = loadData();
    const nextRawOrders = rawOrders.map((entry) => entry.id === order.id ? nextOrder : entry);
    const nextPayments = [payment, ...payments];
    const auditEntry = buildSpecialOrderAuditEntry({
      entityId: order.id,
      action: paymentModalState.mode === 'refund' ? 'refund_registered' : 'payment_registered',
      description: paymentModalState.mode === 'refund'
        ? `Reembolso registrado por ${formatCurrency(amount)}`
        : `Pago registrado por ${formatCurrency(amount)}`,
      performedBy: currentUser.name,
      performedById: currentUser.id,
      metadata: {
        amount,
        method,
        paymentId: payment.id
      }
    });
    const nextAuditLogs = [auditEntry, ...auditLogs];
    const mirroredArtifacts = appendMirroredPaymentArtifacts(currentData, nextOrder, payment);

    updateLocalState({
      nextOrders: nextRawOrders,
      nextPayments,
      nextAuditLogs,
      nextSales: mirroredArtifacts.nextSales,
      nextRegisterPayments: mirroredArtifacts.nextRegisterPayments
    });

    try {
      const persistedOrder = await applySpecialOrderPayment({
        order,
        payment,
        performedBy: currentUser.name,
        performedById: currentUser.id,
        description: auditEntry.description
      });
      setDetailOrder(persistedOrder);
      showNotification('success', paymentModalState.mode === 'refund' ? 'Reembolso registrado.' : 'Pago registrado.');
    } catch (error) {
      console.error('Error applying special order payment:', error);
      showNotification('error', 'No se pudo registrar el movimiento.');
    }
  };

  const handleCancelOrder = async ({ reason, refundAmount }) => {
    const order = cancellationOrder;
    if (!order) return;
    const currentUser = getCurrentUserIdentity(user, profile, loadData().currentUser);

    let updatedOrder = normalizeSpecialOrder({
      ...order,
      orderStatus: SPECIAL_ORDER_STATUS.canceled,
      canceledAt: new Date().toISOString(),
      canceledReason: reason,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.name,
      updatedById: currentUser.id
    });
    const currentData = loadData();
    const nextPayments = [...payments];
    const nextAuditLogs = [...auditLogs];
    let nextSales = currentData.sales || [];
    let nextRegisterPayments = currentData.payments || [];

    if (refundAmount > 0) {
      const refundPayment = {
        ...buildPaymentEntry({
          transactionId: order.id,
          method: 'cash',
          amount: refundAmount,
          confirmedBy: currentUser.name,
          reference: `${order.orderNumber} - cancelación`
        }),
        specialOrderId: order.id,
        kind: SPECIAL_ORDER_PAYMENT_KIND.refund,
        confirmedById: currentUser.id,
        createdAt: new Date().toISOString()
      };
      updatedOrder = normalizeSpecialOrder({
        ...updatedOrder,
        payments: [...(order.payments || []), refundPayment]
      });
      nextPayments.unshift(refundPayment);
      const mirroredArtifacts = appendMirroredPaymentArtifacts(currentData, updatedOrder, refundPayment);
      nextSales = mirroredArtifacts.nextSales;
      nextRegisterPayments = mirroredArtifacts.nextRegisterPayments;
      nextAuditLogs.unshift(buildSpecialOrderAuditEntry({
        entityId: order.id,
        action: 'refund_registered',
        description: `Reembolso por cancelación de ${formatCurrency(refundAmount)}`,
        performedBy: currentUser.name,
        performedById: currentUser.id,
        metadata: {
          amount: refundAmount
        }
      }));
    }

    const cancellationAudit = buildSpecialOrderAuditEntry({
      entityId: order.id,
      action: 'special_order_canceled',
      description: `Pedido cancelado. Razón: ${reason}`,
      performedBy: currentUser.name,
      performedById: currentUser.id,
      metadata: {
        refundAmount
      }
    });
    nextAuditLogs.unshift(cancellationAudit);

    updateLocalState({
      nextOrders: rawOrders.map((entry) => entry.id === order.id ? updatedOrder : entry),
      nextPayments,
      nextAuditLogs,
      nextSales,
      nextRegisterPayments
    });

    try {
      await saveSpecialOrder(updatedOrder);
      if (refundAmount > 0) {
        await syncSpecialOrderPaymentArtifacts({
          order: updatedOrder,
          payment: nextPayments[0]
        });
      }
      await Promise.all(nextAuditLogs.slice(0, refundAmount > 0 ? 2 : 1).map((log) => saveAuditLog(log)));
      showNotification('success', 'Pedido cancelado correctamente.');
      setCancellationOrder(null);
      setDetailOrder(updatedOrder);
    } catch (error) {
      console.error('Error canceling special order:', error);
      showNotification('error', 'No se pudo cancelar el pedido.');
    }
  };

  const detailAuditLogs = useMemo(
    () => detailOrder ? auditLogs.filter((log) => log.entityId === detailOrder.id) : [],
    [auditLogs, detailOrder]
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

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pedidos especiales</h1>
          <p className="text-sm text-gray-500">Administra encargos, anticipos, balances pendientes y entregas.</p>
        </div>
        <button className="btn btn-primary flex items-center gap-2" onClick={() => setShowCreateModal(true)}>
          <Plus size={18} />
          Nuevo pedido
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Pendientes por llegar</p>
              <p className="text-3xl font-bold">{metrics.pendingCount}</p>
            </div>
            <ClipboardList className="text-amber-500" size={28} />
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Listos para recoger</p>
              <p className="text-3xl font-bold">{metrics.readyCount}</p>
            </div>
            <PackageCheck className="text-green-500" size={28} />
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Cobrado en anticipos</p>
              <p className="text-3xl font-bold">{formatCurrency(metrics.totalDeposits)}</p>
            </div>
            <DollarSign className="text-primary-500" size={28} />
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Pendiente por cobrar</p>
              <p className="text-3xl font-bold">{formatCurrency(metrics.totalPendingBalance)}</p>
            </div>
            <XCircle className="text-red-500" size={28} />
          </div>
        </div>
        <div className="card p-5 md:col-span-2 xl:col-span-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Ganancia de pedidos entregados</p>
              <p className="text-3xl font-bold">{formatCurrency(metrics.deliveredProfit || 0)}</p>
              <p className="text-sm text-indigo-600 mt-2">Utilidad calculada con costo y precio de venta</p>
            </div>
            <DollarSign className="text-indigo-500" size={28} />
          </div>
        </div>
      </div>

      <div className="card p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {TAB_OPTIONS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  selectedTab === tab.id
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                onClick={() => setSelectedTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-3 text-gray-400" />
              <input
                className="input pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por pedido, cliente o pieza"
              />
            </div>
            <input
              type="date"
              className="input"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={showBalanceOnly}
                onChange={(e) => setShowBalanceOnly(e.target.checked)}
              />
              Solo con balance pendiente
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowArchivedHistory((value) => !value)}
            >
              {showArchivedHistory ? 'Ocultar historial vendido' : `Ver historial vendido (${archivedOrders.length})`}
            </button>
          </div>
        </div>

        {filteredOrders.length > 0 ? (
          <SpecialOrdersTable
            orders={filteredOrders}
            onView={setDetailOrder}
            onRegisterPayment={(order) => setPaymentModalState({ open: true, order, mode: 'payment' })}
            onMarkReady={(order) => commitStatusChange({
              order,
              nextStatus: SPECIAL_ORDER_STATUS.ready_for_pickup,
              description: `Pedido marcado como listo para recoger.`,
              patch: {
                receivedAt: order.receivedAt || new Date().toISOString(),
                readyAt: new Date().toISOString()
              }
            })}
            onDeliver={markOrderAsDelivered}
            onUndoDelivered={undoDeliveredOrder}
            onCancel={setCancellationOrder}
          />
        ) : (
          <div className="py-16 text-center text-gray-400">
            <ClipboardList size={48} className="mx-auto mb-3" />
            <p>No hay pedidos para mostrar.</p>
          </div>
        )}
      </div>

      {showArchivedHistory && (
        <div className="card p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Historial oculto de ventas especiales</h2>
            <p className="text-sm text-gray-500">Aquí aparecen los pedidos especiales ya cobrados y entregados.</p>
          </div>

          {archivedOrders.length > 0 ? (
            <SpecialOrdersTable
              orders={archivedOrders}
              onView={setDetailOrder}
              onRegisterPayment={(order) => setPaymentModalState({ open: true, order, mode: 'payment' })}
              onMarkReady={(order) => commitStatusChange({
                order,
                nextStatus: SPECIAL_ORDER_STATUS.ready_for_pickup,
                description: `Pedido marcado como listo para recoger.`,
                patch: {
                  receivedAt: order.receivedAt || new Date().toISOString(),
                  readyAt: new Date().toISOString()
                }
              })}
              onDeliver={markOrderAsDelivered}
              onUndoDelivered={undoDeliveredOrder}
              onCancel={setCancellationOrder}
            />
          ) : (
            <div className="py-10 text-center text-gray-400">
              <ClipboardList size={40} className="mx-auto mb-3" />
              <p>No hay ventas especiales archivadas para este filtro.</p>
            </div>
          )}
        </div>
      )}

      <SpecialOrderForm
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateOrder}
        customers={customers}
        products={products}
        categories={categories}
        onCreateProduct={handleCreateProduct}
      />

      <SpecialOrderForm
        isOpen={Boolean(editingOrder)}
        onClose={() => setEditingOrder(null)}
        onSubmit={handleUpdateOrder}
        customers={customers}
        products={products}
        categories={categories}
        onCreateProduct={handleCreateProduct}
        initialData={editingOrder}
        title={editingOrder ? `Editar pedido ${editingOrder.orderNumber}` : 'Editar pedido'}
        submitLabel="Guardar cambios"
      />

      <SpecialOrderDetailModal
        isOpen={Boolean(detailOrder)}
        onClose={() => setDetailOrder(null)}
        order={detailOrder}
        auditLogs={detailAuditLogs}
        onRegisterPayment={(order) => setPaymentModalState({ open: true, order, mode: 'payment' })}
        onRegisterRefund={(order) => setPaymentModalState({ open: true, order, mode: 'refund' })}
        onEdit={(order) => {
          setDetailOrder(null);
          setEditingOrder(order);
        }}
        onMarkOrdered={(order) => commitStatusChange({
          order,
          nextStatus: SPECIAL_ORDER_STATUS.ordered,
          description: 'Pedido marcado como ordenado al suplidor.',
          patch: { orderedAt: new Date().toISOString() }
        })}
        onMarkWaiting={(order) => commitStatusChange({
          order,
          nextStatus: SPECIAL_ORDER_STATUS.waiting_arrival,
          description: 'Pedido marcado en espera de llegada.'
        })}
        onMarkReady={(order) => commitStatusChange({
          order,
          nextStatus: SPECIAL_ORDER_STATUS.ready_for_pickup,
          description: 'Pedido marcado como listo para recoger.',
          patch: {
            receivedAt: order.receivedAt || new Date().toISOString(),
            readyAt: new Date().toISOString()
          }
        })}
        onDeliver={markOrderAsDelivered}
        onUndoDelivered={undoDeliveredOrder}
        onCancel={setCancellationOrder}
      />

      <RegisterSpecialOrderPaymentModal
        isOpen={paymentModalState.open}
        onClose={() => setPaymentModalState({ open: false, order: null, mode: 'payment' })}
        onSubmit={handleRegisterPayment}
        order={paymentModalState.order}
        mode={paymentModalState.mode}
      />

      <SpecialOrderCancellationModal
        isOpen={Boolean(cancellationOrder)}
        onClose={() => setCancellationOrder(null)}
        onSubmit={handleCancelOrder}
        order={cancellationOrder}
      />
    </div>
  );
}

export default SpecialOrders;
