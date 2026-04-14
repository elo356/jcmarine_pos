import { normalizePaymentMethod } from '../utils/paymentUtils';
import {
  normalizeSpecialOrder,
  normalizeSpecialOrderPayment
} from '../utils/specialOrderUtils';
import { mergeWeeklyCachedSales } from '../services/weeklySalesCacheService';

// Datos de demostración - Se guardan en localStorage

export const DEFAULT_PRODUCT_TAX_CONFIG = {
  ivuStateEnabled: true,
  ivuMunicipalEnabled: true
};

export const normalizeProductSizes = (sizes) => {
  if (!Array.isArray(sizes)) return [];
  return [...new Set(sizes.map((size) => String(size || '').trim()).filter(Boolean))];
};

export const normalizeProductSizeStocks = (sizeStocks = [], fallbackSizes = []) => {
  const normalizedEntries = Array.isArray(sizeStocks)
    ? sizeStocks
        .map((entry) => {
          if (typeof entry === 'string') {
            return {
              size: String(entry || '').trim(),
              stock: 0
            };
          }

          return {
            size: String(entry?.size || '').trim(),
            stock: Math.max(0, Number(entry?.stock || 0))
          };
        })
        .filter((entry) => entry.size)
    : [];

  if (normalizedEntries.length > 0) {
    const merged = new Map();
    normalizedEntries.forEach((entry) => {
      const current = merged.get(entry.size) || 0;
      merged.set(entry.size, current + entry.stock);
    });
    return [...merged.entries()].map(([size, stock]) => ({ size, stock }));
  }

  return normalizeProductSizes(fallbackSizes).map((size) => ({ size, stock: 0 }));
};

export const normalizeProductTaxConfig = (product = {}) => ({
  ...product,
  ivuStateEnabled: product.ivuStateEnabled !== false,
  ivuMunicipalEnabled: product.ivuMunicipalEnabled !== false,
  unitType: product.unitType === 'feet' ? 'feet' : 'unit',
  useSizeSelection: product.useSizeSelection === true,
  sizeStocks: normalizeProductSizeStocks(product.sizeStocks, product.availableSizes),
  availableSizes: normalizeProductSizeStocks(product.sizeStocks, product.availableSizes).map((entry) => entry.size),
  location: String(product.location || product.ubicacion || '').trim()
});

export const normalizePrintSettings = (data = {}) => {
  const printers = Array.isArray(data.printers) ? data.printers : [];
  const printRouting = data.printRouting || {};

  return {
    printers,
    printRouting: {
      receiptPrinterId: printRouting.receiptPrinterId || printers[1]?.id || printers[0]?.id || '',
      invoicePrinterId: printRouting.invoicePrinterId || printers[0]?.id || ''
    }
  };
};

export const formatQuantity = (value, unitType = 'unit') => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return unitType === 'feet' ? '0 pies' : '0';

  if (unitType === 'feet') {
    const formatted = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.?0+$/, '');
    return `${formatted} pies`;
  }

  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.?0+$/, '');
};

