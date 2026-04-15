import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, Search, Package, AlertTriangle, Barcode } from 'lucide-react';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import {
  loadData,
  formatCurrency,
  generateId,
  saveData,
  getPrimaryProductBarcode,
  getProductBarcodes,
  normalizeProductTaxConfig,
  normalizeProductBarcodes,
  normalizeProductSizes,
  normalizeProductSizeStocks
} from '../data/demoData';
import Modal from '../components/Modal';
import Input from '../components/Input';
import Select from '../components/Select';
import Notification from '../components/Notification';
import { saveProductsSnapshot, subscribeProducts } from '../services/inventoryService';
import { normalizeHeader, parseCsv } from '../utils/csv';
import { deleteCategory, saveCategory, subscribeCategories } from '../services/categoryService';
import { useAuth } from '../contexts/AuthContext';
import { auth } from '../firebase/config';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useRoleDefinitions } from '../hooks/useRoleDefinitions';
import useIsMobileDevice from '../hooks/useIsMobileDevice';
import useScannerHidStatus from '../hooks/useScannerHidStatus';
import useScannerKeyboardInput from '../hooks/useScannerKeyboardInput';

function Products({ pendingDraft = null, onPendingDraftHandled = () => {} }) {
  const { user, profile } = useAuth();
  const { hasPermission } = useRoleDefinitions();
  const canManageCategories = hasPermission(profile?.role, 'manage_categories') || profile?.role === 'admin';
  const canDeleteAllProducts = profile?.role === 'admin';
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [notification, setNotification] = useState(null);
  const [linkedSearchQuery, setLinkedSearchQuery] = useState('');
  const [importingCsv, setImportingCsv] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState('');
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedLinkedProductId, setExpandedLinkedProductId] = useState('');
  const [showBarcodeScannerModal, setShowBarcodeScannerModal] = useState(false);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [deleteAllPassword, setDeleteAllPassword] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);
  const [scannerStatus, setScannerStatus] = useState('Listo para escanear');
  const [scannerError, setScannerError] = useState('');
  const [manualBarcode, setManualBarcode] = useState('');
  const [keyboardScannerDetected, setKeyboardScannerDetected] = useState(false);
  const csvInputRef = useRef(null);
  const barcodeVideoRef = useRef(null);
  const barcodeStreamRef = useRef(null);
  const barcodeIntervalRef = useRef(null);
  const PAGE_SIZE = 50;
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 250);
  const debouncedLinkedSearch = useDebouncedValue(linkedSearchQuery, 250);
  const isMobileDevice = useIsMobileDevice();
  const {
    hidSupported,
    scannerDetected,
    deviceName,
    refreshDevices
  } = useScannerHidStatus(['netum', 'nsl8bls', 'barcode', 'scanner']);
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
  const [formData, setFormData] = useState({
    sku: '',
    name: '',
    barcode: '',
    barcodes: [''],
    location: '',
    categoryId: '',
    price: '',
    cost: '',
    stock: '',
    lowStockThreshold: '',
    description: '',
    active: true,
    unitType: 'unit',
    useSizeSelection: false,
    sizeStocks: [],
    ivuStateEnabled: true,
    ivuMunicipalEnabled: true,
    linkedProductIds: []
  });
  const categoryColorPalette = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316'];
  const buildEditableBarcodes = useCallback(
    (product = {}) => {
      const barcodes = getProductBarcodes(product);
      return barcodes.length > 0 ? barcodes : [''];
    },
    []
  );
  const buildEditableSizeStocks = useCallback(
    (sizeStocks = [], fallbackSizes = [], totalStock = 0) => {
      const normalized = normalizeProductSizeStocks(sizeStocks, fallbackSizes);
      if (normalized.length > 0) {
        return normalized.map((entry) => ({
          size: entry.size,
          stock: entry.stock ? String(entry.stock) : ''
        }));
      }

      return totalStock > 0 ? [{ size: '', stock: String(totalStock) }] : [{ size: '', stock: '' }];
    },
    []
  );

  const computeSizeStockTotal = useCallback(
    (sizeStocks = []) => sizeStocks.reduce((sum, entry) => sum + Math.max(0, Number(entry.stock || 0)), 0),
    []
  );

  useEffect(() => {
    const data = loadData();
    setCategories(data.categories);

    const unsubscribe = subscribeProducts(
      async (rows) => {
        if (rows.length > 0) {
          setProducts(rows.map(normalizeProductTaxConfig));
          return;
        }

        try {
          await saveProductsSnapshot(data.products);
        } catch (seedError) {
          console.error('Error seeding products in Firestore:', seedError);
        }
        setProducts((data.products || []).map(normalizeProductTaxConfig));
      },
      (error) => {
        console.error('Error loading products from Firestore, fallback local:', error);
        setProducts((data.products || []).map(normalizeProductTaxConfig));
      }
    );

    const unsubCategories = subscribeCategories(
      async (rows) => {
        if (rows.length > 0) {
          setCategories(rows.filter((c) => c.active !== false));
          return;
        }

        try {
          await Promise.all((data.categories || []).map((category) => saveCategory(category)));
          setCategories(data.categories || []);
        } catch (seedError) {
          console.error('Error seeding categories in Firestore:', seedError);
          setCategories(data.categories || []);
        }
      },
      (error) => {
        console.error('Error loading categories from Firestore, fallback local:', error);
        setCategories(data.categories || []);
      }
    );

    return () => {
      unsubscribe();
      unsubCategories();
    };
  }, []);

  const showNotification = (type, message) => {
    setNotification({ type, message, id: Date.now() });
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchQuery, selectedCategoryFilter]);

  useEffect(() => {
    if (pendingDraft?.productId) {
      const productToEdit = products.find((product) => product.id === pendingDraft.productId);
      if (!productToEdit) return;
      openModal(productToEdit);
      onPendingDraftHandled();
      return;
    }

    if (pendingDraft?.productTemplate) {
      const template = pendingDraft.productTemplate;
      setEditingProduct(null);
      setLinkedSearchQuery('');
      setFormData({
        sku: template.sku || '',
        name: template.name || '',
        barcode: getPrimaryProductBarcode(template),
        barcodes: buildEditableBarcodes(template),
        location: template.location || '',
        categoryId: template.categoryId || '',
        price: template.price !== undefined ? String(template.price) : '',
        cost: template.cost !== undefined ? String(template.cost) : '',
        stock: template.stock !== undefined ? String(template.stock) : '0',
        lowStockThreshold: template.lowStockThreshold !== undefined ? String(template.lowStockThreshold) : '0',
        description: template.description || '',
        active: true,
        unitType: 'unit',
        useSizeSelection: false,
        sizeStocks: [{ size: '', stock: '' }],
        ivuStateEnabled: template.ivuStateEnabled !== false,
        ivuMunicipalEnabled: template.ivuMunicipalEnabled !== false,
        linkedProductIds: []
      });
      setShowModal(true);
      onPendingDraftHandled();
      return;
    }

    if (!pendingDraft?.barcode) return;

    setEditingProduct(null);
    setLinkedSearchQuery('');
    setFormData({
      sku: '',
      name: '',
      barcode: String(pendingDraft.barcode || '').trim(),
      barcodes: String(pendingDraft.barcode || '').trim() ? [String(pendingDraft.barcode || '').trim()] : [''],
      location: '',
      categoryId: '',
      price: '',
      cost: '',
      stock: '',
      lowStockThreshold: '',
      description: '',
      active: true,
      unitType: 'unit',
      useSizeSelection: false,
      sizeStocks: [{ size: '', stock: '' }],
      ivuStateEnabled: true,
      ivuMunicipalEnabled: true,
      linkedProductIds: []
    });
    setShowModal(true);
    onPendingDraftHandled();
  }, [buildEditableBarcodes, onPendingDraftHandled, pendingDraft, products]);

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

  const searchResults = useMemo(() => {
    const query = debouncedSearchQuery.trim().toLowerCase();
    if (!query) {
      return {
        products,
        directMatchIds: new Set()
      };
    }

    const directMatches = new Set(
      products
        .filter((product) =>
          (product.sku || '').toLowerCase().includes(query) ||
          product.name.toLowerCase().includes(query) ||
          getProductBarcodes(product).some((barcode) => barcode.includes(debouncedSearchQuery)) ||
          (product.description || '').toLowerCase().includes(query) ||
          (product.location || '').toLowerCase().includes(query) ||
          (product.category || '').toLowerCase().includes(query)
        )
        .map((product) => product.id)
    );

    if (directMatches.size === 0) {
      return {
        products: [],
        directMatchIds: directMatches
      };
    }

    const adjacency = buildAdjacencyMap(products);
    const queue = [...directMatches];
    const allMatches = new Set(directMatches);

    while (queue.length > 0) {
      const currentId = queue.shift();
      const neighbors = adjacency.get(currentId) || new Set();

      neighbors.forEach((neighborId) => {
        if (allMatches.has(neighborId)) return;
        allMatches.add(neighborId);
        queue.push(neighborId);
      });
    }

    return {
      products: products.filter((product) => allMatches.has(product.id)),
      directMatchIds: directMatches
    };
  }, [products, debouncedSearchQuery]);

  const filteredProducts = useMemo(
    () => searchResults.products.filter((product) =>
      selectedCategoryFilter === 'all' || product.categoryId === selectedCategoryFilter
    ),
    [searchResults.products, selectedCategoryFilter]
  );
  const directMatchIds = searchResults.directMatchIds;
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredProducts.slice(start, start + PAGE_SIZE);
  }, [filteredProducts, currentPage]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const normalizeLinkedIds = (linkedIds, selfId = null) => {
    const validIds = new Set(products.map((p) => p.id));
    return [...new Set(linkedIds)]
      .filter((id) => id && id !== selfId && validIds.has(id));
  };

  const getLinkedProducts = (product) => {
    const linkedIds = new Set(product.linkedProductIds || []);
    return products.filter((item) => linkedIds.has(item.id));
  };

  const stopBarcodeScanner = () => {
    if (barcodeIntervalRef.current) {
      clearInterval(barcodeIntervalRef.current);
      barcodeIntervalRef.current = null;
    }

    if (barcodeStreamRef.current) {
      barcodeStreamRef.current.getTracks().forEach((track) => track.stop());
      barcodeStreamRef.current = null;
    }
  };

  const closeBarcodeScannerModal = () => {
    stopBarcodeScanner();
    setShowBarcodeScannerModal(false);
    setScannerStatus('Listo para escanear');
    setScannerError('');
    setManualBarcode('');
  };

  const applyScannedBarcode = useCallback((barcode) => {
    const normalizedBarcode = String(barcode || '').trim();
    if (!normalizedBarcode) return;

    stopBarcodeScanner();
    setManualBarcode(normalizedBarcode);
    setFormData((current) => {
      const nextBarcodes = normalizeProductBarcodes({
        barcodes: [...(current.barcodes || []), normalizedBarcode]
      });

      return {
        ...current,
        barcode: nextBarcodes[0] || '',
        barcodes: nextBarcodes.length > 0 ? nextBarcodes : ['']
      };
    });
    setShowBarcodeScannerModal(false);
    showNotification('success', `Código leído: ${normalizedBarcode}`);
  }, []);

  useScannerKeyboardInput({
    enabled: showBarcodeScannerModal && !isMobileDevice,
    onScan: (barcode) => {
      setKeyboardScannerDetected(true);
      applyScannedBarcode(barcode);
    },
    keepLastBufferedValue: true,
    onBufferChange: (nextBuffer) => {
      setManualBarcode(nextBuffer);
      setScannerError('');
      setScannerStatus(nextBuffer ? 'Leyendo scanner USB...' : 'Esperando lectura del scanner USB...');
    }
  });

  useEffect(() => {
    if (!showBarcodeScannerModal) return undefined;

    refreshDevices();

    if (!isMobileDevice) {
      stopBarcodeScanner();
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
        setScannerError('Este navegador no expone acceso directo a cámara. Usa el código manual.');
        return;
      }

      if (typeof window.BarcodeDetector === 'undefined') {
        setScannerError('Este navegador no soporta escaneo en vivo. Usa el código manual.');
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
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });

        barcodeStreamRef.current = stream;
        if (barcodeVideoRef.current) {
          barcodeVideoRef.current.srcObject = stream;
          await barcodeVideoRef.current.play();
        }

        setScannerStatus('Escaneando código...');
        setScannerError('');

        barcodeIntervalRef.current = setInterval(async () => {
          if (!barcodeVideoRef.current || barcodeVideoRef.current.readyState < 2) return;

          try {
            const barcodes = await detector.detect(barcodeVideoRef.current);
            if (barcodes.length > 0) {
              const detectedCode = barcodes[0]?.rawValue;
              if (detectedCode) {
                applyScannedBarcode(detectedCode);
              }
            }
          } catch (error) {
            console.error('Error detecting barcode in products form:', error);
          }
        }, 500);
      } catch (error) {
        console.error('Error starting camera in products form:', error);
        if (error?.name === 'NotAllowedError') {
          setScannerError('No se concedió permiso a la cámara.');
        } else {
          setScannerError('No se pudo iniciar la cámara para escanear.');
        }
        stopBarcodeScanner();
      }
    };

    runScanner();
    return () => stopBarcodeScanner();
  }, [applyScannedBarcode, isMobileDevice, refreshDevices, scannerReady, showBarcodeScannerModal]);

  const openModal = (product = null) => {
    setLinkedSearchQuery('');
    if (product) {
      setEditingProduct(product);
      setFormData({
        sku: product.sku || '',
        name: product.name,
        barcode: getPrimaryProductBarcode(product),
        barcodes: buildEditableBarcodes(product),
        location: product.location || '',
        categoryId: product.categoryId,
        price: product.price.toString(),
        cost: product.cost.toString(),
        stock: product.stock.toString(),
        lowStockThreshold: product.lowStockThreshold.toString(),
        description: product.description || '',
        active: product.active,
        unitType: product.unitType === 'feet' ? 'feet' : 'unit',
        useSizeSelection: product.useSizeSelection === true,
        sizeStocks: buildEditableSizeStocks(product.sizeStocks, product.availableSizes, product.stock),
        ivuStateEnabled: product.ivuStateEnabled !== false,
        ivuMunicipalEnabled: product.ivuMunicipalEnabled !== false,
        linkedProductIds: product.linkedProductIds || []
      });
    } else {
      setEditingProduct(null);
      setFormData({
        sku: '',
        name: '',
        barcode: '',
        barcodes: [''],
        location: '',
        categoryId: '',
        price: '',
        cost: '',
        stock: '',
        lowStockThreshold: '',
        description: '',
        active: true,
        unitType: 'unit',
        useSizeSelection: false,
        sizeStocks: [{ size: '', stock: '' }],
        ivuStateEnabled: true,
        ivuMunicipalEnabled: true,
        linkedProductIds: []
      });
    }
    setShowModal(true);
  };

  const resetProductForm = () => {
    setEditingProduct(null);
    setLinkedSearchQuery('');
    setFormData({
      sku: '',
      name: '',
      barcode: '',
      barcodes: [''],
      location: '',
      categoryId: '',
      price: '',
      cost: '',
      stock: '',
      lowStockThreshold: '',
      description: '',
      active: true,
      unitType: 'unit',
      useSizeSelection: false,
      sizeStocks: [{ size: '', stock: '' }],
      ivuStateEnabled: true,
      ivuMunicipalEnabled: true,
      linkedProductIds: []
    });
  };

  const closeProductModal = () => {
    setShowModal(false);
    resetProductForm();
  };

  const updateSizeStockRow = (index, field, value) => {
    setFormData((current) => ({
      ...current,
      sizeStocks: current.sizeStocks.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry
      )
    }));
  };

  const addSizeStockRow = () => {
    setFormData((current) => ({
      ...current,
      sizeStocks: [...current.sizeStocks, { size: '', stock: '' }]
    }));
  };

  const removeSizeStockRow = (index) => {
    setFormData((current) => ({
      ...current,
      sizeStocks: current.sizeStocks.length === 1
        ? [{ size: '', stock: '' }]
        : current.sizeStocks.filter((_, entryIndex) => entryIndex !== index)
    }));
  };

  const updateBarcodeRow = (index, value) => {
    setFormData((current) => {
      const nextBarcodes = (current.barcodes || []).map((barcode, barcodeIndex) =>
        barcodeIndex === index ? value : barcode
      );
      const normalized = normalizeProductBarcodes({ barcodes: nextBarcodes });
      const editable = normalized.length > 0 ? normalized : [''];

      return {
        ...current,
        barcode: normalized[0] || '',
        barcodes: editable
      };
    });
  };

  const addBarcodeRow = () => {
    setFormData((current) => ({
      ...current,
      barcodes: [...(current.barcodes || ['']), '']
    }));
  };

  const removeBarcodeRow = (index) => {
    setFormData((current) => {
      const remaining = (current.barcodes || []).filter((_, barcodeIndex) => barcodeIndex !== index);
      const normalized = normalizeProductBarcodes({ barcodes: remaining });
      const editable = normalized.length > 0 ? normalized : [''];

      return {
        ...current,
        barcode: normalized[0] || '',
        barcodes: editable
      };
    });
  };

  const syncProductsInBackground = (nextProducts, successMessage, errorMessage, deletedIds = []) => {
    setProducts(nextProducts);
    const localData = loadData();
    saveData({
      ...localData,
      products: nextProducts
    });
    closeProductModal(true);
    showNotification('success', successMessage);

    saveProductsSnapshot(nextProducts, deletedIds).catch((error) => {
      console.error(error);
      showNotification('warning', errorMessage);
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const normalizedSku = (formData.sku || '').trim().toUpperCase();
    const normalizedBarcodes = normalizeProductBarcodes(formData);
    if (!normalizedSku) {
      showNotification('error', 'El SKU es requerido');
      return;
    }

    if (normalizedBarcodes.length === 0) {
      showNotification('error', 'Agrega al menos un código de barras');
      return;
    }

    const duplicateSku = products.find((p) => {
      if (editingProduct && p.id === editingProduct.id) return false;
      return (p.sku || '').trim().toUpperCase() === normalizedSku;
    });

    if (duplicateSku) {
      showNotification('error', `El SKU ya existe: ${normalizedSku}`);
      return;
    }

    const duplicateBarcode = products.find((product) => {
      if (editingProduct && product.id === editingProduct.id) return false;
      return normalizedBarcodes.some((barcode) => getProductBarcodes(product).includes(barcode));
    });

    if (duplicateBarcode) {
      const repeatedBarcode = normalizedBarcodes.find((barcode) => getProductBarcodes(duplicateBarcode).includes(barcode));
      showNotification('error', `El código ${repeatedBarcode} ya existe en ${duplicateBarcode.name}`);
      return;
    }
    
    const category = categories.find(c => c.id === formData.categoryId);
    const sizeStocks = formData.useSizeSelection
      ? normalizeProductSizeStocks(formData.sizeStocks)
      : [];
    const availableSizes = formData.useSizeSelection
      ? normalizeProductSizes(sizeStocks.map((entry) => entry.size))
      : [];
    const computedStock = formData.useSizeSelection
      ? computeSizeStockTotal(sizeStocks)
      : parseFloat(formData.stock);

    if (formData.useSizeSelection && sizeStocks.length === 0) {
      showNotification('error', 'Agrega al menos una talla con cantidad.');
      return;
    }
    const currentProducts = products || [];
    if (editingProduct) {
      const linkedProductIds = normalizeLinkedIds(formData.linkedProductIds, editingProduct.id);
      const previousLinked = editingProduct.linkedProductIds || [];
      const removedLinks = previousLinked.filter((id) => !linkedProductIds.includes(id));

      // Actualizar producto existente
      let updatedProducts = currentProducts.map(p => {
        if (p.id === editingProduct.id) {
          return {
            ...p,
            sku: normalizedSku,
            name: formData.name,
            barcode: normalizedBarcodes[0] || '',
            barcodes: normalizedBarcodes,
            location: (formData.location || '').trim().toUpperCase(),
            categoryId: formData.categoryId,
            category: category?.name || '',
            price: parseFloat(formData.price),
            cost: parseFloat(formData.cost),
            stock: computedStock,
            lowStockThreshold: parseFloat(formData.lowStockThreshold),
            description: formData.description,
            active: formData.active,
            unitType: formData.unitType,
            useSizeSelection: formData.useSizeSelection,
            availableSizes,
            sizeStocks,
            ivuStateEnabled: formData.ivuStateEnabled,
            ivuMunicipalEnabled: formData.ivuMunicipalEnabled,
            linkedProductIds
          };
        }
        return p;
      });

      updatedProducts = updatedProducts.map((product) => {
        if (!removedLinks.includes(product.id)) return product;
        const nextLinks = (product.linkedProductIds || []).filter((id) => id !== editingProduct.id);
        return { ...product, linkedProductIds: nextLinks };
      });

      // Asegura conexiones bidireccionales para los nuevos vínculos.
      updatedProducts = updatedProducts.map((product) => {
        if (!linkedProductIds.includes(product.id)) return product;
        const nextLinks = new Set(product.linkedProductIds || []);
        nextLinks.add(editingProduct.id);
        return { ...product, linkedProductIds: [...nextLinks] };
      });

      syncProductsInBackground(
        updatedProducts,
        'Producto actualizado exitosamente',
        'Producto actualizado, pero no se pudo sincronizar con Firestore'
      );
      return;
    } else {
      const newProductId = generateId('prod');
      const linkedProductIds = normalizeLinkedIds(formData.linkedProductIds, newProductId);

      // Crear nuevo producto
      const newProduct = {
        id: newProductId,
        sku: normalizedSku,
        name: formData.name,
        barcode: normalizedBarcodes[0] || '',
        barcodes: normalizedBarcodes,
        location: (formData.location || '').trim().toUpperCase(),
        categoryId: formData.categoryId,
        category: category?.name || '',
        price: parseFloat(formData.price),
        cost: parseFloat(formData.cost),
        stock: computedStock,
        lowStockThreshold: parseFloat(formData.lowStockThreshold),
        description: formData.description,
        active: formData.active,
        unitType: formData.unitType,
        useSizeSelection: formData.useSizeSelection,
        availableSizes,
        sizeStocks,
        ivuStateEnabled: formData.ivuStateEnabled,
        ivuMunicipalEnabled: formData.ivuMunicipalEnabled,
        image: null,
        linkedProductIds
      };

      const withNewProduct = [...currentProducts, newProduct];
      const updatedProducts = withNewProduct.map((product) => {
        if (!linkedProductIds.includes(product.id) || product.id === newProductId) return product;
        const nextLinks = new Set(product.linkedProductIds || []);
        nextLinks.add(newProductId);
        return { ...product, linkedProductIds: [...nextLinks] };
      });

      syncProductsInBackground(
        updatedProducts,
        'Producto creado exitosamente',
        'Producto creado, pero no se pudo sincronizar con Firestore'
      );
      return;
    }
  };

  const deleteProduct = async (productId) => {
    if (!window.confirm('¿Estás seguro de eliminar este producto?')) return;
    
    const updatedProducts = products
      .filter((p) => p.id !== productId)
      .map((p) => ({
        ...p,
        linkedProductIds: (p.linkedProductIds || []).filter((id) => id !== productId)
      }));

    setProducts(updatedProducts);
    const localData = loadData();
    saveData({ ...localData, products: updatedProducts });
    showNotification('success', 'Producto eliminado exitosamente');

    saveProductsSnapshot(updatedProducts, [productId]).catch((error) => {
      console.error(error);
      showNotification('warning', 'Producto eliminado, pero no se pudo sincronizar con Firestore');
    });
  };

  const toggleActive = async (productId) => {
    const updatedProducts = products.map(p => {
      if (p.id === productId) {
        return { ...p, active: !p.active };
      }
      return p;
    });

    setProducts(updatedProducts);
    const localData = loadData();
    saveData({ ...localData, products: updatedProducts });
    showNotification('success', 'Estado del producto actualizado');

    saveProductsSnapshot(updatedProducts).catch((error) => {
      console.error(error);
      showNotification('warning', 'Estado actualizado, pero no se pudo sincronizar con Firestore');
    });
  };

  const handleCreateCategory = async () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) {
      showNotification('error', 'Nombre de categoría requerido');
      return;
    }

    const duplicate = categories.find(
      (c) => String(c.name || '').trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
      showNotification('error', 'Esa categoría ya existe');
      return;
    }

    setSavingCategory(true);
    const newCategory = {
      id: generateId('cat'),
      name: trimmed,
      color: categoryColorPalette[Math.floor(Math.random() * categoryColorPalette.length)],
      active: true
    };

    try {
      await saveCategory(newCategory);
      setShowCategoryModal(false);
      setNewCategoryName('');
      showNotification('success', 'Categoría creada');
    } catch (error) {
      console.error(error);
      showNotification('error', 'No se pudo crear la categoría');
    } finally {
      setSavingCategory(false);
    }
  };

  const startCategoryEdit = (category) => {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name || '');
  };

  const cancelCategoryEdit = () => {
    setEditingCategoryId('');
    setEditingCategoryName('');
  };

  const handleSaveCategoryEdit = async (category) => {
    const trimmed = editingCategoryName.trim();
    if (!trimmed) {
      showNotification('error', 'Nombre de categoría requerido');
      return;
    }

    const duplicate = categories.find(
      (c) => c.id !== category.id && String(c.name || '').trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
      showNotification('error', 'Esa categoría ya existe');
      return;
    }

    setSavingCategory(true);
    try {
      await saveCategory({ ...category, name: trimmed });

      const updatedProducts = products.map((product) => {
        if (product.categoryId !== category.id) return product;
        return { ...product, category: trimmed };
      });
      await saveProductsSnapshot(updatedProducts);
      setProducts(updatedProducts);

      showNotification('success', 'Categoría actualizada');
      cancelCategoryEdit();
    } catch (error) {
      console.error(error);
      showNotification('error', 'No se pudo actualizar la categoría');
    } finally {
      setSavingCategory(false);
    }
  };

  const handleDeleteCategory = async (category) => {
    const inUseCount = products.filter((p) => p.categoryId === category.id).length;
    const confirmation = window.confirm(
      inUseCount > 0
        ? `La categoría "${category.name}" está en ${inUseCount} producto(s). Se quedarán sin categoría. ¿Continuar?`
        : `¿Eliminar la categoría "${category.name}"?`
    );
    if (!confirmation) return;

    setSavingCategory(true);
    try {
      const updatedProducts = products.map((product) => {
        if (product.categoryId !== category.id) return product;
        return { ...product, categoryId: '', category: '' };
      });
      await saveProductsSnapshot(updatedProducts);
      await deleteCategory(category.id);
      setProducts(updatedProducts);
      if (editingCategoryId === category.id) cancelCategoryEdit();
      showNotification('success', 'Categoría eliminada');
    } catch (error) {
      console.error(error);
      showNotification('error', 'No se pudo eliminar la categoría');
    } finally {
      setSavingCategory(false);
    }
  };

  const handleDeleteAllProducts = async () => {
    if (!canDeleteAllProducts) {
      showNotification('error', 'Solo los administradores pueden borrar todo el inventario.');
      return;
    }

    if (products.length === 0) {
      showNotification('error', 'No hay productos para borrar');
      return;
    }

    if (!user?.email) {
      showNotification('error', 'No se pudo validar la cuenta del administrador actual.');
      return;
    }

    if (!deleteAllPassword) {
      showNotification('error', 'Debes escribir tu contraseña para confirmar.');
      return;
    }

    setDeletingAll(true);

    try {
      const credential = EmailAuthProvider.credential(user.email, deleteAllPassword);
      await reauthenticateWithCredential(auth.currentUser || user, credential);
    } catch (error) {
      console.error('Error reauthenticating admin before deleting all products:', error);
      setDeletingAll(false);
      showNotification('error', 'La contraseña es incorrecta. No se borró el inventario.');
      return;
    }

    const deletedIds = products.map((p) => p.id);
    setProducts([]);
    setExpandedLinkedProductId('');
    const localData = loadData();
    saveData({
      ...localData,
      products: []
    });
    showNotification('success', 'Se borraron todos los productos');
    setShowDeleteAllModal(false);
    setDeleteAllPassword('');
    setDeletingAll(false);

    saveProductsSnapshot([], deletedIds).catch((error) => {
      console.error(error);
      showNotification('warning', 'Los productos se borraron localmente, pero no se pudo sincronizar con Firestore');
    });
  };

  const parseNumber = (value, fallback = 0) => {
    if (value === null || value === undefined || value === '') return fallback;
    const num = Number(String(value).replace(',', '.'));
    return Number.isFinite(num) ? num : fallback;
  };

  const handleCsvImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportingCsv(true);

    try {
      const text = await file.text();
      const rows = parseCsv(text);

      if (rows.length < 2) {
        showNotification('error', 'CSV vacío o sin filas de datos');
        return;
      }

      const headerRow = rows[0].map(normalizeHeader);
      const dataRows = rows.slice(1);

      const findColumn = (aliases) => {
        const set = new Set(aliases.map(normalizeHeader));
        return headerRow.findIndex((h) => set.has(h));
      };

      const col = {
        sku: findColumn(['sku', 'id', 'codigointerno', 'codigo', 'referencia']),
        name: findColumn(['nombre', 'name', 'producto', 'product']),
        barcode: findColumn(['barcode', 'codigobarras', 'ean', 'upc']),
        location: findColumn(['ubicacion', 'location', 'locacion', 'rack', 'shelf']),
        category: findColumn(['categoria', 'category', 'departamento']),
        price: findColumn(['precio', 'price', 'precioventa', 'saleprice', 'pricecjmarine']),
        cost: findColumn(['costo', 'cost', 'preciocosto', 'costprice']),
        stock: findColumn(['stock', 'existencia', 'cantidad', 'qty', 'inventory', 'instockcjmarine']),
        lowStockThreshold: findColumn([
          'stockminimo',
          'minstock',
          'lowstockthreshold',
          'alertastock',
          'lowstockcjmarine'
        ]),
        description: findColumn(['descripcion', 'description', 'detalle']),
        active: findColumn(['activo', 'active', 'estado', 'availableforsalecjmarine', 'trackstock'])
      };

      if (col.name === -1) {
        showNotification('error', 'No encontré columna de nombre en el CSV');
        return;
      }

      const categoryMap = new Map(
        categories.map((c) => [String(c.name || '').trim().toLowerCase(), c])
      );
      let createdCategories = 0;

      if (col.category >= 0) {
        for (const row of dataRows) {
          const rawName = String(row[col.category] || '').trim();
          if (!rawName) continue;
          const key = rawName.toLowerCase();
          if (categoryMap.has(key)) continue;

          const createdCategory = {
            id: generateId('cat'),
            name: rawName,
            color: categoryColorPalette[Math.floor(Math.random() * categoryColorPalette.length)],
            active: true
          };

          await saveCategory(createdCategory);
          categoryMap.set(key, createdCategory);
          createdCategories += 1;
        }
      }

      const currentProducts = [...products];
      const bySku = new Map(
        currentProducts
          .filter((p) => p.sku)
          .map((p) => [String(p.sku).trim().toUpperCase(), p])
      );
      const byBarcode = new Map(
        currentProducts.flatMap((p) =>
          getProductBarcodes(p).map((barcode) => [String(barcode).trim(), p])
        )
      );

      let created = 0;
      let updated = 0;

      dataRows.forEach((row) => {
        const skuRaw = col.sku >= 0 ? row[col.sku] : '';
        const barcodeRaw = col.barcode >= 0 ? row[col.barcode] : '';
        const nameRaw = row[col.name] || '';
        if (!nameRaw.trim()) return;

        const normalizedSku = skuRaw ? String(skuRaw).trim().toUpperCase() : '';
        const normalizedBarcode = barcodeRaw ? String(barcodeRaw).trim() : '';

        const matched =
          (normalizedSku && bySku.get(normalizedSku)) ||
          (normalizedBarcode && byBarcode.get(normalizedBarcode));

        const categoryName = col.category >= 0 ? String(row[col.category] || '').trim() : '';
        const categoryFound = categoryMap.get(categoryName.toLowerCase());

        const payload = {
          sku: normalizedSku || (matched?.sku || ''),
          name: nameRaw.trim(),
          barcode: normalizedBarcode || getPrimaryProductBarcode(matched),
          barcodes: normalizedBarcode
            ? normalizeProductBarcodes({ barcodes: [...getProductBarcodes(matched), normalizedBarcode] })
            : getProductBarcodes(matched),
          location: col.location >= 0 ? String(row[col.location] || '').trim().toUpperCase() : (matched?.location || ''),
          categoryId: categoryFound?.id || matched?.categoryId || '',
          category: categoryFound?.name || categoryName || matched?.category || '',
          price: parseNumber(col.price >= 0 ? row[col.price] : matched?.price, matched?.price || 0),
          cost: parseNumber(col.cost >= 0 ? row[col.cost] : matched?.cost, matched?.cost || 0),
          stock: parseNumber(col.stock >= 0 ? row[col.stock] : matched?.stock, matched?.stock || 0),
          lowStockThreshold: parseNumber(
            col.lowStockThreshold >= 0 ? row[col.lowStockThreshold] : matched?.lowStockThreshold,
            matched?.lowStockThreshold || 10
          ),
          description: col.description >= 0 ? String(row[col.description] || '') : (matched?.description || ''),
          active:
            col.active >= 0
              ? !['0', 'false', 'inactivo', 'inactive'].includes(
                  String(row[col.active] || '').trim().toLowerCase()
                )
              : matched?.active !== false,
          unitType: matched?.unitType === 'feet' ? 'feet' : 'unit',
          useSizeSelection: matched?.useSizeSelection === true,
          availableSizes: matched?.availableSizes || [],
          sizeStocks: matched?.sizeStocks || [],
          ivuStateEnabled: matched?.ivuStateEnabled !== false,
          ivuMunicipalEnabled: matched?.ivuMunicipalEnabled !== false,
          image: matched?.image || null,
          linkedProductIds: matched?.linkedProductIds || []
        };

        if (matched) {
          Object.assign(matched, payload);
          updated += 1;
        } else {
          const id = generateId('prod');
          const newProduct = { id, ...payload };
          currentProducts.push(newProduct);
          if (newProduct.sku) bySku.set(newProduct.sku, newProduct);
          getProductBarcodes(newProduct).forEach((barcode) => byBarcode.set(barcode, newProduct));
          created += 1;
        }
      });

      await saveProductsSnapshot(currentProducts);
      setProducts(currentProducts);
      showNotification(
        'success',
        `Importación completada. Creados: ${created}, actualizados: ${updated}, categorías nuevas: ${createdCategories}`
      );
    } catch (error) {
      console.error(error);
      showNotification('error', 'No se pudo importar el CSV');
    } finally {
      setImportingCsv(false);
      event.target.value = '';
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
            <h3 className="text-lg font-semibold">Lista de Productos</h3>
            <div className="flex flex-wrap gap-2 w-full md:w-auto">
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleCsvImport}
              />
              <div className="relative flex-1 md:w-64">
                <Search size={20} className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar por nombre, SKU o código..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input w-full pl-10"
                />
              </div>
              <select
                value={selectedCategoryFilter}
                onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                className="input w-full md:w-56"
              >
                <option value="all">Todas las categorías</option>
                {categories
                  .slice()
                  .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
                  .map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
              </select>
              {canManageCategories && (
                <button
                  type="button"
                  onClick={() => setShowCategoryModal(true)}
                  className="btn btn-secondary whitespace-nowrap"
                >
                  Categorías
                </button>
              )}
              <button
                type="button"
                onClick={() => csvInputRef.current?.click()}
                className="btn btn-secondary whitespace-nowrap"
                disabled={importingCsv}
              >
                {importingCsv ? 'Importando...' : 'Importar CSV'}
              </button>
              <button
                onClick={() => openModal()}
                className="btn btn-primary flex items-center gap-2"
              >
                <Plus size={20} />
                <span className="hidden md:inline">Nuevo Producto</span>
              </button>
              {canDeleteAllProducts && (
                <button
                  type="button"
                  onClick={() => {
                    if (products.length === 0) {
                      showNotification('error', 'No hay productos para borrar');
                      return;
                    }
                    setDeleteAllPassword('');
                    setShowDeleteAllModal(true);
                  }}
                  className="btn btn-secondary whitespace-nowrap"
                >
                  Borrar todo
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="overflow-auto max-h-[70vh]">
          <table className="table min-w-[1180px]">
            <thead>
              <tr>
                <th>Producto</th>
                <th>SKU</th>
                <th>Código</th>
                <th>Ubicación</th>
                <th>Categoría</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>Estado</th>
                <th className="sticky right-0 bg-gray-50 z-10">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {paginatedProducts.map((product) => {
                const isExpanded = expandedLinkedProductId === product.id;
                const linkedProducts = getLinkedProducts(product);

                return (
                  <React.Fragment key={product.id}>
                    <tr className="hover:bg-gray-50">
                      <td>
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                            <Package size={20} className="text-gray-400" />
                          </div>
                          <div className="max-w-[280px]">
                            <p className="font-medium break-words leading-5">{product.name}</p>
                            <p className="text-sm text-gray-500 break-words">{product.description}</p>
                            {product.useSizeSelection && (product.sizeStocks || []).length > 0 && (
                              <p className="text-xs text-purple-600 mt-1 break-words">
                                Tallas: {product.sizeStocks.map((entry) => `${entry.size} (${entry.stock})`).join(', ')}
                              </p>
                            )}
                            {searchQuery.trim() && !directMatchIds.has(product.id) && (
                              <p className="text-xs text-indigo-600 mt-1 font-medium">Resultado relacionado</p>
                            )}
                            {(product.linkedProductIds || []).length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedLinkedProductId((current) => current === product.id ? '' : product.id)
                                }
                                className="text-xs text-blue-600 mt-1 font-medium hover:text-blue-700 hover:underline"
                              >
                                Vinculado con {(product.linkedProductIds || []).length} producto(s)
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="font-mono text-sm">{product.sku || '-'}</td>
                      <td className="font-mono text-sm">{getProductBarcodes(product).join(', ') || '-'}</td>
                      <td className="font-mono text-sm">{product.location || '-'}</td>
                      <td>
                        <span className="badge badge-info">{product.category}</span>
                      </td>
                      <td className="font-semibold">{formatCurrency(product.price)}</td>
                      <td>
                        <span className={product.stock <= product.lowStockThreshold ? 'text-red-600 font-bold' : ''}>
                          {product.stock} {product.unitType === 'feet' ? 'pies' : ''}
                        </span>
                        {product.useSizeSelection && (product.sizeStocks || []).length > 0 && (
                          <div className="mt-1 text-xs text-gray-500">
                            {product.sizeStocks.map((entry) => `${entry.size}: ${entry.stock}`).join(' | ')}
                          </div>
                        )}
                        {product.stock <= product.lowStockThreshold && (
                          <AlertTriangle size={14} className="inline ml-1 text-red-500" />
                        )}
                      </td>
                      <td>
                        <button
                          onClick={() => toggleActive(product.id)}
                          className={`badge cursor-pointer ${product.active ? 'badge-success' : 'badge-danger'}`}
                        >
                          {product.active ? 'Activo' : 'Inactivo'}
                        </button>
                      </td>
                      <td className="sticky right-0 bg-white">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openModal(product)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button
                            onClick={() => deleteProduct(product.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-blue-50/60">
                        <td colSpan="9" className="px-6 py-4">
                          <div className="rounded-xl border border-blue-100 bg-white p-4">
                            <div className="flex items-center justify-between gap-3 mb-3">
                              <div>
                                <p className="font-medium text-gray-900">Productos asociados</p>
                                <p className="text-sm text-gray-500">
                                  Conexiones relacionadas con {product.name}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setExpandedLinkedProductId('')}
                                className="text-sm text-gray-500 hover:text-gray-700"
                              >
                                Cerrar
                              </button>
                            </div>

                            {linkedProducts.length > 0 ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                {linkedProducts.map((linkedProduct) => (
                                  <div
                                    key={linkedProduct.id}
                                    className="rounded-lg border border-gray-200 p-3 bg-gray-50"
                                  >
                                    <p className="font-medium text-sm text-gray-900">{linkedProduct.name}</p>
                                    <p className="text-xs text-gray-500 mt-1">{linkedProduct.description || 'Sin descripción'}</p>
                                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
                                      <span>SKU: {linkedProduct.sku || '-'}</span>
                                      <span>Ubicación: {linkedProduct.location || '-'}</span>
                                      <span>Stock: {linkedProduct.stock}{linkedProduct.unitType === 'feet' ? ' pies' : ''}</span>
                                    </div>
                                    <div className="mt-2 flex items-center justify-between">
                                      <span className="text-sm font-semibold text-primary-700">
                                        {formatCurrency(linkedProduct.price)}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => openModal(linkedProduct)}
                                        className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                      >
                                        Editar
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-500">No se encontraron productos asociados.</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredProducts.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Package size={48} className="mx-auto mb-2" />
            <p>No se encontraron productos</p>
          </div>
        )}

        {filteredProducts.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-white">
            <p className="text-sm text-gray-600">
              Mostrando {(currentPage - 1) * PAGE_SIZE + 1} - {Math.min(currentPage * PAGE_SIZE, filteredProducts.length)} de {filteredProducts.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Anterior
              </button>
              <span className="text-sm text-gray-600">{currentPage}/{totalPages}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Siguiente
              </button>
            </div>
          </div>
      )}
      </div>

      <Modal
        isOpen={showDeleteAllModal}
        onClose={() => {
          if (deletingAll) return;
          setShowDeleteAllModal(false);
          setDeleteAllPassword('');
        }}
        title="Confirmar borrado total"
        size="md"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Esto borrará todos los productos del sistema. Solo un administrador puede confirmar esta acción.
          </div>

          <Input
            label="Contraseña del administrador"
            type="password"
            value={deleteAllPassword}
            onChange={(e) => setDeleteAllPassword(e.target.value)}
            placeholder="Escribe tu contraseña para continuar"
            required
          />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setShowDeleteAllModal(false);
                setDeleteAllPassword('');
              }}
              disabled={deletingAll}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleDeleteAllProducts}
              disabled={deletingAll}
            >
              {deletingAll ? 'Verificando...' : 'Confirmar borrado'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeProductModal}
        title={editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
        size="lg"
      >
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Input
                label="SKU / Identificador Único"
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                required
                placeholder="Ej: APPLE-IP15-128-BLK"
              />
            </div>

            <div className="md:col-span-2">
              <Input
                label="Nombre del Producto"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="Ej: Mouse Inalámbrico Pro"
              />
            </div>
            
            <div>
              <Input
                label="Código de Barras"
                value={formData.barcodes?.[0] || ''}
                onChange={(e) => updateBarcodeRow(0, e.target.value)}
                required
                placeholder="Principal: Ej. 1234567890001"
              />
              <button
                type="button"
                onClick={() => setShowBarcodeScannerModal(true)}
                className="btn btn-secondary w-full -mt-2 flex items-center justify-center gap-2"
              >
                <Barcode size={18} />
                {isMobileDevice ? 'Escanear con cámara' : 'Escanear con scanner'}
              </button>
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-gray-700">CÃ³digos adicionales</p>
                  <button
                    type="button"
                    onClick={addBarcodeRow}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    Agregar otro
                  </button>
                </div>
                {(formData.barcodes || []).slice(1).map((barcode, index) => (
                  <div key={`extra_barcode_${index + 1}`} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={barcode}
                      onChange={(e) => updateBarcodeRow(index + 1, e.target.value)}
                      className="input flex-1"
                      placeholder="CÃ³digo adicional"
                    />
                    <button
                      type="button"
                      onClick={() => removeBarcodeRow(index + 1)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                      title="Eliminar cÃ³digo"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <Input
              label="Ubicación"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value.toUpperCase() })}
              placeholder="Ej: T4"
            />
            
            <Select
              label="Categoría"
              value={formData.categoryId}
              onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
              options={categories.map(c => ({ value: c.id, label: c.name }))}
              required
            />
            
            <Input
              label="Precio de Venta"
              type="number"
              step="0.01"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              required
              placeholder={formData.unitType === 'feet' ? 'Precio por pie' : '0.00'}
            />
            
            <Input
              label="Costo"
              type="number"
              step="0.01"
              value={formData.cost}
              onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
              required
              placeholder="0.00"
            />
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Unidad de venta</label>
              <select
                value={formData.unitType}
                onChange={(e) => setFormData({ ...formData, unitType: e.target.value })}
                className="input w-full"
              >
                <option value="unit">Cantidad</option>
                <option value="feet">Pies</option>
              </select>
            </div>

            <Input
              label={formData.unitType === 'feet' ? 'Stock Inicial (pies)' : 'Stock Inicial'}
              type="number"
              step={formData.unitType === 'feet' ? '0.01' : '1'}
              value={formData.useSizeSelection ? String(computeSizeStockTotal(formData.sizeStocks)) : formData.stock}
              onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
              required={!formData.useSizeSelection}
              disabled={formData.useSizeSelection}
              placeholder="0"
            />
            
            <Input
              label={formData.unitType === 'feet' ? 'Stock Mínimo (pies)' : 'Stock Mínimo (Alerta)'}
              type="number"
              step={formData.unitType === 'feet' ? '0.01' : '1'}
              value={formData.lowStockThreshold}
              onChange={(e) => setFormData({ ...formData, lowStockThreshold: e.target.value })}
              required
              placeholder="10"
            />
            
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="input w-full h-20"
                placeholder="Descripción del producto..."
              />
            </div>

            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-gray-200 p-4">
              <label className="flex items-center gap-2 cursor-pointer md:col-span-2">
                <input
                  type="checkbox"
                  checked={formData.useSizeSelection}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      useSizeSelection: e.target.checked,
                      sizeStocks: e.target.checked
                        ? (formData.sizeStocks.length > 0 ? formData.sizeStocks : [{ size: '', stock: '' }])
                        : [{ size: '', stock: '' }]
                    })
                  }
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm font-medium text-gray-700">
                  Maneja tallas para este producto
                </span>
              </label>

              {formData.useSizeSelection && (
                <div className="md:col-span-2 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-700">Tallas y cantidades</p>
                      <p className="text-xs text-gray-500">Define cada talla y cuántas unidades hay de esa talla.</p>
                    </div>
                    <button
                      type="button"
                      onClick={addSizeStockRow}
                      className="btn btn-secondary btn-sm"
                    >
                      Agregar talla
                    </button>
                  </div>

                  <div className="space-y-2">
                    {formData.sizeStocks.map((entry, index) => (
                      <div key={`size_row_${index}`} className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-7">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Talla</label>
                          <input
                            type="text"
                            value={entry.size}
                            onChange={(e) => updateSizeStockRow(index, 'size', e.target.value)}
                            className="input w-full"
                            placeholder="Ej: S, M, L, XL"
                          />
                        </div>
                        <div className="col-span-4">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad</label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={entry.stock}
                            onChange={(e) => updateSizeStockRow(index, 'stock', e.target.value)}
                            className="input w-full"
                            placeholder="0"
                          />
                        </div>
                        <div className="col-span-1">
                          <button
                            type="button"
                            onClick={() => removeSizeStockRow(index)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                            title="Eliminar talla"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">IVU por producto</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-lg border border-gray-200 p-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.ivuStateEnabled}
                    onChange={(e) => setFormData({ ...formData, ivuStateEnabled: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-gray-700">10.5% IVU Estatal</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.ivuMunicipalEnabled}
                    onChange={(e) => setFormData({ ...formData, ivuMunicipalEnabled: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-gray-700">1% IVU</span>
                </label>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Productos conectados (aparecen en búsquedas relacionadas)
              </label>
              <div className="relative mb-2">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={linkedSearchQuery}
                  onChange={(e) => setLinkedSearchQuery(e.target.value)}
                  placeholder="Buscar por nombre, SKU o código..."
                  className="input w-full pl-9"
                />
              </div>
              <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3 space-y-2">
                {products
                  .filter((product) => !editingProduct || product.id !== editingProduct.id)
                  .filter((product) => {
                    const query = debouncedLinkedSearch.trim().toLowerCase();
                    if (!query) return true;
                    return (
                      (product.sku || '').toLowerCase().includes(query) ||
                      product.name.toLowerCase().includes(query) ||
                      getProductBarcodes(product).some((barcode) => barcode.includes(debouncedLinkedSearch)) ||
                      (product.description || '').toLowerCase().includes(query)
                    );
                  })
                  .slice(0, debouncedLinkedSearch.trim() ? 400 : 120)
                  .map((product) => {
                    const checked = formData.linkedProductIds.includes(product.id);
                    return (
                      <label key={product.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const nextIds = e.target.checked
                              ? [...formData.linkedProductIds, product.id]
                              : formData.linkedProductIds.filter((id) => id !== product.id);
                            setFormData({ ...formData, linkedProductIds: nextIds });
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span>
                          {product.name} <span className="text-gray-500">({product.sku || '-'})</span>
                        </span>
                      </label>
                    );
                  })}
                {products.length === 0 && (
                  <p className="text-sm text-gray-500">No hay otros productos para conectar.</p>
                )}
              </div>
            </div>
            
            <div className="md:col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.active}
                  onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm font-medium text-gray-700">Producto Activo</span>
              </label>
            </div>
          </div>
          
          <div className="flex justify-end gap-4 mt-6 pt-4 border-t">
            <button type="button" onClick={closeProductModal} className="btn btn-secondary">
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary">
              {editingProduct ? 'Guardar Cambios' : 'Crear Producto'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showBarcodeScannerModal}
        onClose={closeBarcodeScannerModal}
        title="Escanear código de barras"
        size="md"
      >
        <div className="space-y-4">
          {isMobileDevice ? (
            <div className="rounded-xl overflow-hidden border border-gray-200 bg-black">
              <video
                ref={barcodeVideoRef}
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
            {scannerError && (
              <p className="text-sm text-red-600">{scannerError}</p>
            )}
            <p className="text-xs text-gray-500">
              {isMobileDevice
                ? 'En celular se abrirá la cámara trasera para escanear.'
                : 'En computadora se espera el lector USB; también puedes pegar el código manualmente.'}
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
                onClick={() => applyScannedBarcode(manualBarcode)}
                className="btn btn-secondary whitespace-nowrap"
              >
                Usar
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showCategoryModal}
        onClose={() => {
          if (savingCategory) return;
          setShowCategoryModal(false);
          setNewCategoryName('');
          cancelCategoryEdit();
        }}
        title="Gestionar Categorías"
        size="lg"
      >
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row gap-2 md:items-end">
            <div className="flex-1">
              <Input
                label="Nueva categoría"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="Ej: Accesorios Apple"
                required
              />
            </div>
            <button
              type="button"
              className="btn btn-primary whitespace-nowrap"
              onClick={handleCreateCategory}
              disabled={savingCategory}
            >
              {savingCategory ? 'Guardando...' : 'Crear categoría'}
            </button>
          </div>

          <div className="border rounded-lg max-h-[340px] overflow-auto">
            {categories.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">No hay categorías creadas.</p>
            ) : (
              <div className="divide-y">
                {categories
                  .slice()
                  .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
                  .map((category) => {
                    const inUseCount = products.filter((p) => p.categoryId === category.id).length;
                    const isEditing = editingCategoryId === category.id;
                    return (
                      <div key={category.id} className="p-3 flex items-center gap-3">
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: category.color || '#64748b' }}
                        />
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <input
                              type="text"
                              className="input w-full"
                              value={editingCategoryName}
                              onChange={(e) => setEditingCategoryName(e.target.value)}
                            />
                          ) : (
                            <p className="font-medium text-gray-900 break-words">{category.name}</p>
                          )}
                          <p className="text-xs text-gray-500">{inUseCount} producto(s)</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={cancelCategoryEdit}
                                disabled={savingCategory}
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => handleSaveCategoryEdit(category)}
                                disabled={savingCategory}
                              >
                                Guardar
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                                onClick={() => startCategoryEdit(category)}
                                disabled={savingCategory}
                                aria-label={`Editar categoría ${category.name}`}
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                type="button"
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                                onClick={() => handleDeleteCategory(category)}
                                disabled={savingCategory}
                                aria-label={`Eliminar categoría ${category.name}`}
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setShowCategoryModal(false);
                setNewCategoryName('');
                cancelCategoryEdit();
              }}
              disabled={savingCategory}
            >
              Cerrar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default Products;
