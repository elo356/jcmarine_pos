import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Search, Barcode, Plus, Minus, Trash2, ShoppingCart, CreditCard, Banknote, Smartphone } from 'lucide-react';
import {
  loadData,
  saveData,
  formatCurrency,
  formatQuantity,
  generateId,
  normalizeProductTaxConfig,
  normalizePrintSettings
} from '../data/demoData';
import Modal from '../components/Modal';
import Notification from '../components/Notification';
import { useAuth } from '../contexts/AuthContext';
import { subscribeProducts } from '../services/inventoryService';
import { openCashDrawer } from '../services/hardwareService';
import {
  DEFAULT_SHARED_POS_CART,
  getPersistentTerminalId,
  saveSharedPosCart,
  serializeSharedPosCartState,
  subscribeSharedPosCart
} from '../services/posCartService';
import { subscribeCategories } from '../services/categoryService';
import { commitSaleTransaction } from '../services/checkoutService';
import { verifyFirestoreAvailability } from '../services/firestoreHealthService';
import { subscribeStoreStatusLogs } from '../services/storeStatusLogService';
import { upsertWeeklyCachedSale } from '../services/weeklySalesCacheService';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import useIsMobileDevice from '../hooks/useIsMobileDevice';
import useScannerHidStatus from '../hooks/useScannerHidStatus';
import useScannerKeyboardInput from '../hooks/useScannerKeyboardInput';
import {
  buildPaymentEntry,
  buildTransactionRecord,
  getPaymentMethodLabel,
  PAYMENT_METHODS
} from '../utils/paymentUtils';
import { buildSalePrintHtml } from '../utils/printTemplates';
import { printHtmlDocument } from '../services/printService';

const IVU_STATE_RATE = 0.105;
const IVU_MUNICIPAL_RATE = 0.01;
const SHARED_CART_SYNC_DEBOUNCE_MS = 250;
const DEFAULT_ITEM_DISCOUNT = { type: 'percentage', value: 0 };
const DEFAULT_SPLIT_PAYMENT = {
  method: PAYMENT_METHODS.cash,
  amount: '',
  reference: '',
  cashReceived: ''
};

const normalizeItemDiscount = (discount = {}) => ({
  type: discount?.type === 'fixed' ? 'fixed' : 'percentage',
  value: Math.max(0, Number.isFinite(Number(discount?.value)) ? Number(discount.value) : 0)
});

const calculateItemPricing = (item) => {
  const quantity = Number(item.quantity || 0);
  const subtotal = Number(item.price || 0) * quantity;
  const discount = normalizeItemDiscount(item.discount);
  const rawDiscountAmount = discount.type === 'percentage'
    ? subtotal * (discount.value / 100)
    : discount.value;
  const discountAmount = Math.min(Math.max(rawDiscountAmount, 0), subtotal);
  const taxableSubtotal = subtotal - discountAmount;
  const stateTax = item.ivuStateEnabled !== false ? taxableSubtotal * IVU_STATE_RATE : 0;
  const municipalTax = item.ivuMunicipalEnabled !== false ? taxableSubtotal * IVU_MUNICIPAL_RATE : 0;

  return {
    subtotal,
    discount,
    discountAmount,
    taxableSubtotal,
    stateTax,
    municipalTax,
    totalTax: stateTax + municipalTax,
    total: taxableSubtotal + stateTax + municipalTax
  };
};

