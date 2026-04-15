export const MODULE_PERMISSION_OPTIONS = [
  { id: 'dashboard', label: 'Panel' },
  { id: 'pos', label: 'Punto de Venta' },
  { id: 'products', label: 'Productos' },
  { id: 'sales', label: 'Ventas' },
  { id: 'notes', label: 'Notas' },
  { id: 'special_orders', label: 'Pedidos especiales' },
  { id: 'inventory', label: 'Inventario' },
  { id: 'shifts', label: 'Turnos' },
  { id: 'store', label: 'Tienda' },
  { id: 'employees', label: 'Empleados' },
  { id: 'reports', label: 'Reportes' },
  { id: 'printers', label: 'Impresoras' },
  { id: 'manage_categories', label: 'Gestionar categorias' },
  { id: 'manage_employees', label: 'Gestionar empleados' },
  { id: 'manage_roles', label: 'Roles y permisos' }
];

export const DEFAULT_ROLE_DEFINITIONS = [
  {
    id: 'admin',
    name: 'Admin',
    description: 'Acceso completo al sistema.',
    permissions: MODULE_PERMISSION_OPTIONS.map((permission) => permission.id),
    system: true
  },
  {
    id: 'manager',
    name: 'Manager',
    description: 'Operacion del negocio con acceso amplio.',
    permissions: [
      'dashboard',
      'pos',
      'products',
      'sales',
      'notes',
      'special_orders',
      'inventory',
      'shifts',
      'store',
      'reports',
      'printers',
      'manage_categories'
    ],
    system: true
  },
  {
    id: 'cashier',
    name: 'Cashier',
    description: 'Operacion de caja y seguimiento basico.',
    permissions: [
      'pos',
      'sales',
      'notes',
      'special_orders',
      'inventory',
      'shifts',
      'store'
    ],
    system: true
  }
];

export const PAGE_PERMISSION_IDS = [
  'dashboard',
  'pos',
  'products',
  'sales',
  'notes',
  'special_orders',
  'inventory',
  'shifts',
  'store',
  'employees',
  'reports',
  'printers',
  'manage_roles'
];