export const initialData = {
  store: {
    id: 'store_001',
    name: 'CJ Marine',
    address: 'Carr 111 km 05',
    cityStateZip: 'Aguadilla 00603',
    phone: '939 200 8820',
    taxRate: 0.16,
    currency: 'USD',
    printers: [
      {
        id: 'printer_001',
        name: 'Brother Printer',
        brand: 'Brother',
        model: 'Brother',
        connectionType: 'usb',
        active: true
      },
      {
        id: 'printer_002',
        name: 'Thermal Receipt Printer',
        brand: 'MP210',
        model: 'MP210',
        connectionType: 'bluetooth',
        active: true
      }
    ],
    printRouting: {
      receiptPrinterId: 'printer_002',
      invoicePrinterId: 'printer_001'
    }
  },
  
  currentUser: {
    id: 'user_001',
    email: 'admin@pos.com',
    name: 'Admin',
    role: 'admin',
    avatar: null
  },

  categories: [
    { id: 'cat_001', name: 'Electrónicos', color: '#3b82f6', active: true },
    { id: 'cat_002', name: 'Accesorios', color: '#10b981', active: true },
    { id: 'cat_003', name: 'Audio', color: '#f59e0b', active: true },
    { id: 'cat_004', name: 'Oficina', color: '#8b5cf6', active: true },
    { id: 'cat_005', name: 'Gaming', color: '#ef4444', active: true },
  ],

  products: [
    {
      id: 'prod_001',
      name: 'Mouse Inalámbrico Pro',
      barcode: '1234567890001',
      categoryId: 'cat_001',
      category: 'Electrónicos',
      price: 29.99,
      cost: 15.00,
      stock: 150,
      lowStockThreshold: 20,
      active: true,
      image: null,
      description: 'Mouse ergonómico inalámbrico con sensor óptico de alta precisión'
    },
    {
      id: 'prod_002',
      name: 'Teclado Mecánico RGB',
      barcode: '1234567890002',
      categoryId: 'cat_001',
      category: 'Electrónicos',
      price: 89.99,
      cost: 45.00,
      stock: 75,
      lowStockThreshold: 15,
      active: true,
      image: null,
      description: 'Teclado mecánico con switches Cherry MX y retroiluminación RGB'
    },
    {
      id: 'prod_003',
      name: 'Hub USB-C 7 en 1',
      barcode: '1234567890003',
      categoryId: 'cat_002',
      category: 'Accesorios',
      price: 49.99,
      cost: 25.00,
      stock: 200,
      lowStockThreshold: 25,
      active: true,
      image: null,
      description: 'Hub USB-C con HDMI, USB 3.0, lector de tarjetas y más'
    },
    {
      id: 'prod_004',
      name: 'Monitor Elevado Ajustable',
      barcode: '1234567890004',
      categoryId: 'cat_002',
      category: 'Accesorios',
      price: 39.99,
      cost: 18.00,
      stock: 8,
      lowStockThreshold: 10,
      active: true,
      image: null,
      description: 'Soporte elevado para monitor con altura ajustable'
    },
    {
      id: 'prod_005',
      name: 'Webcam HD 1080p',
      barcode: '1234567890005',
      categoryId: 'cat_001',
      category: 'Electrónicos',
      price: 79.99,
      cost: 40.00,
      stock: 45,
      lowStockThreshold: 10,
      active: true,
      image: null,
      description: 'Webcam Full HD con micrófono integrado y autofocus'
    },
    {
      id: 'prod_006',
      name: 'Auriculares Pro Gaming',
      barcode: '1234567890006',
      categoryId: 'cat_003',
      category: 'Audio',
      price: 149.99,
      cost: 75.00,
      stock: 30,
      lowStockThreshold: 8,
      active: true,
      image: null,
      description: 'Auriculares gaming con sonido surround 7.1 y micrófono retráctil'
    },
    {
      id: 'prod_007',
      name: 'Lámpara LED Escritorio',
      barcode: '1234567890007',
      categoryId: 'cat_004',
      category: 'Oficina',
      price: 34.99,
      cost: 15.00,
      stock: 5,
      lowStockThreshold: 10,
      active: true,
      image: null,
      description: 'Lámpara LED con 5 niveles de brillo y temperatura de color ajustable'
    },
    {
      id: 'prod_008',
      name: 'Organizador de Cables',
      barcode: '1234567890008',
      categoryId: 'cat_004',
      category: 'Oficina',
      price: 12.99,
      cost: 5.00,
      stock: 300,
      lowStockThreshold: 50,
      active: true,
      image: null,
      description: 'Set de clips y organizadores para mantener cables ordenados'
    },
    {
      id: 'prod_009',
      name: 'Mousepad XL Gaming',
      barcode: '1234567890009',
      categoryId: 'cat_005',
      category: 'Gaming',
      price: 24.99,
      cost: 10.00,
      stock: 100,
      lowStockThreshold: 20,
      active: true,
      image: null,
      description: 'Mousepad extra grande con superficie de tela y base antideslizante'
    },
    {
      id: 'prod_010',
      name: 'Controlador Pro Bluetooth',
      barcode: '1234567890010',
      categoryId: 'cat_005',
      category: 'Gaming',
      price: 59.99,
      cost: 30.00,
      stock: 40,
      lowStockThreshold: 10,
      active: true,
      image: null,
      description: 'Controlador inalámbrico compatible con PC, Android y iOS'
    },
  ],

  employees: [],

  sales: [
    {
      id: 'sale_001',
      date: new Date(Date.now() - 3600000).toISOString(),
      items: [
        { productId: 'prod_001', name: 'Mouse Inalámbrico Pro', quantity: 2, price: 29.99, subtotal: 59.98 },
        { productId: 'prod_003', name: 'Hub USB-C 7 en 1', quantity: 1, price: 49.99, subtotal: 49.99 }
      ],
      subtotal: 109.97,
      tax: 17.60,
      discount: 0,
      total: 127.57,
      paymentMethod: 'card',
      cashier: 'Juan García',
      cashierId: 'emp_001',
      status: 'completed'
    },
    {
      id: 'sale_002',
      date: new Date(Date.now() - 7200000).toISOString(),
      items: [
        { productId: 'prod_006', name: 'Auriculares Pro Gaming', quantity: 1, price: 149.99, subtotal: 149.99 }
      ],
      subtotal: 149.99,
      tax: 24.00,
      discount: 10,
      total: 163.99,
      paymentMethod: 'cash',
      cashier: 'María López',
      cashierId: 'emp_002',
      status: 'completed'
    },
    {
      id: 'sale_003',
      date: new Date(Date.now() - 86400000).toISOString(),
      items: [
        { productId: 'prod_002', name: 'Teclado Mecánico RGB', quantity: 1, price: 89.99, subtotal: 89.99 },
        { productId: 'prod_009', name: 'Mousepad XL Gaming', quantity: 2, price: 24.99, subtotal: 49.98 }
      ],
      subtotal: 139.97,
      tax: 22.40,
      discount: 0,
      total: 162.37,
      paymentMethod: 'card',
      cashier: 'Carlos Rodríguez',
      cashierId: 'emp_003',
      status: 'completed'
    },
    {
      id: 'sale_004',
      date: new Date(Date.now() - 172800000).toISOString(),
      items: [
        { productId: 'prod_005', name: 'Webcam HD 1080p', quantity: 3, price: 79.99, subtotal: 239.97 }
      ],
      subtotal: 239.97,
      tax: 38.40,
      discount: 20,
      total: 258.37,
      paymentMethod: 'card',
      cashier: 'Juan García',
      cashierId: 'emp_001',
      status: 'completed'
    },
    {
      id: 'sale_005',
      date: new Date(Date.now() - 259200000).toISOString(),
      items: [
        { productId: 'prod_008', name: 'Organizador de Cables', quantity: 5, price: 12.99, subtotal: 64.95 },
        { productId: 'prod_007', name: 'Lámpara LED Escritorio', quantity: 1, price: 34.99, subtotal: 34.99 }
      ],
      subtotal: 99.94,
      tax: 15.99,
      discount: 0,
      total: 115.93,
      paymentMethod: 'cash',
      cashier: 'María López',
      cashierId: 'emp_002',
      status: 'completed'
    },
  ],

  payments: [],

  customers: [],

  specialOrders: [],

  specialOrderPayments: [],

  auditLogs: [],

  shifts: [],

  inventoryLogs: [
    {
      id: 'log_001',
      date: new Date(Date.now() - 86400000).toISOString(),
      productId: 'prod_001',
      productName: 'Mouse Inalámbrico Pro',
      type: 'sale',
      quantity: -2,
      previousStock: 152,
      newStock: 150,
      reason: 'Venta sale_001',
      user: 'Juan García'
    },
    {
      id: 'log_002',
      date: new Date(Date.now() - 172800000).toISOString(),
      productId: 'prod_003',
      productName: 'Hub USB-C 7 en 1',
      type: 'adjustment',
      quantity: 50,
      previousStock: 150,
      newStock: 200,
      reason: 'Reabastecimiento de inventario',
      user: 'María López'
    },
    {
      id: 'log_003',
      date: new Date(Date.now() - 259200000).toISOString(),
      productId: 'prod_007',
      productName: 'Lámpara LED Escritorio',
      type: 'adjustment',
      quantity: -5,
      previousStock: 10,
      newStock: 5,
      reason: 'Corrección de inventario - productos dañados',
      user: 'María López'
    },
  ]
};

