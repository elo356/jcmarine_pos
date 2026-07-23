import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Calendar, Eye, Filter, Printer, Receipt, RotateCcw } from 'lucide-react';
import Modal from '../components/Modal';
import Notification from '../components/Notification';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatQuantity,
  generateId,
  getProductBarcodes,
  loadData,
  normalizePrintSettings,
  saveData
} from '../data/demoData';
import { subscribeProducts } from '../services/inventoryService';
import { refundSale, registerSaleExchange, resetAllSaleExchangesSync, saveSale, subscribeSales } from '../services/salesService';
import { queuePendingExchange, queuePendingRefund, syncPendingQueue } from '../services/pendingSyncService';
import { subscribeSpecialOrders } from '../services/specialOrdersService';
import { syncWeeklySalesCache, upsertWeeklyCachedSale } from '../services/weeklySalesCacheService';
import { buildPaymentEntry, getPaymentMethodLabel, normalizePaymentMethod } from '../utils/paymentUtils';
import {
  getSaleItemFinancials,
  getSaleFinancialSummary,
  getNetSaleTotal,
  getSaleRefundTotal,
  getSaleRefunds,
  getSaleStatusLabel,
  isSpecialOrderPaymentSale,
  isPartiallyRefundedSale,
  isRefundedSale,
  normalizeSaleRefund,
  normalizeSaleStatus
} from '../utils/salesUtils';
import { buildSpecialOrderPaymentSale, getSpecialOrderFinancialSummary } from '../utils/specialOrderUtils';
import { useAuth } from '../contexts/AuthContext';
import { buildSalePrintHtml, buildSaleRefundPrintHtml, buildSpecialOrderPrintHtml } from '../utils/printTemplates';
import { printHtmlDocument } from '../services/printService';
import { calculateItemPricing, roundMoney } from '../utils/cartPricing';
import { buildInventoryLogEntry, INVENTORY_MOVEMENT_TYPES } from '../utils/inventoryLogUtils';

const DEFAULT_REFUND_FORM = {
  method: '',
  reason: '',
  notes: '',
  mode: 'items',
  itemQuantities: {}
};

const DEFAULT_EXCHANGE_FORM = {
  returnedItemKey: '',
  returnedQuantity: 1,
  replacementItems: [],
  settlementMethod: 'cash',
  settlementReference: '',
  notes: ''
};

const getSaleItemKey = (saleId, item = {}, index = 0) =>
  `${saleId}::${item.productId || item.sourceSpecialOrderItemId || item.id || 'item'}::${index}`;
const hasDetailedSaleItems = (sale = {}) =>
  (sale.items || []).some((item) => item.isSpecialOrderPayment !== true);
const canRefundSale = (sale = {}) =>
  !isRefundedSale(sale) && (!isSpecialOrderPaymentSale(sale) || hasDetailedSaleItems(sale));
const canExchangeSale = (sale = {}) =>
  !isSpecialOrderPaymentSale(sale) || hasDetailedSaleItems(sale);
const isLegacySpecialOrderPaymentSale = (sale = {}) =>
  isSpecialOrderPaymentSale(sale) &&
  (sale.items || []).length === 1 &&
  sale.items[0]?.isSpecialOrderPayment === true;
const getSaleSpecialOrderNumber = (sale = {}) => {
  if (sale.specialOrderNumber) return sale.specialOrderNumber;

  const searchableText = [
    sale.paymentReference,
    sale.reference,
    sale.items?.[0]?.name,
    sale.items?.[0]?.referenceOrderNumber,
    sale.payments?.[0]?.reference
  ].filter(Boolean).join(' ');
  const match = searchableText.match(/PE-\d{8}-[A-Z0-9]+/i);

  return match ? match[0].toUpperCase() : '';
};
const findSpecialOrderForSale = (sale = {}, specialOrders = []) => {
  const saleOrderNumber = getSaleSpecialOrderNumber(sale);

  return specialOrders.find((entry) => (
    entry.id === sale.specialOrderId ||
    entry.orderNumber === sale.specialOrderNumber ||
    (saleOrderNumber && String(entry.orderNumber || '').toUpperCase() === saleOrderNumber)
  ));
};
const hydrateSpecialOrderPaymentSales = (sales = [], specialOrders = []) =>
  sales.map((sale) => {
    if (!isLegacySpecialOrderPaymentSale(sale)) return sale;

    const order = findSpecialOrderForSale(sale, specialOrders);
    if (!order) return sale;

    const mirroredSale = buildSpecialOrderPaymentSale({
      order,
      payment: {
        ...(sale.payments?.[0] || {}),
        id: sale.specialOrderPaymentId || sale.payments?.[0]?.id || sale.id,
        saleId: sale.id,
        specialOrderId: order.id,
        kind: sale.specialOrderPaymentKind || 'payment',
        method: sale.paymentMethod || sale.payment_method || sale.payments?.[0]?.method,
        amount: sale.total || sale.payments?.[0]?.amount || 0,
        createdAt: sale.date || sale.created_at,
        confirmedBy: sale.cashier || sale.payments?.[0]?.confirmed_by || '',
        confirmedById: sale.cashierId || sale.payments?.[0]?.confirmed_by_id || ''
      }
    });

    return {
      ...sale,
      ...mirroredSale,
      refunds: sale.refunds || mirroredSale.refunds,
      exchanges: sale.exchanges || mirroredSale.exchanges,
      status: sale.status || mirroredSale.status,
      paymentStatus: sale.paymentStatus || mirroredSale.paymentStatus,
      refunded_at: sale.refunded_at || mirroredSale.refunded_at,
      refunded_by: sale.refunded_by || mirroredSale.refunded_by,
      refundedAmount: sale.refundedAmount || mirroredSale.refundedAmount
    };
  });
const persistHydratedLegacySpecialOrderSales = (sales = [], specialOrders = []) => {
  const hydratedSales = hydrateSpecialOrderPaymentSales(sales, specialOrders);
  const changed = hydratedSales.some((sale, index) => (
    isLegacySpecialOrderPaymentSale(sales[index]) &&
    !isLegacySpecialOrderPaymentSale(sale) &&
    (sale.items || []).some((item) => item.isSpecialOrderPayment !== true)
  ));

  return {
    hydratedSales,
    changed
  };
};