function POS({
  onCreateProductFromBarcode = () => {},
  onEditProductFromScan = () => {},
  onOpenSpecialOrders = () => {}
}) {
  const { user, profile } = useAuth();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cart, setCart] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [lastSale, setLastSale] = useState(null);
  const [notification, setNotification] = useState(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [splitPayments, setSplitPayments] = useState([{ ...DEFAULT_SPLIT_PAYMENT }]);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [cartSyncStatus, setCartSyncStatus] = useState('connecting');
  const [sharedCartMeta, setSharedCartMeta] = useState(DEFAULT_SHARED_POS_CART.meta);
  const [storeStatusLogs, setStoreStatusLogs] = useState([]);
  const [firestoreReady, setFirestoreReady] = useState(true);
  const [productsPage, setProductsPage] = useState(1);
  const [pendingProductConfig, setPendingProductConfig] = useState(null);
  const [pendingSaleSize, setPendingSaleSize] = useState('');
  const [pendingSaleQuantity, setPendingSaleQuantity] = useState('1');
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [scannerStatus, setScannerStatus] = useState('Listo para escanear');
  const [scannerError, setScannerError] = useState('');
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [scannerResult, setScannerResult] = useState(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [keyboardScannerDetected, setKeyboardScannerDetected] = useState(false);
  const [selectedPrintDocument, setSelectedPrintDocument] = useState('receipt');
  const POS_PAGE_SIZE = 80;
  const debouncedSearch = useDebouncedValue(searchQuery, 250);
  const isMobileDevice = useIsMobileDevice();
  const {
    hidSupported,
    scannerDetected,
    deviceName,
    refreshDevices
  } = useScannerHidStatus(['netum', 'nsl8bls', 'barcode', 'scanner']);
  const videoRef = useRef(null);
  const scannerStreamRef = useRef(null);
  const scannerIntervalRef = useRef(null);
  const addToCartRef = useRef(null);
  const getLinkedProductsRef = useRef(null);
  const stopScannerRef = useRef(null);
  const showNotificationRef = useRef(null);
  const sharedCartReadyRef = useRef(false);
  const lastSharedCartSignatureRef = useRef('');
  const sharedCartSyncTimerRef = useRef(null);
  const terminalId = useMemo(() => getPersistentTerminalId(), []);
  const scannerReady = scannerDetected || keyboardScannerDetected;
  const scannerConnectionLabel = scannerDetected
    ? 'Scanner USB detectado'
    : keyboardScannerDetected
      ? 'Scanner USB conectado'
      : 'Scanner USB no detectado';
  const scannerConnectionHint = scannerDetected
    ? `Listo para leer${deviceName ? `: ${deviceName}` : ''}.`
    : keyboardScannerDetected
      ? 'El scanner ya leyó códigos en esta computadora y está funcionando como teclado USB.'
      : hidSupported
        ? 'Este scanner puede estar funcionando como teclado USB aunque WebHID no lo liste. Si ya lee códigos, puedes usarlo sin vincularlo.'
        : 'Este navegador no permite detectar el scanner por USB directamente, pero igual puedes escanear si entra como teclado.';
  const sharedCartEditor = useMemo(
    () => ({
      terminalId,
      uid: user?.uid || '',
      name: profile?.name || user?.email || 'Sistema POS'
    }),
    [profile?.name, terminalId, user?.email, user?.uid]
  );

  useEffect(() => {
    const data = loadData();
    setCategories(data.categories.filter(c => c.active));

    const unsubscribe = subscribeProducts(
      (rows) => {
        if (rows.length > 0) {
          setProducts(rows.map(normalizeProductTaxConfig).filter((p) => p.active));
        } else {
          setProducts((data.products || []).map(normalizeProductTaxConfig).filter((p) => p.active));
        }
      },
      (error) => {
        console.error('Error subscribing POS products from Firestore, fallback local:', error);
        setProducts((data.products || []).map(normalizeProductTaxConfig).filter((p) => p.active));
      }
    );

    const unsubCategories = subscribeCategories(
      (rows) => {
        if (rows.length > 0) {
          setCategories(rows.filter((c) => c.active !== false));
        }
      },
      (error) => {
        console.error('Error subscribing categories in POS:', error);
      }
    );

    return () => {
      unsubscribe();
      unsubCategories();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeSharedPosCart(
      (state, meta = {}) => {
        const signature = serializeSharedPosCartState(state);
        lastSharedCartSignatureRef.current = signature;
        sharedCartReadyRef.current = true;
        setCart(state.items);
        setSharedCartMeta(state.meta);
        setCartSyncStatus(meta.fromCache ? 'offline' : 'synced');
      },
      () => {
        setCartSyncStatus('offline');
      }
    );

    return () => {
      if (sharedCartSyncTimerRef.current) {
        clearTimeout(sharedCartSyncTimerRef.current);
        sharedCartSyncTimerRef.current = null;
      }
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sharedCartReadyRef.current) return undefined;

    const localSignature = serializeSharedPosCartState({ items: cart });
    if (localSignature === lastSharedCartSignatureRef.current) return undefined;

    if (sharedCartSyncTimerRef.current) {
      clearTimeout(sharedCartSyncTimerRef.current);
    }

    sharedCartSyncTimerRef.current = setTimeout(() => {
      saveSharedPosCart({
        items: cart,
        updatedBy: sharedCartEditor
      })
        .then(() => {
          lastSharedCartSignatureRef.current = localSignature;
          setCartSyncStatus('synced');
        })
        .catch((error) => {
          console.error('Error saving shared POS cart:', error);
          setCartSyncStatus('offline');
        });
    }, SHARED_CART_SYNC_DEBOUNCE_MS);

    return () => {
      if (sharedCartSyncTimerRef.current) {
        clearTimeout(sharedCartSyncTimerRef.current);
        sharedCartSyncTimerRef.current = null;
      }
    };
  }, [cart, sharedCartEditor]);

  const buildAdjacencyMap = (items) => {
    const adjacency = new Map(items.map((p) => [p.id, new Set()]));

    items.forEach((product) => {
      (product.linkedProductIds || []).forEach((linkedId) => {
        if (!adjacency.has(linkedId) || linkedId === product.id) return;
        adjacency.get(product.id).add(linkedId);
        adjacency.get(linkedId).add(product.id);
      });
    });

    return adjacency;
  };

  useEffect(() => {
    setProductsPage(1);
  }, [debouncedSearch, selectedCategory]);

  const filteredProducts = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    let matchedIds;

    if (!query) {
      matchedIds = new Set(products.map((p) => p.id));
    } else {
      const directMatches = new Set(
        products
          .filter((product) =>
            (product.sku || '').toLowerCase().includes(query) ||
            product.name.toLowerCase().includes(query) ||
            product.barcode.includes(debouncedSearch) ||
            (product.description || '').toLowerCase().includes(query)
          )
          .map((product) => product.id)
      );

      if (directMatches.size === 0) return [];

      const adjacency = buildAdjacencyMap(products);
      const queue = [...directMatches];
      matchedIds = new Set(directMatches);

      while (queue.length > 0) {
        const currentId = queue.shift();
        const neighbors = adjacency.get(currentId) || new Set();

        neighbors.forEach((neighborId) => {
          if (matchedIds.has(neighborId)) return;
          matchedIds.add(neighborId);
          queue.push(neighborId);
        });
      }
    }

    return products.filter((product) => {
      const matchesCategory = selectedCategory === 'all' || product.categoryId === selectedCategory;
      return matchedIds.has(product.id) && matchesCategory;
    });
  }, [products, debouncedSearch, selectedCategory]);

  const posTotalPages = Math.max(1, Math.ceil(filteredProducts.length / POS_PAGE_SIZE));
  const visibleProducts = useMemo(() => {
    const start = (productsPage - 1) * POS_PAGE_SIZE;
    return filteredProducts.slice(start, start + POS_PAGE_SIZE);
  }, [filteredProducts, productsPage]);

  useEffect(() => {
    if (productsPage > posTotalPages) setProductsPage(posTotalPages);
  }, [productsPage, posTotalPages]);

  const getCartItemKey = (productId, selectedSize = '') => `${productId}::${selectedSize || 'no-size'}`;

  const getProductQuantityInCart = (productId, excludingCartKey = null) =>
    cart.reduce((sum, item) => {
      if (item.id !== productId || item.cartKey === excludingCartKey) return sum;
      return sum + Number(item.quantity || 0);
    }, 0);

  const getProductSizeQuantityInCart = (productId, selectedSize, excludingCartKey = null) =>
    cart.reduce((sum, item) => {
      if (item.id !== productId || item.selectedSize !== selectedSize || item.cartKey === excludingCartKey) return sum;
      return sum + Number(item.quantity || 0);
    }, 0);

  const getProductSizeStock = (product, selectedSize) => {
    if (!selectedSize) return Number(product.stock || 0);
    const matchingSize = (product.sizeStocks || []).find((entry) => entry.size === selectedSize);
    if (matchingSize) return Number(matchingSize.stock || 0);
    return Number(product.stock || 0);
  };

  const getDefaultAvailableSize = (product) => {
    if (!product?.useSizeSelection) return '';
    if (Array.isArray(product.sizeStocks) && product.sizeStocks.length > 0) {
      return product.sizeStocks.find((entry) => Number(entry.stock || 0) > 0)?.size || product.sizeStocks[0]?.size || '';
    }
    return product.availableSizes?.[0] || '';
  };

  const getLinkedProducts = (product) => {
    const linkedIds = new Set(product?.linkedProductIds || []);
    return products.filter((item) => linkedIds.has(item.id));
  };

  getLinkedProductsRef.current = getLinkedProducts;

  const openLinkedProductsModal = useCallback((product, barcode = '') => {
    if (!product) return;
    setScannerResult({ type: 'found', product });
    setScannedBarcode(String(barcode || product.barcode || '').trim());
    setManualBarcode(String(barcode || product.barcode || '').trim());
    setScannerStatus(`Productos conectados para ${product.name}`);
    setScannerError('');
    setShowScannerModal(true);
  }, []);

  const needsSaleConfiguration = (product) =>
    product.unitType === 'feet' || (product.useSizeSelection && (product.availableSizes || []).length > 0);

  const closeProductConfigModal = () => {
    setPendingProductConfig(null);
    setPendingSaleSize('');
    setPendingSaleQuantity('1');
  };

  const addConfiguredProductToCart = (product, quantity, selectedSize = '') => {
    const normalizedQuantity = product.unitType === 'feet'
      ? Number(quantity)
      : Math.round(Number(quantity));

    if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
      showNotification('error', product.unitType === 'feet' ? 'Indica los pies a vender' : 'Cantidad inválida');
      return false;
    }

    if (product.useSizeSelection && (product.availableSizes || []).length > 0 && !selectedSize) {
      showNotification('error', 'Selecciona una talla');
      return false;
    }

    const availableStock = selectedSize
      ? getProductSizeStock(product, selectedSize)
      : Number(product.stock || 0);
    const existingQuantity = selectedSize
      ? getProductSizeQuantityInCart(product.id, selectedSize)
      : getProductQuantityInCart(product.id);

    if (existingQuantity + normalizedQuantity > availableStock) {
      const linkedProducts = getLinkedProducts(product);
      if (linkedProducts.length > 0) {
        showNotification('warning', `${product.name} no tiene stock, pero tiene productos conectados.`);
        openLinkedProductsModal(product);
      } else {
        showNotification('error', 'No hay suficiente stock disponible');
      }
      return false;
    }

    const cartKey = getCartItemKey(product.id, selectedSize);
    setCart(prevCart => {
      const existing = prevCart.find((item) => item.cartKey === cartKey);
      if (existing) {
        return prevCart.map(item =>
          item.cartKey === cartKey
            ? { ...item, quantity: item.quantity + normalizedQuantity }
            : item
        );
      }

      return [
        ...prevCart,
        {
          ...product,
          cartKey,
          selectedSize,
          quantity: normalizedQuantity,
          discount: DEFAULT_ITEM_DISCOUNT
        }
      ];
    });
    showNotification('success', `${product.name} agregado al carrito`);
    return true;
  };

  const addToCart = (product) => {
    if (needsSaleConfiguration(product)) {
      setPendingProductConfig(product);
      setPendingSaleSize(getDefaultAvailableSize(product));
      setPendingSaleQuantity(product.unitType === 'feet' ? '1' : '1');
      return false;
    }

    return addConfiguredProductToCart(product, 1);
  };

  addToCartRef.current = addToCart;

  const updateQuantity = (cartKey, delta) => {
    setCart(prevCart => {
      return prevCart.map(item => {
        if (item.cartKey === cartKey) {
          const nextQuantity = item.unitType === 'feet'
            ? Number((item.quantity + delta).toFixed(2))
            : item.quantity + delta;
          const newQuantity = item.unitType === 'feet' ? Math.max(0, nextQuantity) : nextQuantity;
          if (newQuantity <= 0) return null;
          const availableStock = item.selectedSize
            ? getProductSizeStock(item, item.selectedSize)
            : Number(item.stock || 0);
          const otherQuantity = item.selectedSize
            ? getProductSizeQuantityInCart(item.id, item.selectedSize, cartKey)
            : getProductQuantityInCart(item.id, cartKey);
          if (otherQuantity + newQuantity > availableStock) {
            showNotification('error', 'No hay suficiente stock disponible');
            return item;
          }
          return { ...item, quantity: newQuantity };
        }
        return item;
      }).filter(Boolean);
    });
  };

  const updateQuantityDirect = (cartKey, rawValue) => {
    const nextValue = Number(rawValue);
    if (!Number.isFinite(nextValue)) return;

    setCart((prevCart) =>
      prevCart.map((item) => {
        if (item.cartKey !== cartKey) return item;
        const newQuantity = item.unitType === 'feet' ? nextValue : Math.round(nextValue);
        const availableStock = item.selectedSize
          ? getProductSizeStock(item, item.selectedSize)
          : Number(item.stock || 0);
        const otherQuantity = item.selectedSize
          ? getProductSizeQuantityInCart(item.id, item.selectedSize, cartKey)
          : getProductQuantityInCart(item.id, cartKey);
        if (newQuantity <= 0 || otherQuantity + newQuantity > availableStock) {
          return item;
        }
        return { ...item, quantity: newQuantity };
      })
    );
  };

  const removeFromCart = (cartKey) => {
    setCart(prevCart => prevCart.filter(item => item.cartKey !== cartKey));
  };

  const clearCart = () => {
    setCart([]);
  };

  const updateItemDiscount = (cartKey, field, value) => {
    setCart((prevCart) =>
      prevCart.map((item) => {
        if (item.cartKey !== cartKey) return item;
        return {
          ...item,
          discount: normalizeItemDiscount({
            ...item.discount,
            [field]: value
          })
        };
      })
    );
  };

  const cartPricing = useMemo(
    () => cart.map((item) => ({ ...item, pricing: calculateItemPricing(item) })),
    [cart]
  );
  const subtotal = cartPricing.reduce((sum, item) => sum + item.pricing.subtotal, 0);
  const discountAmount = cartPricing.reduce((sum, item) => sum + item.pricing.discountAmount, 0);
  const taxableAmount = cartPricing.reduce((sum, item) => sum + item.pricing.taxableSubtotal, 0);
  const taxSummary = cartPricing.reduce(
    (summary, item) => ({
      state: summary.state + item.pricing.stateTax,
      municipal: summary.municipal + item.pricing.municipalTax
    }),
    { state: 0, municipal: 0 }
  );
  const tax = taxSummary.state + taxSummary.municipal;
  const total = taxableAmount + tax;

  const showNotification = (type, message) => {
    setNotification({ type, message, id: Date.now() });
  };

  showNotificationRef.current = showNotification;

  const resetPaymentState = useCallback(() => {
    setSelectedPaymentMethod('');
    setCashReceived('');
    setPaymentReference('');
    setSplitPayments([{ ...DEFAULT_SPLIT_PAYMENT }]);
    setIsProcessingPayment(false);
  }, []);

  const refreshFirestoreStatus = useCallback(async (force = false) => {
    const status = await verifyFirestoreAvailability({ force });
    setFirestoreReady(status.ok);
    return status.ok;
  }, []);

  const latestStoreLog = useMemo(
    () => [...storeStatusLogs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null,
    [storeStatusLogs]
  );

  const isStoreOpen = Boolean(latestStoreLog && latestStoreLog.action === 'open');

  const checkoutBlockReason = useMemo(() => {
    if (!isStoreOpen) {
      return 'La tienda debe estar abierta antes de cobrar.';
    }

    if (!firestoreReady) {
      return 'Firestore no esta disponible. El POS no permitira cobros hasta que vuelva a responder.';
    }

    return '';
  }, [firestoreReady, isStoreOpen]);

  const ensureCheckoutReady = useCallback(async () => {
    if (!isStoreOpen) {
      showNotification('error', 'Primero abre la tienda antes de cobrar.');
      return false;
    }

    const firestoreAvailable = await refreshFirestoreStatus(true);
    if (!firestoreAvailable) {
      showNotification('error', 'Firestore no esta disponible. No se puede cobrar para evitar perder ventas.');
      return false;
    }

    return true;
  }, [isStoreOpen, refreshFirestoreStatus]);

  const handleOpenPaymentModal = async () => {
    if (cart.length === 0) {
      showNotification('error', 'El carrito está vacío');
      return;
    }

    const canCharge = await ensureCheckoutReady();
    if (!canCharge) {
      return;
    }

    resetPaymentState();
    setShowPaymentModal(true);
  };

  const handleClosePaymentModal = () => {
    if (isProcessingPayment) return;
    setShowPaymentModal(false);
    resetPaymentState();
  };

  useEffect(() => {
    refreshFirestoreStatus();
    const unsubscribe = subscribeStoreStatusLogs(
      (rows) => setStoreStatusLogs(rows || []),
      (error) => {
        console.error('Error subscribing store status logs in POS:', error);
      }
    );

    return () => unsubscribe();
  }, [refreshFirestoreStatus]);

  useEffect(() => {
    if (cart.length > 0 || isProcessingPayment || !showPaymentModal) return;
    setShowPaymentModal(false);
    resetPaymentState();
  }, [cart.length, isProcessingPayment, resetPaymentState, showPaymentModal]);

  const stopScanner = () => {
    if (scannerIntervalRef.current) {
      clearInterval(scannerIntervalRef.current);
      scannerIntervalRef.current = null;
    }

    if (scannerStreamRef.current) {
      scannerStreamRef.current.getTracks().forEach((track) => track.stop());
      scannerStreamRef.current = null;
    }
  };

  stopScannerRef.current = stopScanner;

  const closeScannerModal = () => {
    stopScanner();
    setShowScannerModal(false);
    setScannerStatus('Listo para escanear');
    setScannerError('');
    setScannedBarcode('');
    setScannerResult(null);
    setManualBarcode('');
  };

  const isEditableTarget = (target) => {
    if (!target) return false;
    const tagName = target.tagName?.toLowerCase();
    return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
  };

  const resolveScannedBarcode = useCallback((barcode, options = {}) => {
    const {
      autoAdd = false,
      silentNotFound = false,
      openResultModalOnNotFound = false
    } = options;
    const normalizedBarcode = String(barcode || '').trim();
    if (!normalizedBarcode) return;

    stopScannerRef.current?.();
    setScannedBarcode(normalizedBarcode);
    setManualBarcode(normalizedBarcode);
    const foundProduct = products.find(
      (product) => String(product.barcode || '').trim() === normalizedBarcode
    );

    if (foundProduct) {
      const linkedProducts = getLinkedProductsRef.current?.(foundProduct) || [];

      if (autoAdd) {
        const added = addToCartRef.current?.(foundProduct);
        if (added) {
          if (linkedProducts.length > 0) {
            setScannerResult({ type: 'found', product: foundProduct });
            setScannerStatus(`Producto agregado: ${foundProduct.name}. Tiene productos conectados.`);
          } else {
            setScannerStatus(`Producto agregado: ${foundProduct.name}`);
          }
        }
        return;
      }

      setScannerResult({ type: 'found', product: foundProduct });
      setScannerStatus(`Producto encontrado: ${foundProduct.name}`);
      return;
    }

    if (silentNotFound) {
      showNotificationRef.current?.('warning', `No existe un producto con el código ${normalizedBarcode}`);
      if (openResultModalOnNotFound) {
        setScannerResult({ type: 'not_found', barcode: normalizedBarcode });
        setScannerStatus(`No existe un producto con código ${normalizedBarcode}`);
        setShowScannerModal(true);
      }
      return;
    }

    setScannerResult({ type: 'not_found', barcode: normalizedBarcode });
    setScannerStatus(`No existe un producto con código ${normalizedBarcode}`);
  }, [products]);

  useScannerKeyboardInput({
    enabled: !isMobileDevice,
    onScan: (barcode) => {
      setKeyboardScannerDetected(true);
      resolveScannedBarcode(
        barcode,
        showScannerModal
          ? { autoAdd: false }
          : { autoAdd: true, silentNotFound: true, openResultModalOnLinked: true, openResultModalOnNotFound: true }
      );
    },
    keepLastBufferedValue: true,
    shouldIgnoreEvent: (event) => !showScannerModal && isEditableTarget(event.target),
    onBufferChange: (nextBuffer) => {
      if (!showScannerModal) return;
      setManualBarcode(nextBuffer);
      setScannerError('');
      setScannerStatus(nextBuffer ? 'Leyendo scanner USB...' : 'Esperando lectura del scanner USB...');
    }
  });

  useEffect(() => {
    if (!showScannerModal) return undefined;

    refreshDevices();

    if (!isMobileDevice) {
      stopScanner();
      setScannerError('');
      setScannerStatus(scannerReady ? 'Scanner USB conectado. Esperando lectura...' : 'Esperando lectura del scanner USB...');
      return undefined;
    }

    const runScanner = async () => {
      if (!window.isSecureContext) {
        setScannerError('La cámara del navegador requiere abrir el sistema por HTTPS o localhost.');
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setScannerError('Este navegador no expone acceso directo a cámara. Intenta en Chrome/Safari normal o usa el código manual.');
        return;
      }

      if (typeof window.BarcodeDetector === 'undefined') {
        setScannerError('Este navegador no soporta escaneo de barcode en vivo. Puedes escribir o pegar el código manualmente.');
        return;
      }

      try {
        const BarcodeDetectorCtor = window.BarcodeDetector;
        const supportedFormats = BarcodeDetectorCtor.getSupportedFormats
          ? await BarcodeDetectorCtor.getSupportedFormats()
          : [];
        const preferredFormats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'codabar'];
        const formats = supportedFormats.length > 0
          ? preferredFormats.filter((format) => supportedFormats.includes(format))
          : preferredFormats;
        const detector = new BarcodeDetectorCtor({ formats: formats.length > 0 ? formats : undefined });

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' }
          },
          audio: false
        });

        scannerStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setScannerStatus('Escaneando barcode...');
        setScannerError('');

        scannerIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;

          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              const detectedCode = barcodes[0]?.rawValue;
              if (detectedCode) {
                resolveScannedBarcode(detectedCode);
              }
            }
          } catch (error) {
            console.error('Error detecting barcode:', error);
          }
        }, 500);
      } catch (error) {
        console.error('Error starting camera scanner:', error);
        if (error?.name === 'NotAllowedError') {
          setScannerError('No se concedió permiso a la cámara.');
        } else if (error?.name === 'NotFoundError') {
          setScannerError('No se encontró una cámara disponible.');
        } else if (error?.name === 'NotReadableError') {
          setScannerError('La cámara está siendo usada por otra aplicación.');
        } else {
          setScannerError('No se pudo iniciar la cámara para escanear.');
        }
        stopScanner();
      }
    };

    runScanner();
    return () => stopScanner();
  }, [isMobileDevice, refreshDevices, resolveScannedBarcode, scannerReady, showScannerModal]);

  const finalizePayment = async (paymentEntries, options = {}) => {
    if (cart.length === 0) {
      showNotification('error', 'El carrito está vacío');
      return;
    }

    const canCharge = await ensureCheckoutReady();
    if (!canCharge) {
      return;
    }

    setIsProcessingPayment(true);
    const data = loadData();
    const saleId = paymentEntries[0]?.transaction_id || generateId('sale');
    const cashier = profile?.name || user?.email || data.currentUser.name;
    const cashierId = user?.uid || data.currentUser.id;
    const sale = buildTransactionRecord({
      saleId,
      cart: cartPricing,
      subtotal,
      discountAmount,
      tax,
      taxSummary,
      total,
      cashier,
      cashierId,
      paymentEntries
    });

    try {
      await commitSaleTransaction({
        sale,
        paymentEntries,
        cartItems: cart,
        updatedBy: sharedCartEditor
      });

      const updatedProducts = data.products.map(product => {
        const matchingCartItems = cart.filter((item) => item.id === product.id);
        if (matchingCartItems.length === 0) return product;

        const soldQuantity = matchingCartItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const nextProduct = {
          ...product,
          stock: Number(product.stock || 0) - soldQuantity
        };

        if (Array.isArray(product.sizeStocks) && product.sizeStocks.length > 0) {
          nextProduct.sizeStocks = product.sizeStocks.map((entry) => {
            const soldForSize = matchingCartItems.reduce((sum, item) => (
              item.selectedSize === entry.size ? sum + Number(item.quantity || 0) : sum
            ), 0);
            return {
              ...entry,
              stock: Math.max(0, Number(entry.stock || 0) - soldForSize)
            };
          });
        }

        return nextProduct;
      });

      data.sales.unshift(sale);
      data.payments = [...paymentEntries, ...(data.payments || [])];
      data.products = updatedProducts;
      saveData(data);
      upsertWeeklyCachedSale(sale);

      if (options.openDrawer) {
        openCashDrawer();
      }

      setLastSale(sale);
      setCart([]);
      setShowPaymentModal(false);
      setShowReceiptModal(true);
      setSelectedPrintDocument('receipt');
      resetPaymentState();
      setFirestoreReady(true);
      showNotification('success', options.successMessage || 'Pago confirmado y transaccion guardada.');
    } catch (error) {
      console.error('Error finalizing payment:', error);
      setFirestoreReady(false);
      showNotification(
        'error',
        options.failureMessage || 'No se pudo completar el pago porque Firestore fallo. La venta no fue confirmada.'
      );
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const handleCashPayment = async () => {
    const receivedAmount = Number(cashReceived);

    if (!Number.isFinite(receivedAmount) || receivedAmount < total) {
      showNotification('error', 'Ingresa un monto recibido igual o mayor al total.');
      return;
    }

    const changeDue = receivedAmount - total;
    const cashier = profile?.name || user?.email || loadData().currentUser.name;
    const transactionId = generateId('sale');
    const paymentEntries = [
      buildPaymentEntry({
        transactionId,
        method: PAYMENT_METHODS.cash,
        amount: total,
        confirmedBy: cashier,
        reference: paymentReference,
        amountReceived: receivedAmount,
        changeDue
      })
    ];

    await finalizePayment(
      paymentEntries,
      {
        openDrawer: true,
        successMessage: 'Pago en efectivo guardado. El cambio esta listo y la gaveta se abrio.',
        warningMessage: 'Pago en efectivo guardado localmente, pero fallo la sincronizacion con Firestore.'
      }
    );
  };

  const handleCardPayment = async () => {
    const cashier = profile?.name || user?.email || loadData().currentUser.name;
    const transactionId = generateId('sale');
    const paymentEntries = [
      buildPaymentEntry({
        transactionId,
        method: PAYMENT_METHODS.card,
        amount: total,
        confirmedBy: cashier,
        reference: paymentReference
      })
    ];

    await finalizePayment(
      paymentEntries,
      {
        successMessage: 'Pago con tarjeta confirmado y transaccion guardada.',
        warningMessage: 'Pago con tarjeta confirmado localmente, pero fallo la sincronizacion con Firestore.'
      }
    );
  };

  const handleAthMovilPayment = async () => {
    const cashier = profile?.name || user?.email || loadData().currentUser.name;
    const transactionId = generateId('sale');
    const paymentEntries = [
      buildPaymentEntry({
        transactionId,
        method: PAYMENT_METHODS.athMovil,
        amount: total,
        confirmedBy: cashier,
        reference: paymentReference
      })
    ];

    await finalizePayment(
      paymentEntries,
      {
        successMessage: 'Pago por ATH Movil confirmado y transaccion guardada.',
        warningMessage: 'Pago por ATH Movil confirmado localmente, pero fallo la sincronizacion con Firestore.'
      }
    );
  };

  const updateSplitPayment = (index, field, value) => {
    setSplitPayments((current) => current.map((payment, paymentIndex) => {
      if (paymentIndex !== index) return payment;

      const nextPayment = {
        ...payment,
        [field]: value
      };

      if (field === 'method' && value !== PAYMENT_METHODS.cash) {
        nextPayment.cashReceived = '';
      }

      return nextPayment;
    }));
  };

  const addSplitPaymentRow = () => {
    setSplitPayments((current) => [...current, { ...DEFAULT_SPLIT_PAYMENT, method: PAYMENT_METHODS.card }]);
  };

  const removeSplitPaymentRow = (index) => {
    setSplitPayments((current) => current.filter((_, paymentIndex) => paymentIndex !== index));
  };

  const splitAmountTotal = useMemo(
    () => splitPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    [splitPayments]
  );
  const splitRemaining = Math.max(total - splitAmountTotal, 0);

  const handleSplitPayment = async () => {
    if (splitPayments.length < 2) {
      showNotification('error', 'Agrega al menos dos metodos para usar split.');
      return;
    }

    const cashier = profile?.name || user?.email || loadData().currentUser.name;
    const transactionId = generateId('sale');
    const paymentEntries = [];

    for (let index = 0; index < splitPayments.length; index += 1) {
      const payment = splitPayments[index];
      const amount = Number(payment.amount || 0);

      if (!payment.method || payment.method === PAYMENT_METHODS.split) {
        showNotification('error', `Selecciona un metodo valido en la linea ${index + 1}.`);
        return;
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        showNotification('error', `Ingresa un monto valido en la linea ${index + 1}.`);
        return;
      }

      const isCashPayment = payment.method === PAYMENT_METHODS.cash;
      const receivedAmount = Number(payment.cashReceived || 0);

      if (isCashPayment && (!Number.isFinite(receivedAmount) || receivedAmount < amount)) {
        showNotification('error', `El efectivo recibido en la linea ${index + 1} debe cubrir el monto de esa linea.`);
        return;
      }

      paymentEntries.push(buildPaymentEntry({
        transactionId,
        method: payment.method,
        amount,
        confirmedBy: cashier,
        reference: payment.reference,
        amountReceived: isCashPayment ? receivedAmount : null,
        changeDue: isCashPayment ? Math.max(receivedAmount - amount, 0) : null
      }));
    }

    if (Math.abs(splitAmountTotal - total) > 0.009) {
      showNotification('error', 'La suma del split debe ser igual al total de la venta.');
      return;
    }

    await finalizePayment(
      paymentEntries,
      {
        openDrawer: paymentEntries.some((payment) => payment.method === PAYMENT_METHODS.cash),
        successMessage: 'Pago split confirmado y transaccion guardada.'
      }
    );
  };

  const getAssignedPrinter = (documentType) => {
    const data = loadData();
    const store = {
      ...(data.store || {}),
      ...normalizePrintSettings(data.store || {})
    };
    const printerId = documentType === 'invoice'
      ? store.printRouting.invoicePrinterId
      : store.printRouting.receiptPrinterId;

    return (store.printers || []).find((printer) => printer.id === printerId) || null;
  };

  const handlePrintDocument = async (documentType) => {
    setSelectedPrintDocument(documentType);
    const assignedPrinter = getAssignedPrinter(documentType);
    if (assignedPrinter) {
      showNotification(
        'info',
        `Imprimiendo ${documentType === 'invoice' ? 'factura' : 'recibo'} por ${assignedPrinter.name}`
      );
    } else {
      showNotification(
        'warning',
        `No hay impresora asignada para ${documentType === 'invoice' ? 'factura' : 'recibo'}`
      );
    }
    if (!lastSale) return;

    try {
      await printHtmlDocument({
        title: `${documentType === 'invoice' ? 'Factura' : 'Recibo'} ${lastSale.id}`,
        html: buildSalePrintHtml({
          sale: lastSale,
          documentType,
          printerName: assignedPrinter?.name || ''
        }),
        printer: assignedPrinter
      });

      showNotification(
        'success',
        `${documentType === 'invoice' ? 'Factura' : 'Recibo'} abierto en el dialogo de impresion`
      );
    } catch (error) {
      console.error(error);
      showNotification('error', 'No se pudo abrir la impresión.');
    }
  };

  const storeInfo = {
    ...(loadData().store || {}),
    ...normalizePrintSettings(loadData().store || {})
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Products Section */}
        <div className="lg:col-span-2">
          <div className="card p-6">
            {/* Search and Filter */}
            <div className="flex flex-col md:flex-row gap-4 mb-6">
              <div className="flex-1 relative">
                <Search size={20} className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar por nombre, SKU o código..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input w-full pl-10"
                />
              </div>
              <button
                onClick={() => setShowScannerModal(true)}
                className="btn btn-primary flex items-center gap-2"
              >
                <Barcode size={20} />
                <span className="hidden md:inline">{isMobileDevice ? 'Escanear con cámara' : 'Escanear con scanner'}</span>
              </button>
              <button
                onClick={onOpenSpecialOrders}
                className="btn btn-secondary flex items-center gap-2"
              >
                <ShoppingCart size={20} />
                <span className="hidden md:inline">Pedido especial</span>
              </button>
            </div>

            {/* Categories */}
            <div className="flex flex-wrap gap-2 mb-6">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  selectedCategory === 'all'
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                Todos
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={`px-4 py-2 rounded-lg transition-colors ${
                    selectedCategory === category.id
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>

            {/* Products Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {visibleProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => addToCart(product)}
                  disabled={product.stock <= 0}
                  className={`card p-4 text-left transition-all hover:shadow-lg hover:border-primary-300 ${
                    product.stock <= 0 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  <div className="w-full h-20 bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg mb-3 flex items-center justify-center">
                    <span className="text-3xl">📦</span>
                  </div>
                  <h4 className="font-medium text-sm text-gray-900 truncate">{product.name}</h4>
                  <p className="text-xs text-gray-500 mb-1">{product.category}</p>
                  <p className="text-lg font-bold text-primary-600">{formatCurrency(product.price)}</p>
                  {product.unitType === 'feet' && (
                    <p className="text-xs text-blue-600">Venta por pie</p>
                  )}
                  {product.useSizeSelection && (product.availableSizes || []).length > 0 && (
                    <p className="text-xs text-purple-600 truncate">
                      Tallas: {(product.sizeStocks || []).length > 0
                        ? product.sizeStocks.map((entry) => `${entry.size} (${entry.stock})`).join(', ')
                        : product.availableSizes.join(', ')}
                    </p>
                  )}
                  <p className={`text-xs ${product.stock <= product.lowStockThreshold ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                    {product.stock <= 0 ? 'Sin stock' : `${formatQuantity(product.stock, product.unitType)} en stock`}
                  </p>
                </button>
              ))}
            </div>

            {filteredProducts.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <Search size={48} className="mx-auto mb-2" />
                <p>No se encontraron productos</p>
              </div>
            )}

            {filteredProducts.length > 0 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-xs text-gray-500">
                  Mostrando {(productsPage - 1) * POS_PAGE_SIZE + 1} - {Math.min(productsPage * POS_PAGE_SIZE, filteredProducts.length)} de {filteredProducts.length}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setProductsPage((p) => Math.max(1, p - 1))}
                    disabled={productsPage === 1}
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setProductsPage((p) => Math.min(posTotalPages, p + 1))}
                    disabled={productsPage === posTotalPages}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Cart Section */}
        <div className="lg:col-span-1">
          <div className="card p-6 sticky top-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <ShoppingCart size={20} />
                Carrito
              </h3>
              {cart.length > 0 && (
                <button
                  onClick={clearCart}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Limpiar
                </button>
              )}
            </div>

            <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <p className="font-medium">
                Carrito compartido en tiempo real
                {cartSyncStatus === 'synced' ? ' conectado' : cartSyncStatus === 'offline' ? ' en modo local' : ' conectando'}
              </p>
              <div className="mt-1 space-y-1 break-all">
                <p>Terminal: {terminalId}</p>
                {sharedCartMeta?.updatedByName && (
                  <p>Último cambio por {sharedCartMeta.updatedByName}</p>
                )}
              </div>
            </div>

            {cart.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <ShoppingCart size={48} className="mx-auto mb-3" />
                <p>Carrito vacío</p>
                <p className="text-sm">Agrega productos para continuar</p>
              </div>
            ) : (
              <>
                {/* Cart Items */}
                <div className="space-y-3 max-h-64 overflow-y-auto mb-4">
                  {cartPricing.map((item) => (
                    <div key={item.cartKey} className="rounded-lg bg-gray-50 p-3">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm">{item.name}</p>
                        {item.selectedSize && (
                          <p className="text-xs text-purple-600">Talla: {item.selectedSize}</p>
                        )}
                        {getLinkedProducts(item).length > 0 && (
                          <button
                            type="button"
                            onClick={() => openLinkedProductsModal(item)}
                            className="mt-1 text-xs text-blue-600 hover:underline"
                          >
                            Tiene productos conectados
                          </button>
                        )}
                        <p className="text-xs text-gray-500">
                          {item.unitType === 'feet' ? `${formatCurrency(item.price)} por pie` : `${formatCurrency(item.price)} c/u`}
                        </p>
                        </div>
                        <button
                          onClick={() => removeFromCart(item.cartKey)}
                          className="shrink-0 text-red-500 hover:text-red-700"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <button
                            onClick={() => updateQuantity(item.cartKey, -1)}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-gray-200 hover:bg-gray-300"
                          >
                            <Minus size={14} />
                          </button>
                          {item.unitType === 'feet' ? (
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              value={item.quantity}
                              onChange={(e) => updateQuantityDirect(item.cartKey, e.target.value)}
                              className="input w-16 min-w-0 py-1 px-2 text-center"
                            />
                          ) : (
                            <span className="w-8 text-center font-medium">{item.quantity}</span>
                          )}
                          <button
                            onClick={() => updateQuantity(item.cartKey, 1)}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-gray-200 hover:bg-gray-300"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <div className="shrink-0 text-right text-sm">
                          {item.pricing.discountAmount > 0 && (
                            <p className="text-green-600">Desc. -{formatCurrency(item.pricing.discountAmount)}</p>
                          )}
                          <p className="font-bold">{formatCurrency(item.pricing.taxableSubtotal)}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex min-w-0 items-center gap-2">
                        <select
                          value={item.discount?.type || DEFAULT_ITEM_DISCOUNT.type}
                          onChange={(e) => updateItemDiscount(item.cartKey, 'type', e.target.value)}
                          className="input w-16 shrink-0 text-sm"
                        >
                          <option value="percentage">%</option>
                          <option value="fixed">$</option>
                        </select>
                        <input
                          type="number"
                          value={item.discount?.value ?? 0}
                          onChange={(e) => updateItemDiscount(item.cartKey, 'value', e.target.value)}
                          placeholder="Descuento por producto"
                          className="input min-w-0 flex-1"
                          min="0"
                          step="0.01"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div className="border-t pt-4 space-y-2">
                  <div className="flex justify-between text-gray-600">
                    <span>Subtotal:</span>
                    <span>{formatCurrency(subtotal)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>Descuento:</span>
                      <span>-{formatCurrency(discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-gray-600">
                    <span>IVU Estatal (10.5%):</span>
                    <span>{formatCurrency(taxSummary.state)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>IVU Municipal (1%):</span>
                    <span>{formatCurrency(taxSummary.municipal)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>IVU Total:</span>
                    <span>{formatCurrency(tax)}</span>
                  </div>
                  <div className="flex justify-between text-xl font-bold pt-2 border-t">
                    <span>Total:</span>
                    <span className="text-green-600">{formatCurrency(total)}</span>
                  </div>
                </div>

                {/* Checkout Button */}
                <button
                  onClick={handleOpenPaymentModal}
                  className="w-full mt-4 py-3 btn btn-success flex items-center justify-center gap-2"
                  disabled={Boolean(checkoutBlockReason)}
                >
                  <CreditCard size={20} />
                  {checkoutBlockReason ? 'Cobro bloqueado' : 'Cobrar'}
                </button>
                {checkoutBlockReason && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {checkoutBlockReason}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      <Modal
        isOpen={showPaymentModal}
        onClose={handleClosePaymentModal}
        title="Cobro"
      >
        <div className="space-y-4">
          {checkoutBlockReason && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {checkoutBlockReason}
            </div>
          )}

          <div className="text-center mb-6">
            <p className="text-gray-500">Total a pagar</p>
            <p className="text-4xl font-bold text-green-600">{formatCurrency(total)}</p>
          </div>

          {!selectedPaymentMethod && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <button
                  onClick={() => setSelectedPaymentMethod(PAYMENT_METHODS.cash)}
                  className="card p-6 hover:bg-green-50 hover:border-green-300 text-center transition-colors"
                  disabled={Boolean(checkoutBlockReason)}
                >
                  <Banknote size={32} className="mx-auto mb-2 text-green-600" />
                  <p className="font-medium">Efectivo</p>
                </button>
                <button
                  onClick={() => setSelectedPaymentMethod(PAYMENT_METHODS.card)}
                  className="card p-6 hover:bg-blue-50 hover:border-blue-300 text-center transition-colors"
                  disabled={Boolean(checkoutBlockReason)}
                >
                  <CreditCard size={32} className="mx-auto mb-2 text-blue-600" />
                  <p className="font-medium">Tarjeta</p>
                </button>
                <button
                  onClick={() => setSelectedPaymentMethod(PAYMENT_METHODS.athMovil)}
                  className="card p-6 hover:bg-purple-50 hover:border-purple-300 text-center transition-colors"
                  disabled={Boolean(checkoutBlockReason)}
                >
                  <Smartphone size={32} className="mx-auto mb-2 text-purple-600" />
                  <p className="font-medium">ATH Móvil</p>
                </button>
                <button
                  onClick={() => {
                    setSplitPayments([
                      { ...DEFAULT_SPLIT_PAYMENT, method: PAYMENT_METHODS.cash },
                      { ...DEFAULT_SPLIT_PAYMENT, method: PAYMENT_METHODS.card }
                    ]);
                    setSelectedPaymentMethod(PAYMENT_METHODS.split);
                  }}
                  className="card p-6 hover:bg-amber-50 hover:border-amber-300 text-center transition-colors"
                  disabled={Boolean(checkoutBlockReason)}
                >
                  <CreditCard size={32} className="mx-auto mb-2 text-amber-600" />
                  <p className="font-medium">Split</p>
                </button>
              </div>

              <button
                onClick={handleClosePaymentModal}
                className="w-full btn btn-secondary mt-4"
              >
                Cancelar
              </button>
            </>
          )}

          {selectedPaymentMethod === PAYMENT_METHODS.cash && (
            <div className="space-y-4">
              <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                <p className="font-medium text-green-800">Pago en efectivo</p>
                <p className="text-sm text-green-700">Ingresa el monto recibido para calcular el cambio y completar la venta.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Monto recibido</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  className="input w-full"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Referencia (opcional)</label>
                <input
                  type="text"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  className="input w-full"
                  placeholder="Nota o referencia del recibo"
                />
              </div>

              <div className="rounded-lg bg-gray-50 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Total</span>
                  <span>{formatCurrency(total)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Recibido</span>
                  <span>{formatCurrency(Number(cashReceived || 0))}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Cambio</span>
                  <span className="text-green-600">
                    {formatCurrency(Math.max(Number(cashReceived || 0) - total, 0))}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedPaymentMethod('')}
                  className="flex-1 btn btn-secondary"
                  disabled={isProcessingPayment}
                >
                  Atras
                </button>
                <button
                  onClick={handleCashPayment}
                  className="flex-1 btn btn-success"
                  disabled={isProcessingPayment || Boolean(checkoutBlockReason)}
                >
                  Confirmar pago en efectivo
                </button>
              </div>
            </div>
          )}

          {selectedPaymentMethod === PAYMENT_METHODS.card && (
            <div className="space-y-4">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="font-medium text-blue-800">Cobra al cliente usando la terminal Clover.</p>
                <p className="text-sm text-blue-700">Confirma solo cuando la terminal muestre Aprobado.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Referencia de la terminal (opcional)</label>
                <input
                  type="text"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  className="input w-full"
                  placeholder="Codigo de aprobacion o ultimos 4 digitos"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedPaymentMethod('')}
                  className="flex-1 btn btn-secondary"
                  disabled={isProcessingPayment}
                >
                  Atras
                </button>
                <button
                  onClick={handleCardPayment}
                  className="flex-1 btn btn-primary"
                  disabled={isProcessingPayment || Boolean(checkoutBlockReason)}
                >
                  Confirmar pago con tarjeta
                </button>
              </div>
            </div>
          )}

          {selectedPaymentMethod === PAYMENT_METHODS.athMovil && (
            <div className="space-y-4">
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
                <p className="font-medium text-purple-800">Pidele al cliente que envie el pago por ATH Movil.</p>
                <p className="text-sm text-purple-700">Verifica el pago en el telefono del negocio antes de confirmarlo aqui.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Referencia (opcional)</label>
                <input
                  type="text"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  className="input w-full"
                  placeholder="Referencia o nota de ATH"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedPaymentMethod('')}
                  className="flex-1 btn btn-secondary"
                  disabled={isProcessingPayment}
                >
                  Atras
                </button>
                <button
                  onClick={handleAthMovilPayment}
                  className="flex-1 btn btn-primary"
                  disabled={isProcessingPayment || Boolean(checkoutBlockReason)}
                >
                  Confirmar pago ATH
                </button>
              </div>
            </div>
          )}

          {selectedPaymentMethod === PAYMENT_METHODS.split && (
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="font-medium text-amber-800">Pago split</p>
                <p className="text-sm text-amber-700">Divide el total entre dos o mas metodos. La suma debe ser exacta.</p>
              </div>

              <div className="space-y-3">
                {splitPayments.map((payment, index) => (
                  <div key={`split_${index}`} className="rounded-lg border border-gray-200 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-sm text-gray-800">Pago {index + 1}</p>
                      {splitPayments.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeSplitPaymentRow(index)}
                          className="text-sm text-red-600 hover:text-red-700"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Metodo</label>
                        <select
                          value={payment.method}
                          onChange={(e) => updateSplitPayment(index, 'method', e.target.value)}
                          className="input w-full"
                        >
                          <option value={PAYMENT_METHODS.cash}>Efectivo</option>
                          <option value={PAYMENT_METHODS.card}>Tarjeta</option>
                          <option value={PAYMENT_METHODS.athMovil}>ATH MÃ³vil</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Monto</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={payment.amount}
                          onChange={(e) => updateSplitPayment(index, 'amount', e.target.value)}
                          className="input w-full"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    {payment.method === PAYMENT_METHODS.cash && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Efectivo recibido</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={payment.cashReceived}
                          onChange={(e) => updateSplitPayment(index, 'cashReceived', e.target.value)}
                          className="input w-full"
                          placeholder="0.00"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Referencia (opcional)</label>
                      <input
                        type="text"
                        value={payment.reference}
                        onChange={(e) => updateSplitPayment(index, 'reference', e.target.value)}
                        className="input w-full"
                        placeholder="Nota, aprobacion o referencia"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addSplitPaymentRow}
                className="w-full btn btn-secondary"
                disabled={isProcessingPayment}
              >
                Agregar metodo
              </button>

              <div className="rounded-lg bg-gray-50 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Total</span>
                  <span>{formatCurrency(total)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Asignado</span>
                  <span>{formatCurrency(splitAmountTotal)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Restante</span>
                  <span className={splitRemaining > 0 ? 'text-amber-600' : 'text-green-600'}>
                    {formatCurrency(Math.max(total - splitAmountTotal, 0))}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedPaymentMethod('')}
                  className="flex-1 btn btn-secondary"
                  disabled={isProcessingPayment}
                >
                  Atras
                </button>
                <button
                  onClick={handleSplitPayment}
                  className="flex-1 btn btn-primary"
                  disabled={isProcessingPayment || Boolean(checkoutBlockReason)}
                >
                  Confirmar split
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(pendingProductConfig)}
        onClose={closeProductConfigModal}
        title="Configurar producto"
        size="md"
      >
        {pendingProductConfig && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="font-medium">{pendingProductConfig.name}</p>
              <p className="text-sm text-gray-500">
                {pendingProductConfig.unitType === 'feet'
                  ? `Precio por pie: ${formatCurrency(pendingProductConfig.price)}`
                  : `Precio: ${formatCurrency(pendingProductConfig.price)}`}
              </p>
            </div>

            {pendingProductConfig.useSizeSelection && (pendingProductConfig.availableSizes || []).length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Talla</label>
                <select
                  value={pendingSaleSize}
                  onChange={(e) => setPendingSaleSize(e.target.value)}
                  className="input w-full"
                >
                  <option value="">Selecciona una talla</option>
                  {pendingProductConfig.availableSizes.map((size) => (
                    <option
                      key={size}
                      value={size}
                      disabled={(pendingProductConfig.sizeStocks || []).length > 0 && getProductSizeStock(pendingProductConfig, size) <= 0}
                    >
                      {size}
                      {(pendingProductConfig.sizeStocks || []).length > 0
                        ? ` (${getProductSizeStock(pendingProductConfig, size)} disponibles)`
                        : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {pendingProductConfig.unitType === 'feet' ? 'Cantidad en pies' : 'Cantidad'}
              </label>
              <input
                type="number"
                step={pendingProductConfig.unitType === 'feet' ? '0.01' : '1'}
                min={pendingProductConfig.unitType === 'feet' ? '0.01' : '1'}
                value={pendingSaleQuantity}
                onChange={(e) => setPendingSaleQuantity(e.target.value)}
                className="input w-full"
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <button
                type="button"
                onClick={closeProductConfigModal}
                className="btn btn-secondary"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const added = addConfiguredProductToCart(
                    pendingProductConfig,
                    pendingSaleQuantity,
                    pendingSaleSize
                  );
                  if (added) closeProductConfigModal();
                }}
                className="btn btn-primary"
              >
                Agregar
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showScannerModal}
        onClose={closeScannerModal}
        title="Escanear código de barras"
        size="md"
      >
        <div className="space-y-4">
          {isMobileDevice ? (
            <div className="rounded-xl overflow-hidden border border-gray-200 bg-black">
              <video
                ref={videoRef}
                className="w-full h-72 object-cover"
                autoPlay
                playsInline
                muted
              />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-primary-300 bg-primary-50 p-6 text-center space-y-2">
              <Barcode size={32} className="mx-auto text-primary-600" />
              <p className="font-medium text-primary-900">
                {scannerConnectionLabel}
              </p>
              <p className="text-sm text-primary-700">
                {scannerConnectionHint}
              </p>
            </div>
          )}

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
            <p className="text-sm font-medium text-gray-800">{scannerStatus}</p>
            {scannedBarcode && (
              <p className="text-sm text-gray-600">Código leído: <span className="font-mono">{scannedBarcode}</span></p>
            )}
            {scannerError && (
              <p className="text-sm text-red-600">{scannerError}</p>
            )}
            <p className="text-xs text-gray-500">
              {isMobileDevice
                ? 'En celular se usa la cámara trasera para leer el código.'
                : 'En computadora se usa el scanner USB; también puedes escribir o pegar el código manualmente.'}
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            <label className="block text-sm font-medium text-gray-700">Código manual</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value)}
                placeholder="Escribe o pega el barcode"
                className="input flex-1"
              />
              <button
                type="button"
                onClick={() => resolveScannedBarcode(manualBarcode)}
                className="btn btn-secondary whitespace-nowrap"
              >
                Buscar
              </button>
            </div>
          </div>

          {scannerResult?.type === 'found' && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-3">
              <p className="font-medium text-green-800">Producto encontrado</p>
              <p className="text-sm text-green-700">{scannerResult.product.name}</p>
              {getLinkedProducts(scannerResult.product).length > 0 && (
                <div className="rounded-lg border border-green-100 bg-white/80 p-3">
                  <p className="text-sm font-medium text-gray-800 mb-2">Productos relacionados</p>
                  <div className="space-y-2">
                    {getLinkedProducts(scannerResult.product).map((linkedProduct) => (
                      <div key={linkedProduct.id} className="flex items-center justify-between gap-3 text-sm">
                        <div>
                          <p className="font-medium text-gray-800">{linkedProduct.name}</p>
                          <p className="text-xs text-gray-500">{linkedProduct.sku || linkedProduct.barcode || '-'}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => addToCart(linkedProduct)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Agregar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                {profile?.role !== 'cashier' && (
                  <button
                    type="button"
                    onClick={() => {
                      onEditProductFromScan(scannerResult.product.id);
                      closeScannerModal();
                    }}
                    className="btn btn-secondary"
                  >
                    Editar producto
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeScannerModal}
                  className="btn btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    addToCart(scannerResult.product);
                    closeScannerModal();
                  }}
                  className="btn btn-primary"
                >
                  Agregar al carrito
                </button>
              </div>
            </div>
          )}

          {scannerResult?.type === 'not_found' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
              <p className="font-medium text-amber-800">Ese producto no existe</p>
              <p className="text-sm text-amber-700">
                No se encontró un producto con el código <span className="font-mono">{scannerResult.barcode}</span>.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeScannerModal}
                  className="btn btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onCreateProductFromBarcode(scannerResult.barcode);
                    closeScannerModal();
                  }}
                  className="btn btn-primary"
                >
                  Agregar producto
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Receipt Modal */}
      <Modal
        isOpen={showReceiptModal}
        onClose={() => setShowReceiptModal(false)}
        title="Recibo de Venta"
        size="md"
      >
        {lastSale && (
          <div className="space-y-4">
            <div className="text-center border-b pb-4">
              <h3 className="text-xl font-bold">{storeInfo.name || 'CJ Marine'}</h3>
              <p className="text-gray-500 text-sm">{storeInfo.address || 'Carr 111 km 05'}</p>
              <p className="text-gray-500 text-sm">{storeInfo.cityStateZip || 'Aguadilla 00603'}</p>
              <p className="text-gray-500 text-sm">Tel: {storeInfo.phone || '939 200 8820'}</p>
            </div>

            <div className="text-sm text-gray-600">
              <p><strong>Recibo #:</strong> {lastSale.id.split('_')[1].toUpperCase()}</p>
              <p><strong>Fecha:</strong> {new Date(lastSale.date).toLocaleString()}</p>
              <p><strong>Cajero:</strong> {lastSale.cashier}</p>
            </div>

            <div className="border-t pt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Producto</th>
                    <th className="text-center py-2">Cant.</th>
                    <th className="text-right py-2">Precio</th>
                  </tr>
                </thead>
                <tbody>
                  {lastSale.items.map((item, index) => (
                    <tr key={index} className="border-b">
                      <td className="py-2">
                        <div>{item.name}</div>
                        {item.discountAmount > 0 && (
                          <div className="text-xs text-green-600">Desc. -{formatCurrency(item.discountAmount)}</div>
                        )}
                      </td>
                      <td className="text-center py-2">{formatQuantity(item.quantity, item.unitType)}</td>
                      <td className="text-right py-2">{formatCurrency(item.taxableSubtotal || item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t pt-4 space-y-1">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{formatCurrency(lastSale.subtotal)}</span>
              </div>
              {lastSale.discount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Descuentos:</span>
                  <span>-{formatCurrency(lastSale.discount)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>IVU Estatal (10.5%):</span>
                <span>{formatCurrency(lastSale.taxBreakdown?.state || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>IVU Municipal (1%):</span>
                <span>{formatCurrency(lastSale.taxBreakdown?.municipal || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>IVU Total:</span>
                <span>{formatCurrency(lastSale.tax)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold pt-2 border-t">
                <span>Total:</span>
                <span className="text-green-600">{formatCurrency(lastSale.total)}</span>
              </div>
            </div>

            <div className="text-center border-t pt-4">
              <p className="text-xs text-gray-400 mb-2">
                Documento: {selectedPrintDocument === 'invoice' ? 'Factura' : 'Recibo'}
              </p>
              <p className="text-sm text-gray-500">Método de pago: <strong>{getPaymentMethodLabel(lastSale.paymentMethod)}</strong></p>
              {lastSale.payments?.length > 1 && (
                <div className="mt-2 space-y-1 text-sm text-gray-500">
                  {lastSale.payments.map((payment) => (
                    <p key={payment.id}>
                      {getPaymentMethodLabel(payment.method)}: <strong>{formatCurrency(payment.amount || 0)}</strong>
                    </p>
                  ))}
                </div>
              )}
              <p className="text-sm text-gray-500">Estado: <strong>{lastSale.status}</strong></p>
              {(lastSale.payments || []).some((payment) => Number(payment.amount_received || 0) > 0) ? (
                <p className="text-sm text-gray-500">
                  Cambio: <strong>{formatCurrency((lastSale.payments || []).reduce((sum, payment) => sum + Number(payment.change_due || 0), 0))}</strong>
                </p>
              ) : null}
              <p className="text-sm text-gray-500 mt-4">¡Gracias por su compra!</p>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setShowReceiptModal(false)}
                className="flex-1 btn btn-secondary"
              >
                Cerrar
              </button>
              <button
                onClick={() => handlePrintDocument('receipt')}
                className="flex-1 btn btn-secondary"
              >
                Imprimir Recibo
              </button>
              <button
                onClick={() => handlePrintDocument('invoice')}
                className="flex-1 btn btn-primary"
              >
                Imprimir Factura
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default POS;
