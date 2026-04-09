import React, { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  DollarSign,
  Warehouse,
  Clock,
  Users,
  BarChart3,
  Printer,
  ClipboardList,
  ShieldCheck,
  Menu,
  X,
  LogOut,
  User
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Products from './pages/Products';
import Sales from './pages/Sales';
import Inventory from './pages/Inventory';
import Shifts from './pages/Shifts';
import Employees from './pages/Employees';
import Reports from './pages/Reports';
import Printers from './pages/Printers';
import SpecialOrders from './pages/SpecialOrders';
import RolesPermissions from './pages/RolesPermissions';
import Login from './pages/Login';
import { useAuth } from './contexts/AuthContext';
import { startSessionPresence } from './services/systemPresenceService';
import { useActiveSystemsCount } from './hooks/useActiveSystemsCount';
import { purgeDemoDataIfNeeded } from './services/dataCleanupService';
import { useRoleDefinitions } from './hooks/useRoleDefinitions';

const SIDEBAR_ITEMS = [
  { id: 'dashboard', label: 'Panel', icon: LayoutDashboard },
  { id: 'pos', label: 'Punto de Venta', icon: ShoppingCart },
  { id: 'products', label: 'Productos', icon: Package },
  { id: 'sales', label: 'Ventas', icon: DollarSign },
  { id: 'special_orders', label: 'Pedidos especiales', icon: ClipboardList },
  { id: 'inventory', label: 'Inventario', icon: Warehouse },
  { id: 'shifts', label: 'Turnos', icon: Clock },
  { id: 'employees', label: 'Empleados', icon: Users },
  { id: 'reports', label: 'Reportes', icon: BarChart3 },
  { id: 'printers', label: 'Impresoras', icon: Printer },
  { id: 'manage_roles', label: 'Roles y permisos', icon: ShieldCheck, adminOnly: true }
];

function App() {
  const { user, profile, loading, logout } = useAuth();
  const { resolveRoleDefinition } = useRoleDefinitions();
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingProductDraft, setPendingProductDraft] = useState(null);
  const activeSystemsCount = useActiveSystemsCount(profile?.role === 'admin');

  const allowedPages = useMemo(() => {
    const normalizedRole = profile?.role === 'inventory' ? 'manager' : (profile?.role || 'cashier');
    return resolveRoleDefinition(normalizedRole)?.permissions || resolveRoleDefinition('cashier')?.permissions || [];
  }, [profile?.role, resolveRoleDefinition]);

  const visibleItems = useMemo(
    () => SIDEBAR_ITEMS.filter((item) => allowedPages.includes(item.id) && (!item.adminOnly || profile?.role === 'admin')),
    [allowedPages, profile?.role]
  );

  useEffect(() => {
    if (!allowedPages.includes(currentPage)) {
      setCurrentPage(allowedPages[0] || 'dashboard');
    }
  }, [allowedPages, currentPage]);

  useEffect(() => {
    if (!user || !profile) return () => {};
    return startSessionPresence(user, profile);
  }, [user, profile]);

  useEffect(() => {
    if (profile?.role !== 'admin') return;
    purgeDemoDataIfNeeded().catch((error) => {
      console.error('Error purging demo data:', error);
    });
  }, [profile?.role]);

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard />;
      case 'pos':
        return (
          <POS
            onCreateProductFromBarcode={(barcode) => {
              setPendingProductDraft({ barcode });
              setCurrentPage('products');
            }}
            onEditProductFromScan={(productId) => {
              setPendingProductDraft({ productId });
              setCurrentPage('products');
            }}
            onOpenSpecialOrders={() => setCurrentPage('special_orders')}
          />
        );
      case 'products':
        return (
          <Products
            pendingDraft={pendingProductDraft}
            onPendingDraftHandled={() => setPendingProductDraft(null)}
          />
        );
      case 'sales':
        return <Sales />;
      case 'special_orders':
        return (
          <SpecialOrders
            onCreateProductRequested={(draft) => {
              setPendingProductDraft(draft);
              setCurrentPage('products');
            }}
          />
        );
      case 'inventory':
        return <Inventory />;
      case 'shifts':
        return <Shifts />;
      case 'employees':
        return <Employees />;
      case 'reports':
        return <Reports />;
      case 'printers':
        return <Printers />;
      case 'manage_roles':
        return <RolesPermissions />;
      default:
        return <Dashboard />;
    }
  };

  const currentPageTitle = visibleItems.find((item) => item.id === currentPage)?.label || 'Panel';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-gray-600 font-medium">Cargando sesión...</div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-gray-50 lg:flex">
      <div className="lg:hidden fixed top-0 left-0 right-0 bg-white shadow-sm z-50 px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 hover:bg-gray-100 rounded-lg"
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <div className="flex items-center gap-2">
          <img
            src="/logo3-removebg-preview.png"
            alt="CJ Marine"
            className="h-10 w-10 object-contain"
          />
          <h1 className="text-xl font-bold text-primary-600">CJ Marine</h1>
        </div>
        <div className="w-8" />
      </div>

      <aside
        className={`fixed lg:sticky lg:top-0 inset-y-0 left-0 z-40 w-64 lg:h-screen lg:flex-shrink-0 bg-gradient-to-b from-primary-600 to-primary-800 text-white transform transition-transform duration-300 ease-in-out ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="p-6 border-b border-primary-500">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <img
              src="/logo3-removebg-preview.png"
              alt="CJ Marine"
              className="h-14 w-14 object-contain"
            />
            <span>CJ Marine</span>
          </h1>
        </div>

        <nav className="mt-6 px-4">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;

            return (
              <button
                key={item.id}
                onClick={() => {
                  setCurrentPage(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition-all ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'text-primary-100 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon size={20} />
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-primary-500">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-primary-500 rounded-full flex items-center justify-center">
              <User size={20} />
            </div>
            <div>
              <p className="font-medium">{profile?.name || user.email}</p>
              <p className="text-xs text-primary-200">{profile?.email || user.email}</p>
              <p className="text-xs text-primary-200 capitalize">{profile?.role || 'cashier'}</p>
            </div>
          </div>
          <button
            className="w-full flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-all"
            onClick={logout}
          >
            <LogOut size={18} />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <main className="flex-1 min-w-0 transition-all duration-300">
        <div className="pt-16 lg:pt-0">
          <header className="bg-white shadow-sm px-6 py-4 sticky top-0 z-20 hidden lg:block">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">{currentPageTitle}</h2>
                <p className="text-sm text-gray-500">
                  {new Date().toLocaleDateString('es-ES', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
              </div>
              <div className="flex items-center gap-4">
                {profile?.role === 'admin' && (
                  <div className="px-3 py-1.5 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm font-medium">
                    Sistemas abiertos: {activeSystemsCount}
                  </div>
                )}
                <button className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg relative">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                    <span className="font-bold text-gray-600">3</span>
                  </div>
                </button>
              </div>
            </div>
          </header>

          <div className="p-4 lg:p-8">{renderPage()}</div>
        </div>
      </main>
    </div>
  );
}

export default App;