function Sales() {
  const { user, profile } = useAuth();
  const [sales, setSales] = useState([]);
  const [specialOrders, setSpecialOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [filterDate, setFilterDate] = useState('');
  const [filterMethod, setFilterMethod] = useState('');
  const [notification, setNotification] = useState(null);
  const [selectedSale, setSelectedSale] = useState(null);
  const [refundTarget, setRefundTarget] = useState(null);
  const [refundForm, setRefundForm] = useState(DEFAULT_REFUND_FORM);
  const [exchangeTarget, setExchangeTarget] = useState(null);
  const [exchangeForm, setExchangeForm] = useState(DEFAULT_EXCHANGE_FORM);
  const [exchangeReplacementSearch, setExchangeReplacementSearch] = useState('');
  const [, setIsResettingExchanges] = useState(false);

  useEffect(() => {
    const data = loadData();
    setSpecialOrders(data.specialOrders || []);
    const initialMigration = persistHydratedLegacySpecialOrderSales(data.sales || [], data.specialOrders || []);
    if (initialMigration.changed) {
      saveData({
        ...data,
        sales: initialMigration.hydratedSales
      });
    }
    setSales(initialMigration.hydratedSales);

    const unsubscribe = subscribeSales(
      (rows) => {
        const latestData = loadData();
        const migration = persistHydratedLegacySpecialOrderSales(rows || [], latestData.specialOrders || []);
        setSales(migration.hydratedSales);
      },
      (error) => {
        console.error('Error subscribing sales:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeSpecialOrders(
      (rows) => {
        setSpecialOrders(rows || []);
        setSales((currentSales) => {
          const { hydratedSales, changed } = persistHydratedLegacySpecialOrderSales(currentSales, rows || []);

          if (changed) {
            const data = loadData();
            saveData({
              ...data,
              sales: hydrateSpecialOrderPaymentSales(data.sales || [], rows || [])
            });
            hydratedSales
              .filter((sale, index) => !isLegacySpecialOrderPaymentSale(sale) && isLegacySpecialOrderPaymentSale(currentSales[index]))
              .forEach((sale) => {
                saveSale(sale).catch((error) => {
                  console.error('Error syncing migrated special order sale:', error);
                });
              });
          }

          return hydratedSales;
        });
      },
      (error) => {
        console.error('Error subscribing special orders in sales:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const data = loadData();
    setProducts((data.products || []).filter((product) => product.active !== false));

    const unsubscribe = subscribeProducts(
      (rows) => setProducts((rows || []).filter((product) => product.active !== false)),
      (error) => {
        console.error('Error subscribing products for exchanges:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  const showNotification = (type, message) => {
    setNotification({ id: Date.now(), type, message });
  };
  const getFirestoreSyncErrorMessage = (error, actionLabel = 'sincronizar') => {
    const errorCode = String(error?.code || '').replace(/^firestore\//, '');
    if (errorCode === 'permission-denied') {
      return `El cambio se guardo localmente, pero Firestore no dio permiso para ${actionLabel} la venta original. Revisa las reglas de Firestore para updates en sales/payments/products.`;
    }
    return `El cambio se guardo localmente, pero fallo la sincronizacion${error?.message ? `: ${error.message}` : '.'}`;
  };

  const filteredSales = useMemo(() => sales.filter((sale) => {
    if (filterDate && !sale.date.startsWith(filterDate)) return false;
    if (filterMethod && normalizePaymentMethod(sale.paymentMethod) !== filterMethod) return false;
    return true;
  }), [filterDate, filterMethod, sales]);
  const selectedSaleSummary = useMemo(
    () => (selectedSale ? getSaleFinancialSummary(selectedSale) : null),
    [selectedSale]
  );
  const selectedSaleSpecialOrder = useMemo(
    () => (selectedSale && isSpecialOrderPaymentSale(selectedSale)
      ? findSpecialOrderForSale(selectedSale, specialOrders)
      : null),
    [selectedSale, specialOrders]
  );
  const refundItemOptions = useMemo(() => {
    if (!refundTarget) return [];
    // If this is a legacy special-order payment sale, prefer original order item pricing
    if (isLegacySpecialOrderPaymentSale(refundTarget)) {
      const order = findSpecialOrderForSale(refundTarget, specialOrders);
      if (order) {
        const orderSummary = getSpecialOrderFinancialSummary(order);
        const orderItems = orderSummary.items || [];
        return orderItems
          .map((orderItem) => {
            // find corresponding mirrored sale item by sourceSpecialOrderItemId
            const mirroredIndex = (refundTarget.items || []).findIndex((si) => String(si.sourceSpecialOrderItemId) === String(orderItem.id));
            const mirroredItem = mirroredIndex >= 0 ? (refundTarget.items || [])[mirroredIndex] : null;
            const saleItemKey = mirroredItem ? getSaleItemKey(refundTarget.id, mirroredItem, mirroredIndex) : getSaleItemKey(refundTarget.id, { sourceSpecialOrderItemId: orderItem.id }, 0);

            const refundedCount = getSaleRefunds(refundTarget).reduce((sum, refund) => (
              sum + (refund.items || []).reduce((itemSum, refundedItem) => (
                refundedItem.saleItemKey === saleItemKey
                  ? itemSum + Number(refundedItem.quantity || 0)
                  : itemSum
              ), 0)
            ), 0);

            const quantity = Math.max(0, Number(orderItem.quantity || 0));
            const availableToRefund = Math.max(0, quantity - refundedCount);
            const unitAmount = quantity > 0 ? roundMoney(orderItem.total / quantity) : 0;

            return availableToRefund > 0 ? {
              saleItemKey,
              index: mirroredIndex >= 0 ? mirroredIndex : 0,
              item: mirroredItem || { id: orderItem.id, name: orderItem.name },
              availableToRefund,
              unitAmount
            } : null;
          })
          .filter(Boolean);
      }
    }

    return (refundTarget.items || [])
      .map((item, index) => {
        if (item.isSpecialOrderPayment === true) return null;

        const saleItemKey = getSaleItemKey(refundTarget.id, item, index);
        const refundedCount = getSaleRefunds(refundTarget).reduce((sum, refund) => (
          sum + (refund.items || []).reduce((itemSum, refundedItem) => (
            refundedItem.saleItemKey === saleItemKey
              ? itemSum + Number(refundedItem.quantity || 0)
              : itemSum
          ), 0)
        ), 0);
        const quantity = Math.max(0, Number(item.quantity || 0));
        const availableToRefund = Math.max(0, quantity - refundedCount);
        const financials = getSaleItemFinancials(item);
        const unitAmount = quantity > 0 ? roundMoney(financials.total / quantity) : 0;

        return {
          saleItemKey,
          index,
          item,
          availableToRefund,
          unitAmount
        };
      })
      .filter((entry) => entry && entry.availableToRefund > 0);
  }, [refundTarget, specialOrders]);
  const selectedRefundItems = useMemo(() => refundItemOptions
    .map((option) => {
      const requestedQuantity = Number(refundForm.itemQuantities?.[option.saleItemKey] || 0);
      const quantity = Math.min(Math.max(0, requestedQuantity), Number(option.availableToRefund || 0));

      return quantity > 0 ? { ...option, quantity, amount: roundMoney(quantity * option.unitAmount) } : null;
    })
    .filter(Boolean), [refundForm.itemQuantities, refundItemOptions]);
  const selectedRefundItemsAmount = useMemo(
    () => roundMoney(selectedRefundItems.reduce((sum, item) => sum + item.amount, 0)),
    [selectedRefundItems]
  );
  const exchangeReturnedOptions = useMemo(() => {
    if (!exchangeTarget) return [];

    return (exchangeTarget.items || []).map((item, index) => {
      const saleItemKey = getSaleItemKey(exchangeTarget.id, item, index);
      const exchangedCount = (exchangeTarget.exchanges || []).reduce((sum, exchange) => (
        exchange.returnedItem?.saleItemKey === saleItemKey
          ? sum + Number(exchange.returnedItem?.quantity || 0)
          : sum
      ), 0);
      const availableToExchange = Math.max(0, Number(item.quantity || 0) - exchangedCount);
      const financials = getSaleItemFinancials(item);
      const unitTotal = Number(item.quantity || 0) > 0
        ? roundMoney(financials.total / Number(item.quantity || 1))
        : 0;

      return {
        saleItemKey,
        index,
        item,
        availableToExchange,
        unitTotal
      };
    }).filter((entry) => entry.availableToExchange > 0);
  }, [exchangeTarget]);
  const selectedReturnedOption = useMemo(
    () => exchangeReturnedOptions.find((entry) => entry.saleItemKey === exchangeForm.returnedItemKey) || null,
    [exchangeForm.returnedItemKey, exchangeReturnedOptions]
  );
  const replacementItems = useMemo(() => exchangeForm.replacementItems
    .map((item) => ({ ...item, product: products.find((product) => product.id === item.productId) || null }))
    .filter((item) => item.product), [exchangeForm.replacementItems, products]);
  // Alias used only by the legacy single-item controls below while old exchange data is displayed.
  const replacementProduct = replacementItems[0]?.product || null;
  const replacementSize = exchangeForm.replacementSize || '';
  const filteredReplacementProducts = useMemo(() => {
    const query = exchangeReplacementSearch.trim().toLowerCase();
    if (!query) return products;

    return products.filter((product) => {
      const searchableText = [
        product.name,
        product.sku,
        product.category,
        product.categoryId,
        product.brand,
        product.location,
        ...getProductBarcodes(product)
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [exchangeReplacementSearch, products]);
  const replacementSizeOptions = (product) => {
    if (!product?.useSizeSelection) return [];
    if (Array.isArray(product.sizeStocks) && product.sizeStocks.length > 0) {
      return product.sizeStocks.map((entry) => entry.size).filter(Boolean);
    }
    return Array.isArray(product.availableSizes) ? product.availableSizes.filter(Boolean) : [];
  };
  const replacementPricings = useMemo(() => replacementItems.map((item) => ({
    ...item,
    quantity: Math.max(1, Number(item.quantity) || 1),
    pricing: calculateItemPricing({
      quantity: Math.max(1, Number(item.quantity) || 1),
      price: Number(item.product.price || 0),
      ivuStateEnabled: item.product.ivuStateEnabled !== false,
      ivuMunicipalEnabled: item.product.ivuMunicipalEnabled !== false
    })
  })), [replacementItems]);
  const replacementPricing = replacementPricings[0]?.pricing || null;
  const exchangeReturnedQuantity = useMemo(() => Math.min(
    Math.max(1, Number(exchangeForm.returnedQuantity) || 1),
    Number(selectedReturnedOption?.availableToExchange || 0)
  ), [exchangeForm.returnedQuantity, selectedReturnedOption]);
  const exchangeDifference = useMemo(() => {
    const replacementTotal = replacementPricings.reduce((sum, item) => sum + item.pricing.total, 0);
    return roundMoney(replacementTotal - ((selectedReturnedOption?.unitTotal || 0) * exchangeReturnedQuantity));
  }, [exchangeReturnedQuantity, replacementPricings, selectedReturnedOption]);
  useEffect(() => {
    if (!exchangeTarget) {
      setExchangeReplacementSearch('');
    }
  }, [exchangeTarget]);

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
    const specialOrder = isSpecialOrderPaymentSale(sale)
      ? findSpecialOrderForSale(sale, specialOrders)
      : null;

    try {
      await printHtmlDocument({
        title: `Recibo ${sale.id}`,
        html: specialOrder
          ? buildSpecialOrderPrintHtml({
              order: specialOrder,
              printerName: printer?.name || ''
            })
          : buildSalePrintHtml({
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
    setRefundTarget(sale);
    setRefundForm({
      method: normalizePaymentMethod(sale.paymentMethod) || 'cash',
      reason: '',
      notes: '',
      mode: 'items',
      itemQuantities: {}
    });
  };

  const openExchangeModal = (sale) => {
    const availableOptions = (sale.items || []).map((item, index) => {
      const saleItemKey = getSaleItemKey(sale.id, item, index);
      const exchangedCount = (sale.exchanges || []).reduce((sum, exchange) => (
        exchange.returnedItem?.saleItemKey === saleItemKey
          ? sum + Number(exchange.returnedItem?.quantity || 0)
          : sum
      ), 0);
      return Math.max(0, Number(item.quantity || 0) - exchangedCount) > 0 ? saleItemKey : null;
    }).filter(Boolean);

    setExchangeTarget(sale);
    setExchangeForm({
      ...DEFAULT_EXCHANGE_FORM,
      returnedItemKey: availableOptions[0] || '',
      settlementMethod: normalizePaymentMethod(sale.paymentMethod) || 'cash'
    });
  };

  const getProductStockForExchange = (product, selectedSize = '') => {
    if (!product) return 0;
    if (!selectedSize) return Number(product.stock || 0);
    const sizeEntry = (product.sizeStocks || []).find((entry) => entry.size === selectedSize);
    return Number(sizeEntry?.stock || 0);
  };

  const applyLocalStockChange = (product, selectedSize = '', quantityDelta = 0) => {
    const nextProduct = {
      ...product,
      stock: Math.max(0, Number(product.stock || 0) + quantityDelta)
    };

    if (Array.isArray(product.sizeStocks) && product.sizeStocks.length > 0 && selectedSize) {
      nextProduct.sizeStocks = product.sizeStocks.map((entry) => (
        entry.size === selectedSize
          ? { ...entry, stock: Math.max(0, Number(entry.stock || 0) + quantityDelta) }
          : entry
      ));
    }

    return nextProduct;
  };

  // eslint-disable-next-line no-unused-vars
  const handleResetAllExchanges = async () => {
    if (profile?.role !== 'admin') {
      showNotification('error', 'Solo un admin puede borrar todos los cambios de pieza.');
      return;
    }

    const currentData = loadData();
    const currentSales = currentData.sales || [];
    const currentProducts = currentData.products || [];
    const currentPayments = currentData.payments || [];
    const exchangeSales = currentSales.filter((sale) => Array.isArray(sale.exchanges) && sale.exchanges.length > 0);
    const adjustmentSales = currentSales.filter((sale) => sale.saleType === 'exchange_adjustment');
    const exchangeCount = exchangeSales.reduce((sum, sale) => sum + sale.exchanges.length, 0);

    if (exchangeCount === 0 && adjustmentSales.length === 0) {
      showNotification('info', 'No hay cambios de pieza registrados para borrar.');
      return;
    }

    const firstConfirmation = window.confirm(
      `Esto borrara ${exchangeCount} cambio(s) de pieza, ${adjustmentSales.length} venta(s) de ajuste y restaurara inventario.`
    );
    if (!firstConfirmation) return;

    const secondConfirmation = window.confirm(
      'Confirmacion final: este reseteo es global y temporal. Se intentara borrar todos los cambios en ventas, pagos e inventario. ¿Continuar?'
    );
    if (!secondConfirmation) return;

    setIsResettingExchanges(true);

    try {
      const nextProductsMap = new Map(currentProducts.map((product) => [product.id, { ...product }]));

      exchangeSales.forEach((sale) => {
        (sale.exchanges || []).forEach((exchange) => {
          const returnedProductId = exchange.returnedItem?.productId;
          const replacementItems = exchange.replacementItems || (exchange.replacementItem ? [exchange.replacementItem] : []);

          if (returnedProductId && nextProductsMap.has(returnedProductId)) {
            nextProductsMap.set(
              returnedProductId,
              applyLocalStockChange(
                nextProductsMap.get(returnedProductId),
                exchange.returnedItem?.selectedSize || '',
                -Number(exchange.returnedItem?.quantity || 1)
              )
            );
          }

          replacementItems.forEach((replacementItem) => {
            if (!replacementItem?.productId || !nextProductsMap.has(replacementItem.productId)) return;
            nextProductsMap.set(replacementItem.productId, applyLocalStockChange(
              nextProductsMap.get(replacementItem.productId),
              replacementItem.selectedSize || '',
              Number(replacementItem.quantity || 1)
            ));
          });
        });
      });

      const nextSales = currentSales
        .filter((sale) => sale.saleType !== 'exchange_adjustment')
        .map((sale) => {
          const exchanges = Array.isArray(sale.exchanges) ? sale.exchanges : [];
          if (exchanges.length === 0) return sale;

          const refundIdsToRemove = new Set(
            exchanges.map((exchange) => exchange.refundId).filter(Boolean)
          );
          const remainingRefunds = getSaleRefunds(sale).filter((refund) => !refundIdsToRemove.has(refund.id));
          const nextStatus = normalizeSaleStatus(sale.status, { ...sale, refunds: remainingRefunds });

          return {
            ...sale,
            exchanges: [],
            refunds: remainingRefunds,
            status: nextStatus,
            paymentStatus: nextStatus,
            refunded_at: remainingRefunds[remainingRefunds.length - 1]?.refundedAt || '',
            refunded_by: remainingRefunds[remainingRefunds.length - 1]?.refundedBy || '',
            refundedAmount: getSaleRefundTotal({ ...sale, refunds: remainingRefunds })
          };
        });

      const adjustmentSaleIds = new Set(adjustmentSales.map((sale) => sale.id).filter(Boolean));
      const nextPayments = currentPayments.filter((payment) => !adjustmentSaleIds.has(payment.transaction_id));
      const nextProducts = [...nextProductsMap.values()];

      saveData({
        ...currentData,
        sales: nextSales,
        payments: nextPayments,
        products: nextProducts
      });

      syncWeeklySalesCache(nextSales);
      setSales(nextSales);
      setProducts(nextProducts.filter((product) => product.active !== false));
      setSelectedSale((current) => current ? nextSales.find((sale) => sale.id === current.id) || null : null);
      setRefundTarget(null);
      setRefundForm(DEFAULT_REFUND_FORM);
      setExchangeTarget(null);
      setExchangeForm(DEFAULT_EXCHANGE_FORM);
      setExchangeReplacementSearch('');

      try {
        await resetAllSaleExchangesSync({
          salesToUpsert: nextSales.filter((sale) => Array.isArray(sale.exchanges) || Array.isArray(sale.refunds)),
          saleIdsToDelete: [...adjustmentSaleIds],
          paymentIdsToDelete: currentPayments
            .filter((payment) => adjustmentSaleIds.has(payment.transaction_id))
            .map((payment) => payment.id)
            .filter(Boolean),
          productsToUpsert: nextProducts
        });
        showNotification('success', 'Todos los cambios de pieza fueron borrados y el inventario fue restaurado.');
      } catch (error) {
        console.error('Error resetting all sale exchanges:', error);
        showNotification('warning', getFirestoreSyncErrorMessage(error, 'borrar'));
      }
    } finally {
      setIsResettingExchanges(false);
    }
  };

  const handleRefund = async () => {
    if (!refundTarget) return;

    const maxRefund = Math.max(0, Number(refundTarget.total || 0) - getSaleRefundTotal(refundTarget));
    const isFullRefund = refundForm.mode === 'total';
    const refundEntries = isFullRefund
      ? refundItemOptions.map((item) => ({
        ...item,
        quantity: Number(item.availableToRefund || 0),
        amount: roundMoney(Number(item.availableToRefund || 0) * Number(item.unitAmount || 0))
      })).filter((item) => item.quantity > 0)
      : selectedRefundItems;
    const refundAmount = isFullRefund
      ? maxRefund
      : roundMoney(refundEntries.reduce((sum, item) => sum + item.amount, 0));

    if (refundAmount <= 0) {
      showNotification('error', isFullRefund
        ? 'No queda balance disponible para reembolsar.'
        : 'Selecciona al menos un artículo y su cantidad.');
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
      items: refundEntries.map((entry) => ({
        saleItemKey: entry.saleItemKey,
        productId: entry.item.productId || entry.item.sourceSpecialOrderItemId || '',
        name: entry.item.name,
        selectedSize: entry.item.selectedSize || '',
        quantity: entry.quantity,
        unitAmount: entry.unitAmount,
        amount: entry.amount
      })),
      refundedBy: profile?.name || user?.email || 'Sistema',
      refundedAt: new Date().toISOString()
    });

    const data = loadData();
    const targetSale = hydrateSpecialOrderPaymentSales(
      data.sales || [],
      specialOrders.length > 0 ? specialOrders : (data.specialOrders || [])
    )
      .find((sale) => sale.id === refundTarget.id) || refundTarget;

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
      showNotification('success', refundAmount >= maxRefund
        ? 'Venta reembolsada completamente.'
        : 'Reembolso parcial registrado.');
      await handlePrintRefundReceipt(persistedSale, refundRecord);
    } catch (error) {
      console.error('Error refunding sale:', error);
      queuePendingRefund({ sale: targetSale, refundRecord });
      syncPendingQueue().catch((syncError) => {
        console.error('Error retrying pending sync queue:', syncError);
      });
      setRefundTarget(null);
      setRefundForm(DEFAULT_REFUND_FORM);
      showNotification(
        'warning',
        'Reembolso guardado. No se pudo confirmar con el servidor todavia; se reintentara sincronizar el inventario automaticamente.'
      );
    }
  };

  const handleExchange = async () => {
    if (!exchangeTarget) return;

    const returnedOption = selectedReturnedOption;
    if (!returnedOption) {
      showNotification('error', 'Selecciona la pieza que el cliente va a devolver.');
      return;
    }

    if (replacementItems.length === 0) {
      showNotification('error', 'Agrega al menos una pieza nueva para el cambio.');
      return;
    }

    const returnedQuantity = Math.max(1, Math.floor(Number(exchangeForm.returnedQuantity) || 0));
    if (returnedQuantity > Number(returnedOption.availableToExchange || 0)) {
      showNotification('error', `Solo puedes recibir hasta ${returnedOption.availableToExchange} pieza(s) de esa venta.`);
      return;
    }

    const requestedReplacementItems = replacementItems.map((item) => ({
      ...item,
      quantity: Math.max(1, Math.floor(Number(item.quantity) || 0))
    }));
    for (const item of requestedReplacementItems) {
      if (item.product.useSizeSelection && !item.selectedSize) {
        showNotification('error', `Selecciona la talla o size de ${item.product.name}.`);
        return;
      }
    }

    const currentData = loadData();
    const originalSale = (currentData.sales || []).find((sale) => sale.id === exchangeTarget.id);
    if (!originalSale) {
      showNotification('error', 'No se encontro la venta original.');
      return;
    }

    const originalSaleItem = originalSale.items?.[returnedOption.index];
    if (!originalSaleItem) {
      showNotification('error', 'No se encontro la pieza devuelta dentro de la venta.');
      return;
    }

    if (!originalSaleItem.productId) {
      showNotification('error', 'La pieza devuelta no tiene producto de inventario asociado.');
      return;
    }

    const currentExchangedCount = (originalSale.exchanges || []).reduce((sum, exchange) => (
      exchange.returnedItem?.saleItemKey === returnedOption.saleItemKey
        ? sum + Number(exchange.returnedItem?.quantity || 0)
        : sum
    ), 0);

    const availableToExchange = Math.max(0, Number(originalSaleItem.quantity || 0) - currentExchangedCount);
    if (returnedQuantity > availableToExchange) {
      showNotification('error', `Solo quedan ${availableToExchange} pieza(s) de esa venta disponibles para cambio.`);
      return;
    }

    const requestedByInventorySlot = requestedReplacementItems.reduce((map, item) => {
      const key = `${item.productId}::${item.selectedSize || ''}`;
      map.set(key, (map.get(key) || 0) + item.quantity);
      return map;
    }, new Map());
    for (const item of requestedReplacementItems) {
      const liveProduct = (currentData.products || []).find((product) => product.id === item.productId);
      const requested = requestedByInventorySlot.get(`${item.productId}::${item.selectedSize || ''}`);
      if (!liveProduct || getProductStockForExchange(liveProduct, item.selectedSize) < requested) {
        showNotification('error', `No hay stock suficiente para entregar ${item.product.name}.`);
        return;
      }
    }

    const returnedFinancials = getSaleItemFinancials(originalSaleItem);
    const returnedUnitQuantity = Number(originalSaleItem.quantity || 1);
    const returnedUnitSubtotal = roundMoney(returnedFinancials.subtotal / returnedUnitQuantity);
    const returnedUnitDiscount = roundMoney(returnedFinancials.discountAmount / returnedUnitQuantity);
    const returnedUnitTaxableSubtotal = roundMoney(returnedFinancials.taxableSubtotal / returnedUnitQuantity);
    const returnedUnitStateTax = roundMoney(returnedFinancials.taxBreakdown.state / returnedUnitQuantity);
    const returnedUnitMunicipalTax = roundMoney(returnedFinancials.taxBreakdown.municipal / returnedUnitQuantity);
    const returnedUnitTotal = roundMoney(returnedFinancials.total / returnedUnitQuantity);
    const returnedSubtotal = roundMoney(returnedUnitSubtotal * returnedQuantity);
    const returnedDiscount = roundMoney(returnedUnitDiscount * returnedQuantity);
    const returnedTaxableSubtotal = roundMoney(returnedUnitTaxableSubtotal * returnedQuantity);
    const returnedStateTax = roundMoney(returnedUnitStateTax * returnedQuantity);
    const returnedMunicipalTax = roundMoney(returnedUnitMunicipalTax * returnedQuantity);
    const returnedTotal = roundMoney(returnedUnitTotal * returnedQuantity);
    const liveReplacementItems = requestedReplacementItems.map((item) => {
      const product = (currentData.products || []).find((entry) => entry.id === item.productId);
      const pricing = calculateItemPricing({ quantity: item.quantity, price: Number(product.price || 0), ivuStateEnabled: product.ivuStateEnabled !== false, ivuMunicipalEnabled: product.ivuMunicipalEnabled !== false });
      return { ...item, product, pricing };
    });
    const replacementTotals = liveReplacementItems.reduce((totals, item) => ({
      subtotal: roundMoney(totals.subtotal + item.pricing.subtotal),
      discountAmount: roundMoney(totals.discountAmount + item.pricing.discountAmount),
      taxableSubtotal: roundMoney(totals.taxableSubtotal + item.pricing.taxableSubtotal),
      stateTax: roundMoney(totals.stateTax + item.pricing.stateTax),
      municipalTax: roundMoney(totals.municipalTax + item.pricing.municipalTax),
      totalTax: roundMoney(totals.totalTax + item.pricing.totalTax),
      total: roundMoney(totals.total + item.pricing.total)
    }), { subtotal: 0, discountAmount: 0, taxableSubtotal: 0, stateTax: 0, municipalTax: 0, totalTax: 0, total: 0 });
    const differenceAmount = roundMoney(replacementTotals.total - returnedTotal);
    const exchangedAt = new Date().toISOString();
    const exchangeId = generateId('exchange');
    const refundRecord = differenceAmount < 0 ? normalizeSaleRefund({
      amount: Math.abs(differenceAmount),
      method: exchangeForm.settlementMethod || 'cash',
      reason: `Cambio de pieza en venta ${originalSale.id}`,
      notes: exchangeForm.notes,
      refundedBy: profile?.name || user?.email || 'Sistema',
      refundedAt: exchangedAt
    }) : null;

    const adjustmentSaleId = differenceAmount > 0 ? generateId('sale_exchange') : '';
    const adjustmentSale = differenceAmount > 0 ? {
      id: adjustmentSaleId,
      transaction_id: adjustmentSaleId,
      date: exchangedAt,
      created_at: exchangedAt,
      saleType: 'exchange_adjustment',
      sourceSaleId: originalSale.id,
      exchangeId,
      items: [
        {
          productId: '',
          name: `Diferencia por cambio - ${liveReplacementItems.map((item) => item.product.name).join(', ')}`,
          quantity: 1,
          price: roundMoney(replacementTotals.taxableSubtotal - returnedTaxableSubtotal),
          subtotal: roundMoney(replacementTotals.subtotal - returnedSubtotal),
          discountType: 'fixed',
          discountValue: roundMoney(Math.max(0, replacementTotals.discountAmount - returnedDiscount)),
          discountAmount: roundMoney(Math.max(0, replacementTotals.discountAmount - returnedDiscount)),
          taxableSubtotal: roundMoney(replacementTotals.taxableSubtotal - returnedTaxableSubtotal),
          ivuStateEnabled: true,
          ivuMunicipalEnabled: true,
          nonInventory: true
        }
      ],
      subtotal: roundMoney(replacementTotals.subtotal - returnedSubtotal),
      discount: roundMoney(Math.max(0, replacementTotals.discountAmount - returnedDiscount)),
      tax: roundMoney(replacementTotals.totalTax - (returnedStateTax + returnedMunicipalTax)),
      taxBreakdown: {
        state: roundMoney(replacementTotals.stateTax - returnedStateTax),
        municipal: roundMoney(replacementTotals.municipalTax - returnedMunicipalTax)
      },
      total: differenceAmount,
      status: 'paid',
      paymentStatus: 'paid',
      paymentMethod: exchangeForm.settlementMethod || 'cash',
      payment_method: exchangeForm.settlementMethod || 'cash',
      cashier: originalSale.cashier,
      cashierId: originalSale.cashierId || null,
      chargedBy: profile?.name || user?.email || 'Sistema',
      chargedById: user?.uid || null,
      chargedByRole: profile?.role || null
    } : null;

    const adjustmentPayments = adjustmentSale ? [
      buildPaymentEntry({
        transactionId: adjustmentSale.id,
        method: exchangeForm.settlementMethod || 'cash',
        amount: differenceAmount,
        confirmedBy: profile?.name || user?.email || 'Sistema',
        reference: exchangeForm.settlementReference || ''
      })
    ] : [];

    if (adjustmentSale) {
      adjustmentSale.transaction_id = adjustmentSale.id;
      adjustmentSale.payments = adjustmentPayments;
    }

    const exchangeRecord = {
      id: exchangeId,
      originalSaleId: originalSale.id,
      exchangedAt,
      exchangedBy: profile?.name || user?.email || 'Sistema',
      notes: exchangeForm.notes || '',
      settlementMethod: differenceAmount === 0 ? '' : (exchangeForm.settlementMethod || 'cash'),
      settlementReference: exchangeForm.settlementReference || '',
      differenceAmount,
      settlementType: differenceAmount > 0 ? 'collect' : differenceAmount < 0 ? 'refund' : 'even',
      refundId: refundRecord?.id || '',
      adjustmentSaleId: adjustmentSale?.id || '',
      returnedItem: {
        saleItemKey: returnedOption.saleItemKey,
        quantity: returnedQuantity,
        productId: originalSaleItem.productId || '',
        name: originalSaleItem.name,
        selectedSize: originalSaleItem.selectedSize || '',
        unitPrice: roundMoney(Number(originalSaleItem.price || 0)),
        unitTotal: returnedUnitTotal,
        total: returnedTotal
      },
      replacementItems: liveReplacementItems.map((item) => ({
        quantity: item.quantity,
        productId: item.product.id,
        name: item.product.name,
        selectedSize: item.selectedSize || '',
        unitPrice: roundMoney(Number(item.product.price || 0)),
        unitTotal: roundMoney(item.pricing.total / item.quantity),
        total: item.pricing.total
      })),
      // Se conserva para que los cambios anteriores y los reportes existentes sigan funcionando.
      replacementItem: liveReplacementItems.length === 1 ? {
        quantity: liveReplacementItems[0].quantity,
        productId: liveReplacementItems[0].product.id,
        name: liveReplacementItems[0].product.name,
        selectedSize: liveReplacementItems[0].selectedSize || '',
        unitPrice: roundMoney(Number(liveReplacementItems[0].product.price || 0)),
        unitTotal: roundMoney(liveReplacementItems[0].pricing.total / liveReplacementItems[0].quantity),
        total: liveReplacementItems[0].pricing.total
      } : null
    };

    const refunds = refundRecord ? [...getSaleRefunds(originalSale), refundRecord] : getSaleRefunds(originalSale);
    const nextSale = {
      ...originalSale,
      exchanges: [...(originalSale.exchanges || []), exchangeRecord],
      refunds,
      status: normalizeSaleStatus(originalSale.status, { ...originalSale, refunds }),
      paymentStatus: normalizeSaleStatus(originalSale.status, { ...originalSale, refunds }),
      refunded_at: refundRecord ? refundRecord.refundedAt : originalSale.refunded_at,
      refunded_by: refundRecord ? refundRecord.refundedBy : originalSale.refunded_by,
      refundedAmount: getSaleRefundTotal({ ...originalSale, refunds })
    };

    const stockChanges = [
      {
        productId: originalSaleItem.productId,
        productName: originalSaleItem.name,
        selectedSize: originalSaleItem.selectedSize || '',
        quantityDelta: returnedQuantity,
        reason: `Cambio venta ${originalSale.id} - pieza recibida`,
        performedBy: profile?.name || user?.email || 'Sistema',
        performedById: user?.uid || '',
        reference: originalSale.id
      },
      ...liveReplacementItems.map((item) => ({
        productId: item.product.id,
        productName: item.product.name,
        selectedSize: item.selectedSize || '',
        quantityDelta: -item.quantity,
        reason: `Cambio venta ${originalSale.id} - pieza entregada`,
        performedBy: profile?.name || user?.email || 'Sistema',
        performedById: user?.uid || '',
        reference: originalSale.id
      }))
    ];

    const localInventoryLogs = stockChanges
      .map((change) => {
        const product = (currentData.products || []).find((entry) => entry.id === change.productId);
        if (!product) return null;
        const currentStock = Number(product.stock || 0);
        const nextStock = Math.max(0, currentStock + Number(change.quantityDelta || 0));

        return buildInventoryLogEntry({
          id: generateId('invlog'),
          productId: change.productId,
          productName: change.productName || product.name || change.productId,
          type: change.quantityDelta > 0 ? INVENTORY_MOVEMENT_TYPES.exchangeIn : INVENTORY_MOVEMENT_TYPES.exchangeOut,
          quantity: Math.abs(Number(change.quantityDelta || 0)),
          oldStock: currentStock,
          newStock: nextStock,
          reason: change.reason,
          performedBy: change.performedBy,
          performedById: change.performedById,
          reference: change.reference
        });
      })
      .filter(Boolean);

    const nextProducts = (currentData.products || []).map((product) => (
      stockChanges
        .filter((change) => change.productId === product.id)
        .reduce(
          (nextProduct, change) => applyLocalStockChange(
            nextProduct,
            change.selectedSize || '',
            Number(change.quantityDelta || 0)
          ),
          product
        )
    ));

    const nextSales = (currentData.sales || []).map((sale) => (
      sale.id === originalSale.id ? nextSale : sale
    ));
    if (adjustmentSale) {
      nextSales.unshift(adjustmentSale);
    }

    const nextPayments = adjustmentPayments.length > 0
      ? [...adjustmentPayments, ...(currentData.payments || [])]
      : (currentData.payments || []);

    saveData({
      ...currentData,
      sales: nextSales,
      payments: nextPayments,
      products: nextProducts,
      inventoryLogs: localInventoryLogs.length > 0
        ? [...localInventoryLogs, ...(currentData.inventoryLogs || [])]
        : currentData.inventoryLogs
    });

    upsertWeeklyCachedSale(nextSale);
    if (adjustmentSale) {
      upsertWeeklyCachedSale(adjustmentSale);
    }
    setSales(nextSales);
    setProducts(nextProducts.filter((product) => product.active !== false));
    setSelectedSale(nextSale);
    setExchangeTarget(null);
    setExchangeForm(DEFAULT_EXCHANGE_FORM);
    setExchangeReplacementSearch('');

    try {
      await registerSaleExchange({
        originalSale,
        nextSale,
        adjustmentSale,
        adjustmentPayments,
        stockChanges
      });

      if (differenceAmount > 0) {
        showNotification('success', `Cambio registrado. El cliente pago ${formatCurrency(differenceAmount)} adicionales.`);
      } else if (differenceAmount < 0) {
        showNotification('success', `Cambio registrado. Debes devolver ${formatCurrency(Math.abs(differenceAmount))} al cliente.`);
      } else {
        showNotification('success', 'Cambio registrado sin diferencia de dinero.');
      }
    } catch (error) {
      console.error('Error saving exchange:', error);
      queuePendingExchange({
        originalSale,
        nextSale,
        adjustmentSale,
        adjustmentPayments,
        stockChanges
      });
      syncPendingQueue().catch((syncError) => {
        console.error('Error retrying pending exchange sync queue:', syncError);
      });
      showNotification('warning', getFirestoreSyncErrorMessage(error));
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
            <div className="flex flex-wrap items-start gap-2">
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
                const saleStatus = normalizeSaleStatus(sale.status, sale);
                const isSpecialPayment = isSpecialOrderPaymentSale(sale);
                const saleDisplayTotal = Number(sale.total || 0);
                const netTotal = getNetSaleTotal(sale);
                const refundAllowed = canRefundSale(sale);
                const exchangeAllowed = canExchangeSale(sale);

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
                        {isSpecialPayment && (
                          <div className="text-xs font-semibold text-indigo-600">
                            Orden especial {sale.specialOrderNumber} {sale.customerName ? `• ${sale.customerName}` : ''}
                          </div>
                        )}
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
                    <td className="font-bold text-green-600">{formatCurrency(saleDisplayTotal)}</td>
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
                          disabled={!refundAllowed}
                          className={`inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg ${
                            !refundAllowed
                              ? 'text-gray-300 cursor-not-allowed'
                              : 'text-red-700 hover:bg-red-50'
                          }`}
                          title={
                            isRefundedSale(sale)
                              ? 'Venta ya reembolsada por completo'
                              : isSpecialPayment && !hasDetailedSaleItems(sale)
                                ? 'Esta orden especial vieja no tiene piezas detalladas en la venta'
                                : 'Registrar reembolso parcial o total'
                          }
                        >
                          <RotateCcw size={18} />
                          Refund
                        </button>
                        <button
                          onClick={() => openExchangeModal(sale)}
                          disabled={!exchangeAllowed}
                          className={`inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg ${
                            !exchangeAllowed
                              ? 'text-gray-300 cursor-not-allowed'
                              : 'text-amber-700 hover:bg-amber-50'
                          }`}
                          title={exchangeAllowed ? 'Cambiar una pieza por otra' : 'Esta orden especial vieja no tiene piezas detalladas en la venta'}
                        >
                          <ArrowRightLeft size={18} />
                          Cambio
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
                  {selectedSale.chargedBy && selectedSale.chargedBy !== selectedSale.cashier && (
                    <div className="flex justify-between"><span>Cobrado por</span><strong>{selectedSale.chargedBy}</strong></div>
                  )}
                  <div className="flex justify-between"><span>Método</span><strong>{getPaymentMethodLabel(selectedSale.paymentMethod)}</strong></div>
                  <div className="flex justify-between"><span>Estado</span><strong>{getSaleStatusLabel(normalizeSaleStatus(selectedSale.status, selectedSale))}</strong></div>
                  {isSpecialOrderPaymentSale(selectedSale) && (
                    <div className="flex justify-between"><span>Origen</span><strong>Orden especial {selectedSale.specialOrderNumber || '-'}</strong></div>
                  )}
                  {selectedSaleSpecialOrder && (
                    <>
                      <div className="flex justify-between"><span>Total del pedido</span><strong>{formatCurrency(selectedSaleSpecialOrder.totalAmount || 0)}</strong></div>
                      <div className="flex justify-between"><span>Balance pendiente del pedido</span><strong>{formatCurrency(selectedSaleSpecialOrder.balanceDue || 0)}</strong></div>
                    </>
                  )}
                </div>
              </div>
              <div className="card p-4">
                <h3 className="font-semibold mb-3">Totales de este pago</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Subtotal</span><strong>{formatCurrency(selectedSaleSummary?.subtotal || 0)}</strong></div>
                  {(selectedSaleSummary?.discount || 0) > 0 && (
                    <div className="flex justify-between text-green-600"><span>Descuento</span><strong>-{formatCurrency(selectedSaleSummary?.discount || 0)}</strong></div>
                  )}
                  {(selectedSaleSummary?.discount || 0) > 0 && (
                    <div className="flex justify-between"><span>Subtotal neto</span><strong>{formatCurrency(Math.max(0, (selectedSaleSummary?.subtotal || 0) - (selectedSaleSummary?.discount || 0)))}</strong></div>
                  )}
                  {(selectedSaleSummary?.taxBreakdown?.state || 0) > 0 && (
                    <div className="flex justify-between"><span>IVU estatal</span><strong>{formatCurrency(selectedSaleSummary?.taxBreakdown?.state || 0)}</strong></div>
                  )}
                  {(selectedSaleSummary?.taxBreakdown?.municipal || 0) > 0 && (
                    <div className="flex justify-between"><span>IVU municipal</span><strong>{formatCurrency(selectedSaleSummary?.taxBreakdown?.municipal || 0)}</strong></div>
                  )}
                  {(selectedSaleSummary?.taxBreakdown?.state || 0) <= 0 && (selectedSaleSummary?.taxBreakdown?.municipal || 0) <= 0 && (selectedSaleSummary?.tax || 0) > 0 && (
                    <div className="flex justify-between"><span>IVU</span><strong>{formatCurrency(selectedSaleSummary?.tax || 0)}</strong></div>
                  )}
                  <div className="flex justify-between"><span>Total pagado</span><strong>{formatCurrency(selectedSaleSummary?.total || 0)}</strong></div>
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
                    disabled={!canRefundSale(selectedSale)}
                    onClick={() => openRefundModal(selectedSale)}
                  >
                    Registrar refund
                  </button>
                  <button
                    className="btn btn-secondary"
                    disabled={!canExchangeSale(selectedSale)}
                    onClick={() => openExchangeModal(selectedSale)}
                  >
                    Cambio de pieza
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
                    {(selectedSaleSummary?.items || selectedSale.items || []).map((item, index) => (
                      <tr key={`${selectedSale.id}_item_${index}`}>
                        <td>
                          <div>{item.name}</div>
                          {item.discountAmount > 0 && (
                            <div className="text-xs text-green-600">
                              Desc. {item.discountType === 'percentage' ? `${item.discountValue}%` : formatCurrency(item.discountValue)} -{formatCurrency(item.discountAmount)}
                            </div>
                          )}
                        </td>
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
                      {(refund.items || []).map((item) => (
                        <p key={`${refund.id}_${item.saleItemKey}`} className="text-sm text-gray-600">
                          {item.name}{item.selectedSize ? ` (${item.selectedSize})` : ''} x {formatQuantity(item.quantity, 'unit')}
                        </p>
                      ))}
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

            <div className="card p-4">
              <h3 className="font-semibold mb-3">Cambios de piezas</h3>
              <div className="space-y-3">
                {(selectedSale.exchanges || []).length > 0 ? (selectedSale.exchanges || []).map((exchange) => (
                  <div key={exchange.id} className="rounded-lg border border-gray-200 p-3 space-y-2">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div className="text-sm text-gray-700">
                        <strong>{exchange.returnedItem?.name || 'Pieza devuelta'}</strong>
                        {exchange.returnedItem?.selectedSize ? ` (${exchange.returnedItem.selectedSize})` : ''}
                        {' '}por{' '}
                        <strong>{(exchange.replacementItems || [exchange.replacementItem]).filter(Boolean).map((item) => `${item.name}${item.selectedSize ? ` (${item.selectedSize})` : ''}${item.quantity > 1 ? ` x${item.quantity}` : ''}`).join(', ') || 'Pieza nueva'}</strong>
                      </div>
                      <div className="text-sm">
                        {exchange.settlementType === 'collect' && (
                          <span className="font-semibold text-emerald-700">Cobrado: {formatCurrency(exchange.differenceAmount || 0)}</span>
                        )}
                        {exchange.settlementType === 'refund' && (
                          <span className="font-semibold text-red-600">Devuelto: {formatCurrency(Math.abs(exchange.differenceAmount || 0))}</span>
                        )}
                        {exchange.settlementType === 'even' && (
                          <span className="font-semibold text-gray-600">Sin diferencia</span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatDateTime(exchange.exchangedAt)} {exchange.exchangedBy ? `• ${exchange.exchangedBy}` : ''}
                      {exchange.settlementMethod ? ` • ${getPaymentMethodLabel(exchange.settlementMethod)}` : ''}
                    </div>
                    {exchange.notes && <p className="text-xs text-gray-500">{exchange.notes}</p>}
                  </div>
                )) : (
                  <p className="text-sm text-gray-500">No hay cambios de piezas registrados para esta venta.</p>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button type="button" onClick={() => setRefundForm((current) => ({ ...current, mode: 'items' }))} className={`rounded-lg border p-3 text-left ${refundForm.mode === 'items' ? 'border-blue-600 bg-blue-50 text-blue-900' : 'border-gray-200'}`}>
                <span className="block font-semibold">Seleccionar artículos</span>
                <span className="block text-xs mt-1">Elige uno o varios productos y sus cantidades.</span>
              </button>
              <button type="button" onClick={() => setRefundForm((current) => ({ ...current, mode: 'total' }))} className={`rounded-lg border p-3 text-left ${refundForm.mode === 'total' ? 'border-blue-600 bg-blue-50 text-blue-900' : 'border-gray-200'}`}>
                <span className="block font-semibold">Reembolso total</span>
                <span className="block text-xs mt-1">Devuelve todo el balance pendiente de esta venta.</span>
              </button>
            </div>

            {refundForm.mode === 'items' ? (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">Artículos a reembolsar</label>
                  <button type="button" className="text-sm text-blue-700 font-medium hover:underline" onClick={() => setRefundForm((current) => ({ ...current, itemQuantities: Object.fromEntries(refundItemOptions.map((item) => [item.saleItemKey, item.availableToRefund])) }))}>Seleccionar todos</button>
                </div>
                <div className="rounded-lg border border-gray-200 divide-y max-h-64 overflow-y-auto">
                  {refundItemOptions.map((option) => {
                    const quantity = refundForm.itemQuantities?.[option.saleItemKey] || '';
                    return (
                      <div key={option.saleItemKey} className="flex items-center gap-3 p-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{option.item.name}{option.item.selectedSize ? ` (${option.item.selectedSize})` : ''}</p>
                          <p className="text-xs text-gray-500">{formatCurrency(option.unitAmount)} c/u · disponibles: {option.availableToRefund}</p>
                        </div>
                        <input aria-label={`Cantidad de ${option.item.name}`} type="number" min="0" max={option.availableToRefund} step="1" value={quantity} onChange={(e) => setRefundForm((current) => ({ ...current, itemQuantities: { ...current.itemQuantities, [option.saleItemKey]: e.target.value } }))} className="input w-20 text-center" />
                      </div>
                    );
                  })}
                  {refundItemOptions.length === 0 && <p className="p-3 text-sm text-gray-500">No hay artículos disponibles para reembolsar.</p>}
                </div>
                <div className="mt-2 flex justify-between text-sm"><span className="text-gray-600">Total de artículos seleccionados</span><strong>{formatCurrency(selectedRefundItemsAmount)}</strong></div>
              </div>
            ) : (
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">Se reembolsará el balance completo: <strong>{formatCurrency(Math.max(0, Number(refundTarget.total || 0) - getSaleRefundTotal(refundTarget)))}</strong>.</div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Método del refund</label>
              <select
                value={refundForm.method}
                onChange={(e) => setRefundForm((current) => ({ ...current, method: e.target.value }))}
                className="input w-full"
              >
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="ach">ACH</option>
                <option value="ath_movil">ATH Móvil</option>
                <option value="paypal">PayPal</option>
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
                Confirmar reembolso
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(exchangeTarget)}
        onClose={() => {
          setExchangeTarget(null);
          setExchangeForm(DEFAULT_EXCHANGE_FORM);
          setExchangeReplacementSearch('');
        }}
        title={exchangeTarget ? `Cambio de pieza para venta #${getReceiptNumber(exchangeTarget.id)}` : 'Cambio de pieza'}
        size="lg"
      >
        {exchangeTarget && (
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm space-y-2">
              <div className="font-medium text-amber-900">Flujo rapido</div>
              <div className="text-amber-800">1. Escoge la pieza que devuelve.</div>
              <div className="text-amber-800">2. Agrega una o varias piezas nuevas.</div>
              <div className="text-amber-800">3. El sistema calcula si te paga, si le devuelves, o si queda parejo.</div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pieza que devuelve</label>
              <select
                value={exchangeForm.returnedItemKey}
                onChange={(e) => setExchangeForm((current) => ({ ...current, returnedItemKey: e.target.value, returnedQuantity: 1 }))}
                className="input w-full"
              >
                <option value="">Selecciona una pieza</option>
                {exchangeReturnedOptions.map((option) => (
                  <option key={option.saleItemKey} value={option.saleItemKey}>
                    {option.item.name}
                    {option.item.selectedSize ? ` (${option.item.selectedSize})` : ''}
                    {' - '}
                    {formatCurrency(option.unitTotal)}
                    {' - disponible para cambio: '}
                    {option.availableToExchange}
                  </option>
                ))}
              </select>
            </div>

            {selectedReturnedOption && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad que devuelve</label>
                <input
                  type="number"
                  min="1"
                  max={selectedReturnedOption.availableToExchange}
                  step="1"
                  value={exchangeForm.returnedQuantity}
                  onChange={(e) => setExchangeForm((current) => ({ ...current, returnedQuantity: e.target.value }))}
                  className="input w-full"
                />
                <p className="mt-1 text-xs text-gray-500">Máximo disponible para cambio: {selectedReturnedOption.availableToExchange}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pieza nueva que se lleva</label>
              {false ? (
                <div className="flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{replacementProduct.name}</p>
                    <p className="text-xs text-gray-500">{formatCurrency(replacementProduct.price || 0)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setExchangeForm((current) => ({ ...current, replacementProductId: '', replacementSize: '' }));
                      setExchangeReplacementSearch('');
                    }}
                    className="ml-3 text-gray-400 hover:text-red-500 text-xl leading-none"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={exchangeReplacementSearch}
                    onChange={(e) => setExchangeReplacementSearch(e.target.value)}
                    className="input w-full"
                    placeholder="Busca por nombre, SKU, barcode o categoria"
                    autoComplete="off"
                  />
                  {exchangeReplacementSearch.trim() && (
                    <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                      {filteredReplacementProducts.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-gray-400">No se encontraron piezas</p>
                      ) : (
                        filteredReplacementProducts.map((product) => (
                          <button
                            key={product.id}
                            type="button"
                            onClick={() => {
                              setExchangeForm((current) => ({
                                ...current,
                                replacementItems: [...current.replacementItems, { id: generateId('replacement'), productId: product.id, selectedSize: '', quantity: 1 }]
                              }));
                              setExchangeReplacementSearch('');
                            }}
                            className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0 text-left"
                          >
                            <span className="font-medium text-gray-800">{product.name}</span>
                            <span className="text-gray-500 ml-2 shrink-0">{formatCurrency(product.price || 0)}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {false && replacementProduct?.useSizeSelection && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Talla o size</label>
                <select
                  value={exchangeForm.replacementSize}
                  onChange={(e) => setExchangeForm((current) => ({ ...current, replacementSize: e.target.value }))}
                  className="input w-full"
                >
                  <option value="">Selecciona una talla</option>
                  {replacementSizeOptions.map((size) => (
                    <option key={size} value={size}>
                      {size} - stock {getProductStockForExchange(replacementProduct, size)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {false && replacementProduct && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad de piezas nuevas</label>
                <input
                  type="number"
                  min="1"
                  max={getProductStockForExchange(replacementProduct, replacementSize)}
                  step="1"
                  value={exchangeForm.replacementQuantity}
                  onChange={(e) => setExchangeForm((current) => ({ ...current, replacementQuantity: e.target.value }))}
                  className="input w-full"
                  disabled={replacementProduct.useSizeSelection && !replacementSize}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Disponible: {replacementProduct.useSizeSelection && !replacementSize
                    ? 'selecciona una talla'
                    : getProductStockForExchange(replacementProduct, replacementSize)}
                </p>
              </div>
            )}

            {replacementItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">Piezas agregadas</p>
                {replacementItems.map((item) => (
                  <div key={item.id} className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="text-sm font-medium">{item.product.name}</p><p className="text-xs text-gray-500">{formatCurrency(item.product.price || 0)}</p></div>
                      <button type="button" className="text-gray-400 hover:text-red-500 text-xl" onClick={() => setExchangeForm((current) => ({ ...current, replacementItems: current.replacementItems.filter((entry) => entry.id !== item.id) }))}>×</button>
                    </div>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {item.product.useSizeSelection && <select className="input" value={item.selectedSize} onChange={(e) => setExchangeForm((current) => ({ ...current, replacementItems: current.replacementItems.map((entry) => entry.id === item.id ? { ...entry, selectedSize: e.target.value } : entry) }))}><option value="">Selecciona talla</option>{replacementSizeOptions(item.product).map((size) => <option key={size} value={size}>{size} - stock {getProductStockForExchange(item.product, size)}</option>)}</select>}
                      <input type="number" min="1" step="1" className="input" value={item.quantity} disabled={item.product.useSizeSelection && !item.selectedSize} onChange={(e) => setExchangeForm((current) => ({ ...current, replacementItems: current.replacementItems.map((entry) => entry.id === item.id ? { ...entry, quantity: e.target.value } : entry) }))} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(selectedReturnedOption || replacementItems.length > 0) && (
              <div className="rounded-lg bg-gray-50 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Valor devuelto ({exchangeReturnedQuantity} pieza{exchangeReturnedQuantity !== 1 ? 's' : ''})</span>
                  <strong>{formatCurrency((selectedReturnedOption?.unitTotal || 0) * exchangeReturnedQuantity)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Valor piezas nuevas ({replacementPricings.reduce((sum, item) => sum + item.quantity, 0)})</span>
                  <strong>{formatCurrency(replacementPricings.reduce((sum, item) => sum + item.pricing.total, 0))}</strong>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span>Diferencia</span>
                  <strong className={
                    exchangeDifference > 0
                      ? 'text-emerald-700'
                      : exchangeDifference < 0
                        ? 'text-red-600'
                        : 'text-gray-700'
                  }>
                    {exchangeDifference > 0 && `Cliente paga ${formatCurrency(exchangeDifference)}`}
                    {exchangeDifference < 0 && `Debes devolver ${formatCurrency(Math.abs(exchangeDifference))}`}
                    {exchangeDifference === 0 && 'Sin diferencia'}
                  </strong>
                </div>
              </div>
            )}

            {exchangeDifference !== 0 && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Metodo {exchangeDifference > 0 ? 'de cobro' : 'de devolucion'}
                  </label>
                  <select
                    value={exchangeForm.settlementMethod}
                    onChange={(e) => setExchangeForm((current) => ({ ...current, settlementMethod: e.target.value }))}
                    className="input w-full"
                  >
                    <option value="cash">Efectivo</option>
                    <option value="card">Tarjeta</option>
                    <option value="ach">ACH</option>
                    <option value="ath_movil">ATH Movil</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Referencia</label>
                  <input
                    type="text"
                    value={exchangeForm.settlementReference}
                    onChange={(e) => setExchangeForm((current) => ({ ...current, settlementReference: e.target.value }))}
                    className="input w-full"
                    placeholder="Opcional: numero de referencia"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
              <textarea
                value={exchangeForm.notes}
                onChange={(e) => setExchangeForm((current) => ({ ...current, notes: e.target.value }))}
                className="input w-full min-h-[96px]"
                placeholder="Opcional: detalle del cambio"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setExchangeTarget(null);
                  setExchangeForm(DEFAULT_EXCHANGE_FORM);
                  setExchangeReplacementSearch('');
                }}
              >
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={handleExchange}>
                Guardar cambio
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default Sales;