const DEMO_EMPLOYEE_IDS = new Set(['emp_001', 'emp_002', 'emp_003', 'emp_004']);
const DEMO_SHIFT_IDS = new Set(['shift_001', 'shift_002', 'shift_003']);
const DEMO_PRODUCT_IDS = new Set([
  'prod_001',
  'prod_002',
  'prod_003',
  'prod_004',
  'prod_005',
  'prod_006',
  'prod_007',
  'prod_008',
  'prod_009',
  'prod_010'
]);
const DEMO_SALE_IDS = new Set(['sale_001', 'sale_002', 'sale_003', 'sale_004', 'sale_005']);

const removeDemoPeopleData = (data) => {
  const safeData = { ...data };

  if (Array.isArray(safeData.employees)) {
    safeData.employees = safeData.employees.filter((employee) => !DEMO_EMPLOYEE_IDS.has(employee.id));
  } else {
    safeData.employees = [];
  }

  if (Array.isArray(safeData.shifts)) {
    safeData.shifts = safeData.shifts.filter(
      (shift) => !DEMO_SHIFT_IDS.has(shift.id) && !DEMO_EMPLOYEE_IDS.has(shift.employeeId)
    );
  } else {
    safeData.shifts = [];
  }

  if (Array.isArray(safeData.products)) {
    safeData.products = safeData.products.filter((product) => !DEMO_PRODUCT_IDS.has(product.id));
  } else {
    safeData.products = [];
  }

  if (Array.isArray(safeData.sales)) {
    safeData.sales = safeData.sales.filter(
      (sale) => !DEMO_SALE_IDS.has(sale.id) && !DEMO_EMPLOYEE_IDS.has(sale.cashierId)
    );
  } else {
    safeData.sales = [];
  }

  if (!Array.isArray(safeData.payments)) {
    safeData.payments = [];
  }

  if (!Array.isArray(safeData.customers)) {
    safeData.customers = [];
  }

  if (!Array.isArray(safeData.specialOrders)) {
    safeData.specialOrders = [];
  }

  if (!Array.isArray(safeData.specialOrderPayments)) {
    safeData.specialOrderPayments = [];
  }

  if (!Array.isArray(safeData.auditLogs)) {
    safeData.auditLogs = [];
  }

  return safeData;
};

