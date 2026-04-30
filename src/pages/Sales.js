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
import { refundSale, registerSaleExchange, resetAllSaleExchangesSync, subscribeSales } from '../services/salesService';
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
import { useAuth } from '../contexts/AuthContext';
import { buildSalePrintHtml, buildSaleRefundPrintHtml } from '../utils/printTemplates';
import { printHtmlDocument } from '../services/printService';
import { calculateItemPricing, roundMoney } from '../utils/cartPricing';

const DEFAULT_REFUND_FORM = {
  amount: '',
  method: '',
  reason: '',
  notes: ''
};

const DEFAULT_EXCHANGE_FORM = {
  returnedItemKey: '',
  replacementProductId: '',
  replacementSize: '',
  settlementMethod: 'cash',
  settlementReference: '',
  notes: ''
};

const getSaleItemKey = (saleId, item = {}, index = 0) => `${saleId}::${item.productId || 'item'}::${index}`;

function Sales() {
  const { user, profile } = useAuth();
  const [sales, setSales] = useState([]);
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
  const [isResettingExchanges, setIsResettingExchanges] = useState(false);

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
  const replacementProduct = useMemo(
    () => products.find((product) => product.id === exchangeForm.replacementProductId) || null,
    [exchangeForm.replacementProductId, products]
  );
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
  const replacementSizeOptions = useMemo(() => {
    if (!replacementProduct?.useSizeSelection) return [];
    if (Array.isArray(replacementProduct.sizeStocks) && replacementProduct.sizeStocks.length > 0) {
      return replacementProduct.sizeStocks.map((entry) => entry.size).filter(Boolean);
    }
    return Array.isArray(replacementProduct.availableSizes) ? replacementProduct.availableSizes.filter(Boolean) : [];
  }, [replacementProduct]);
  const replacementSize = replacementProduct?.useSizeSelection ? exchangeForm.replacementSize : '';
  const replacementPricing = useMemo(() => {
    if (!replacementProduct) return null;

    return calculateItemPricing({
      quantity: 1,
      price: Number(replacementProduct.price || 0),
      ivuStateEnabled: replacementProduct.ivuStateEnabled !== false,
      ivuMunicipalEnabled: replacementProduct.ivuMunicipalEnabled !== false
    });
  }, [replacementProduct]);
  const exchangeDifference = useMemo(() => {
    if (!selectedReturnedOption || !replacementPricing) return 0;
    return roundMoney(replacementPricing.total - selectedReturnedOption.unitTotal);
  }, [replacementPricing, selectedReturnedOption]);
  const totalExchangeCount = useMemo(
    () => sales.reduce((sum, sale) => sum + (Array.isArray(sale.exchanges) ? sale.exchanges.length : 0), 0),
    [sales]
  );

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
          const replacementProductId = exchange.replacementItem?.productId;

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

          if (replacementProductId && nextProductsMap.has(replacementProductId)) {
            nextProductsMap.set(
              replacementProductId,
              applyLocalStockChange(
                nextProductsMap.get(replacementProductId),
                exchange.replacementItem?.selectedSize || '',
                Number(exchange.replacementItem?.quantity || 1)
              )
            );
          }
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

  const handleExchange = async () => {
    if (!exchangeTarget) return;

    const returnedOption = selectedReturnedOption;
    if (!returnedOption) {
      showNotification('error', 'Selecciona la pieza que el cliente va a devolver.');
      return;
    }

    if (!replacementProduct) {
      showNotification('error', 'Selecciona la pieza nueva que el cliente se va a llevar.');
      return;
    }

    if (replacementProduct.useSizeSelection && !replacementSize) {
      showNotification('error', 'Selecciona la talla o size de la pieza nueva.');
      return;
    }

    const replacementStock = getProductStockForExchange(replacementProduct, replacementSize);
    if (replacementStock < 1) {
      showNotification('error', 'La pieza nueva no tiene stock disponible para hacer el cambio.');
      return;
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

    const currentExchangedCount = (originalSale.exchanges || []).reduce((sum, exchange) => (
      exchange.returnedItem?.saleItemKey === returnedOption.saleItemKey
        ? sum + Number(exchange.returnedItem?.quantity || 0)
        : sum
    ), 0);

    if (currentExchangedCount >= Number(originalSaleItem.quantity || 0)) {
      showNotification('error', 'Esa pieza ya fue cambiada completamente.');
      return;
    }

    const liveReplacementProduct = (currentData.products || []).find((product) => product.id === replacementProduct.id);
    if (!liveReplacementProduct) {
      showNotification('error', 'No se encontro la pieza nueva en inventario.');
      return;
    }

    const liveReplacementStock = getProductStockForExchange(liveReplacementProduct, replacementSize);
    if (liveReplacementStock < 1) {
      showNotification('error', 'La pieza nueva se quedo sin stock. Actualiza e intenta otra vez.');
      return;
    }

    const returnedFinancials = getSaleItemFinancials(originalSaleItem);
    const returnedUnitQuantity = Number(originalSaleItem.quantity || 1);
    const returnedUnitSubtotal = roundMoney(returnedFinancials.subtotal / returnedUnitQuantity);
    const returnedUnitDiscount = roundMoney(returnedFinancials.discountAmount / returnedUnitQuantity);
    const returnedUnitTaxableSubtotal = roundMoney(returnedFinancials.taxableSubtotal / returnedUnitQuantity);
    const returnedUnitStateTax = roundMoney(returnedFinancials.taxBreakdown.state / returnedUnitQuantity);
    const returnedUnitMunicipalTax = roundMoney(returnedFinancials.taxBreakdown.municipal / returnedUnitQuantity);
    const returnedUnitTotal = roundMoney(returnedFinancials.total / returnedUnitQuantity);
    const nextReplacementPricing = calculateItemPricing({
      quantity: 1,
      price: Number(liveReplacementProduct.price || 0),
      ivuStateEnabled: liveReplacementProduct.ivuStateEnabled !== false,
      ivuMunicipalEnabled: liveReplacementProduct.ivuMunicipalEnabled !== false
    });
    const differenceAmount = roundMoney(nextReplacementPricing.total - returnedUnitTotal);
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
          productId: liveReplacementProduct.id,
          name: `Diferencia por cambio - ${liveReplacementProduct.name}`,
          quantity: 1,
          price: roundMoney(nextReplacementPricing.taxableSubtotal - returnedUnitTaxableSubtotal),
          subtotal: roundMoney(nextReplacementPricing.subtotal - returnedUnitSubtotal),
          discountType: 'fixed',
          discountValue: roundMoney(Math.max(0, nextReplacementPricing.discountAmount - returnedUnitDiscount)),
          discountAmount: roundMoney(Math.max(0, nextReplacementPricing.discountAmount - returnedUnitDiscount)),
          taxableSubtotal: roundMoney(nextReplacementPricing.taxableSubtotal - returnedUnitTaxableSubtotal),
          ivuStateEnabled: liveReplacementProduct.ivuStateEnabled !== false,
          ivuMunicipalEnabled: liveReplacementProduct.ivuMunicipalEnabled !== false,
          nonInventory: true
        }
      ],
      subtotal: roundMoney(nextReplacementPricing.subtotal - returnedUnitSubtotal),
      discount: roundMoney(Math.max(0, nextReplacementPricing.discountAmount - returnedUnitDiscount)),
      tax: roundMoney(nextReplacementPricing.totalTax - (returnedUnitStateTax + returnedUnitMunicipalTax)),
      taxBreakdown: {
        state: roundMoney(nextReplacementPricing.stateTax - returnedUnitStateTax),
        municipal: roundMoney(nextReplacementPricing.municipalTax - returnedUnitMunicipalTax)
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
        quantity: 1,
        productId: originalSaleItem.productId || '',
        name: originalSaleItem.name,
        selectedSize: originalSaleItem.selectedSize || '',
        unitPrice: roundMoney(Number(originalSaleItem.price || 0)),
        unitTotal: returnedUnitTotal
      },
      replacementItem: {
        quantity: 1,
        productId: liveReplacementProduct.id,
        name: liveReplacementProduct.name,
        selectedSize: replacementSize,
        unitPrice: roundMoney(Number(liveReplacementProduct.price || 0)),
        unitTotal: nextReplacementPricing.total
      }
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

    const nextProducts = (currentData.products || []).map((product) => {
      if (product.id === originalSaleItem.productId) {
        return applyLocalStockChange(product, originalSaleItem.selectedSize || '', 1);
      }
      if (product.id === liveReplacementProduct.id) {
        return applyLocalStockChange(product, replacementSize, -1);
      }
      return product;
    });

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
      products: nextProducts
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
        stockChanges: [
          {
            productId: originalSaleItem.productId,
            selectedSize: originalSaleItem.selectedSize || '',
            quantityDelta: 1
          },
          {
            productId: liveReplacementProduct.id,
            selectedSize: replacementSize,
            quantityDelta: -1
          }
        ]
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
              {profile?.role === 'admin' && (
                <div className="flex flex-col">
                  <button
                    type="button"
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${
                      isResettingExchanges
                        ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                        : 'bg-red-600 text-white hover:bg-red-700'
                    }`}
                    onClick={handleResetAllExchanges}
                    disabled={isResettingExchanges || totalExchangeCount === 0}
                    title="Boton temporal para borrar todos los cambios de pieza y restaurar inventario"
                  >
                    {isResettingExchanges ? 'Borrando cambios...' : `Reset cambios (${totalExchangeCount})`}
                  </button>
                  <p className="mt-1 text-xs text-red-600">
                    Temporal: borra todos los cambios de pieza, ajustes y pagos relacionados.
                  </p>
                </div>
              )}
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
                const isSpecialPayment = isSpecialOrderPaymentSale(sale);

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
                          disabled={isRefundedSale(sale) || isSpecialPayment}
                          className={`inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg ${
                            isRefundedSale(sale) || isSpecialPayment
                              ? 'text-gray-300 cursor-not-allowed'
                              : 'text-red-700 hover:bg-red-50'
                          }`}
                          title={
                            isSpecialPayment
                              ? 'Los reembolsos de órdenes especiales se manejan desde Pedidos especiales'
                              : isRefundedSale(sale)
                                ? 'Venta ya reembolsada por completo'
                                : 'Registrar reembolso parcial o total'
                          }
                        >
                          <RotateCcw size={18} />
                          Refund
                        </button>
                        <button
                          onClick={() => openExchangeModal(sale)}
                          disabled={isSpecialPayment}
                          className={`inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg ${
                            isSpecialPayment
                              ? 'text-gray-300 cursor-not-allowed'
                              : 'text-amber-700 hover:bg-amber-50'
                          }`}
                          title={isSpecialPayment ? 'Este tipo de venta no permite cambio directo de pieza' : 'Cambiar una pieza por otra'}
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
                </div>
              </div>
              <div className="card p-4">
                <h3 className="font-semibold mb-3">Totales</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Subtotal</span><strong>{formatCurrency(selectedSaleSummary?.subtotal || 0)}</strong></div>
                  {(selectedSaleSummary?.discount || 0) > 0 && (
                    <div className="flex justify-between text-green-600"><span>Descuento</span><strong>-{formatCurrency(selectedSaleSummary?.discount || 0)}</strong></div>
                  )}
                  {(selectedSaleSummary?.taxBreakdown?.state || 0) > 0 && (
                    <div className="flex justify-between"><span>IVU estatal</span><strong>{formatCurrency(selectedSaleSummary?.taxBreakdown?.state || 0)}</strong></div>
                  )}
                  {(selectedSaleSummary?.taxBreakdown?.municipal || 0) > 0 && (
                    <div className="flex justify-between"><span>IVU municipal</span><strong>{formatCurrency(selectedSaleSummary?.taxBreakdown?.municipal || 0)}</strong></div>
                  )}
                  <div className="flex justify-between"><span>IVU</span><strong>{formatCurrency(selectedSaleSummary?.tax || 0)}</strong></div>
                  <div className="flex justify-between"><span>Total</span><strong>{formatCurrency(selectedSaleSummary?.total || 0)}</strong></div>
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
                    disabled={isRefundedSale(selectedSale) || isSpecialOrderPaymentSale(selectedSale)}
                    onClick={() => openRefundModal(selectedSale)}
                  >
                    Registrar refund
                  </button>
                  <button
                    className="btn btn-secondary"
                    disabled={isSpecialOrderPaymentSale(selectedSale)}
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
                        <strong>{exchange.replacementItem?.name || 'Pieza nueva'}</strong>
                        {exchange.replacementItem?.selectedSize ? ` (${exchange.replacementItem.selectedSize})` : ''}
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
              <div className="text-amber-800">2. Escoge la pieza nueva.</div>
              <div className="text-amber-800">3. El sistema calcula si te paga, si le devuelves, o si queda parejo.</div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pieza que devuelve</label>
              <select
                value={exchangeForm.returnedItemKey}
                onChange={(e) => setExchangeForm((current) => ({ ...current, returnedItemKey: e.target.value }))}
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pieza nueva que se lleva</label>
              <input
                type="text"
                value={exchangeReplacementSearch}
                onChange={(e) => setExchangeReplacementSearch(e.target.value)}
                className="input w-full mb-2"
                placeholder="Busca por nombre, SKU, barcode o categoria"
              />
              <select
                value={exchangeForm.replacementProductId}
                onChange={(e) => setExchangeForm((current) => ({
                  ...current,
                  replacementProductId: e.target.value,
                  replacementSize: ''
                }))}
                className="input w-full"
              >
                <option value="">Selecciona una pieza nueva</option>
                {filteredReplacementProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} - {formatCurrency(product.price || 0)}
                  </option>
                ))}
                {filteredReplacementProducts.length === 0 && (
                  <option value="" disabled>
                    No se encontraron piezas
                  </option>
                )}
              </select>
              <div className="mt-1 text-xs text-gray-500">
                {filteredReplacementProducts.length} resultado{filteredReplacementProducts.length === 1 ? '' : 's'}
              </div>
            </div>

            {replacementProduct?.useSizeSelection && (
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

            {(selectedReturnedOption || replacementProduct) && (
              <div className="rounded-lg bg-gray-50 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Valor pieza devuelta</span>
                  <strong>{formatCurrency(selectedReturnedOption?.unitTotal || 0)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Valor pieza nueva</span>
                  <strong>{formatCurrency(replacementPricing?.total || 0)}</strong>
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