const normalizeSalePaymentData = (sale = {}) => {
  const normalizedMethod = normalizePaymentMethod(sale.paymentMethod || sale.payment_method);

  return {
    ...sale,
    paymentMethod: normalizedMethod,
    payment_method: normalizedMethod,
    payments: Array.isArray(sale.payments)
      ? sale.payments.map((payment) => ({
          ...payment,
          method: normalizePaymentMethod(payment.method)
        }))
      : sale.paymentMethod
        ? [
            {
              id: `legacy_${sale.id}`,
              transaction_id: sale.id,
              method: normalizedMethod,
              amount: sale.total || 0,
              processor: normalizedMethod === 'card' ? 'clover' : null,
              reference: null,
              confirmed_by: sale.cashier || '',
              confirmed_at: sale.date || sale.created_at || new Date().toISOString(),
              status: 'paid'
            }
          ]
        : []
  };
};

const normalizePayments = (payments = []) =>
  payments.map((payment) => ({
    ...payment,
    method: normalizePaymentMethod(payment.method)
  }));

const normalizeCustomers = (customers = []) =>
  customers.map((customer) => ({
    id: customer.id || `customer_${Date.now()}`,
    name: customer.name || '',
    phone: customer.phone || '',
    email: customer.email || '',
    notes: customer.notes || '',
    active: customer.active !== false,
    createdAt: customer.createdAt || customer.created_at || new Date().toISOString(),
    updatedAt: customer.updatedAt || customer.updated_at || new Date().toISOString()
  }));

const normalizeSpecialOrders = (orders = []) =>
  orders.map((order) => normalizeSpecialOrder(order));

const normalizeSpecialOrderPayments = (payments = []) =>
  payments.map((payment) => normalizeSpecialOrderPayment(payment));

const normalizeAuditLogs = (logs = []) =>
  logs.map((log) => ({
    id: log.id || `audit_${Date.now()}`,
    entityType: log.entityType || log.entity_type || '',
    entityId: log.entityId || log.entity_id || '',
    action: log.action || '',
    description: log.description || '',
    metadata: log.metadata || {},
    performedBy: log.performedBy || log.performed_by || '',
    performedById: log.performedById || log.performed_by_id || '',
    createdAt: log.createdAt || log.created_at || new Date().toISOString()
  }));

// Función para cargar datos desde localStorage o usar datos iniciales
export const loadData = () => {
  const savedData = localStorage.getItem('posData');
  if (savedData) {
    const parsed = JSON.parse(savedData);
    const cleaned = removeDemoPeopleData(parsed);
    cleaned.store = {
      ...(cleaned.store || {}),
      ...normalizePrintSettings(cleaned.store || {})
    };
    if (Array.isArray(cleaned.products)) {
      cleaned.products = cleaned.products.map(normalizeProductTaxConfig);
    }
    if (Array.isArray(cleaned.sales)) {
      cleaned.sales = cleaned.sales.map(normalizeSalePaymentData);
    }
    cleaned.sales = mergeWeeklyCachedSales(cleaned.sales || []);
    cleaned.payments = normalizePayments(cleaned.payments || []);
    cleaned.customers = normalizeCustomers(cleaned.customers || []);
    cleaned.specialOrderPayments = normalizeSpecialOrderPayments(cleaned.specialOrderPayments || []);
    cleaned.specialOrders = normalizeSpecialOrders(cleaned.specialOrders || []).map((order) => {
      const orderPayments = cleaned.specialOrderPayments.filter((payment) => payment.specialOrderId === order.id);
      return normalizeSpecialOrder({
        ...order,
        payments: orderPayments.length > 0 ? orderPayments : order.payments
      });
    });
    cleaned.auditLogs = normalizeAuditLogs(cleaned.auditLogs || []);

    // Persistimos limpieza una sola vez para no seguir cargando demo data vieja.
    if (JSON.stringify(parsed) !== JSON.stringify(cleaned)) {
      localStorage.setItem('posData', JSON.stringify(cleaned));
    }

    return cleaned;
  }
  const data = removeDemoPeopleData(initialData);
  data.store = {
    ...(data.store || {}),
    ...normalizePrintSettings(data.store || {})
  };
  if (Array.isArray(data.products)) {
    data.products = data.products.map(normalizeProductTaxConfig);
  }
  if (Array.isArray(data.sales)) {
    data.sales = data.sales.map(normalizeSalePaymentData);
  }
  data.sales = mergeWeeklyCachedSales(data.sales || []);
  data.payments = normalizePayments(data.payments || []);
  data.customers = normalizeCustomers(data.customers || []);
  data.specialOrderPayments = normalizeSpecialOrderPayments(data.specialOrderPayments || []);
  data.specialOrders = normalizeSpecialOrders(data.specialOrders || []).map((order) => {
    const orderPayments = data.specialOrderPayments.filter((payment) => payment.specialOrderId === order.id);
    return normalizeSpecialOrder({
      ...order,
      payments: orderPayments.length > 0 ? orderPayments : order.payments
    });
  });
  data.auditLogs = normalizeAuditLogs(data.auditLogs || []);
  return data;
};

// Función para guardar datos en localStorage
export const saveData = (data) => {
  localStorage.setItem('posData', JSON.stringify(data));
};

// Función para resetear datos
export const resetData = () => {
  localStorage.setItem('posData', JSON.stringify(initialData));
  return initialData;
};

// Funciones de utilidad
export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
};

export const formatDate = (date) => {
  return new Date(date).toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

export const formatDateTime = (date) => {
  return new Date(date).toLocaleString('es-ES', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const generateId = (prefix = 'id') => {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const formatDuration = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
};
