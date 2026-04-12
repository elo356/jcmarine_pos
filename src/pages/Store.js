import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Store, LogIn, LogOut, Receipt, DollarSign, CalendarClock } from 'lucide-react';
import { loadData, formatCurrency, formatDateTime, generateId, normalizePrintSettings } from '../data/demoData';
import Modal from '../components/Modal';
import Input from '../components/Input';
import Notification from '../components/Notification';
import { useAuth } from '../contexts/AuthContext';
import { subscribeEmployees } from '../services/employeesService';
import { subscribeSales } from '../services/salesService';
import { createStoreStatusLog, subscribeStoreStatusLogs } from '../services/storeStatusLogService';
import { PAYMENT_METHODS } from '../utils/paymentUtils';
import { buildStoreClosurePrintHtml } from '../utils/printTemplates';
import { getNetSaleTotal, getSaleRefundTotal, isReportableSale } from '../utils/salesUtils';
import { printHtmlDocument } from '../services/printService';

const DEFAULT_CLOSE_FORM = {
  actualCashAmount: '',
  paidIn: '',
  paidOut: '',
  note: ''
};

const getNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const StorePage = () => {
  const { user, profile } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [sales, setSales] = useState([]);
  const [storeStatusLogs, setStoreStatusLogs] = useState([]);
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [startingCash, setStartingCash] = useState('');
  const [openNote, setOpenNote] = useState('');
  const [closeForm, setCloseForm] = useState(DEFAULT_CLOSE_FORM);
  const [notification, setNotification] = useState(null);

  const resolveCurrentEmployee = useCallback((rows) => {
    if (!user) return null;

    const byUid = rows.find((employee) => employee.uid && employee.uid === user.uid);
    if (byUid) return byUid;

    const byId = rows.find((employee) => employee.id === user.uid);
    if (byId) return byId;

    const byEmail = rows.find(
      (employee) => (employee.email || '').toLowerCase() === (user.email || '').toLowerCase()
    );
    if (byEmail) return byEmail;

    return {
      id: user.uid,
      uid: user.uid,
      name: profile?.name || user.email || 'Usuario',
      email: user.email || '',
      role: profile?.role || 'cashier'
    };
  }, [profile?.name, profile?.role, user]);

  useEffect(() => {
    const data = loadData();
    setEmployees(data.employees || []);
    setSales(data.sales || []);

    const unsubEmployees = subscribeEmployees(
      (rows) => setEmployees(rows),
      (error) => console.error('Error subscribing employees in store page:', error)
    );
    const unsubSales = subscribeSales(
      (rows) => setSales(rows),
      (error) => console.error('Error subscribing sales in store page:', error)
    );
    const unsubStoreStatusLogs = subscribeStoreStatusLogs(
      (rows) => setStoreStatusLogs(rows),
      (error) => console.error('Error subscribing store status logs in store page:', error)
    );

    return () => {
      unsubEmployees();
      unsubSales();
      unsubStoreStatusLogs();
    };
  }, []);

  const currentEmployee = useMemo(
    () => resolveCurrentEmployee(employees),
    [employees, resolveCurrentEmployee]
  );

  const latestStoreLog = useMemo(
    () => [...storeStatusLogs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null,
    [storeStatusLogs]
  );

  const activeStoreSession = useMemo(() => {
    if (!latestStoreLog || latestStoreLog.action !== 'open') return null;
    return latestStoreLog;
  }, [latestStoreLog]);

  const isStoreOpen = Boolean(activeStoreSession);

  const activeSessionSales = useMemo(() => {
    if (!activeStoreSession) return [];
    const openedAtMs = new Date(activeStoreSession.createdAt).getTime();

    return sales.filter((sale) => {
      const saleTime = new Date(sale.date).getTime();
      return saleTime >= openedAtMs;
    });
  }, [activeStoreSession, sales]);

  const closeSummary = useMemo(() => {
    if (!activeStoreSession) return null;

    const paidSales = activeSessionSales.filter(isReportableSale);
    const grossSales = roundMoney(paidSales.reduce((sum, sale) => sum + Number(sale.subtotal || 0), 0));
    const discounts = roundMoney(paidSales.reduce((sum, sale) => sum + Number(sale.discount || 0), 0));
    const refunds = roundMoney(activeSessionSales.reduce((sum, sale) => sum + getSaleRefundTotal(sale), 0));
    const taxes = roundMoney(paidSales.reduce((sum, sale) => sum + Number(sale.tax || 0), 0));
    const totalTendered = roundMoney(paidSales.reduce((sum, sale) => sum + getNetSaleTotal(sale), 0));
    const cashPayments = roundMoney(
      paidSales
        .filter((sale) => sale.paymentMethod === PAYMENT_METHODS.cash)
        .reduce((sum, sale) => sum + getNetSaleTotal(sale), 0)
    );
    const athMovilPayments = roundMoney(
      paidSales
        .filter((sale) => sale.paymentMethod === PAYMENT_METHODS.athMovil)
        .reduce((sum, sale) => sum + getNetSaleTotal(sale), 0)
    );
    const cardPayments = roundMoney(
      paidSales
        .filter((sale) => sale.paymentMethod === PAYMENT_METHODS.card)
        .reduce((sum, sale) => sum + getNetSaleTotal(sale), 0)
    );
    const cashRefunds = roundMoney(
      activeSessionSales
        .filter((sale) => sale.paymentMethod === PAYMENT_METHODS.cash)
        .reduce((sum, sale) => sum + getSaleRefundTotal(sale), 0)
    );
    const paidIn = roundMoney(getNumber(closeForm.paidIn));
    const paidOut = roundMoney(getNumber(closeForm.paidOut));
    const startingCashAmount = roundMoney(activeStoreSession.startingCash || 0);
    const expectedCashAmount = roundMoney(startingCashAmount + cashPayments - cashRefunds + paidIn - paidOut);
    const actualCashAmount = roundMoney(getNumber(closeForm.actualCashAmount));
    const difference = roundMoney(actualCashAmount - expectedCashAmount);

    return {
      shiftNumber: activeStoreSession.shiftNumber || 1,
      openedAt: activeStoreSession.createdAt,
      openedByName: activeStoreSession.employeeName || '-',
      closeTime: new Date().toISOString(),
      closedByName: currentEmployee?.name || profile?.name || user?.email || 'Usuario',
      startingCash: startingCashAmount,
      cashPayments,
      cashRefunds,
      paidIn,
      paidOut,
      expectedCashAmount,
      actualCashAmount,
      difference,
      grossSales,
      refunds,
      discounts,
      netSales: roundMoney(grossSales - discounts - refunds),
      taxes,
      totalTendered,
      tenders: {
        cash: cashPayments,
        athMovil: athMovilPayments,
        card: cardPayments
      }
    };
  }, [activeSessionSales, activeStoreSession, closeForm.actualCashAmount, closeForm.paidIn, closeForm.paidOut, currentEmployee?.name, profile?.name, user?.email]);

  const historyRows = useMemo(() => {
    return [...storeStatusLogs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [storeStatusLogs]);

  const handleOpenStore = async () => {
    if (isStoreOpen) {
      setNotification({ type: 'error', message: 'La tienda ya está abierta.' });
      return;
    }

    const actor = currentEmployee || {
      id: user?.uid || profile?.id || 'unknown',
      name: profile?.name || user?.email || 'Usuario',
      role: profile?.role || 'cashier',
      email: user?.email || profile?.email || ''
    };

    const nextShiftNumber = historyRows.filter((row) => row.action === 'open').length + 1;
    const log = {
      id: generateId(),
      action: 'open',
      shiftNumber: nextShiftNumber,
      createdAt: new Date().toISOString(),
      employeeId: actor.id,
      employeeName: actor.name,
      employeeRole: actor.role,
      employeeEmail: actor.email || '',
      note: openNote.trim(),
      startingCash: roundMoney(getNumber(startingCash)),
      source: 'store'
    };

    try {
      await createStoreStatusLog(log);
      setShowOpenModal(false);
      setStartingCash('');
      setOpenNote('');
      setNotification({ type: 'success', message: 'Apertura de tienda registrada.' });
    } catch (error) {
      console.error(error);
      setNotification({ type: 'error', message: 'No se pudo registrar la apertura de tienda.' });
    }
  };

  const getReceiptPrinter = () => {
    const data = loadData();
    const store = {
      ...(data.store || {}),
      ...normalizePrintSettings(data.store || {})
    };
    return (store.printers || []).find((printer) => printer.id === store.printRouting.receiptPrinterId) || null;
  };

  const handlePrintCloseSummary = async () => {
    if (!closeSummary) return;

    const printer = getReceiptPrinter();

    try {
      await printHtmlDocument({
        title: `Cierre tienda turno ${closeSummary.shiftNumber}`,
        html: buildStoreClosurePrintHtml({
          summary: closeSummary,
          printerName: printer?.name || ''
        }),
        printer
      });

      setNotification({ type: 'success', message: 'Resumen de cierre enviado a impresión.' });
    } catch (error) {
      console.error(error);
      setNotification({ type: 'error', message: 'No se pudo imprimir el resumen de cierre.' });
    }
  };

  const handleCloseStore = async () => {
    if (!activeStoreSession || !closeSummary) {
      setNotification({ type: 'error', message: 'No hay una tienda abierta para cerrar.' });
      return;
    }

    const actor = currentEmployee || {
      id: user?.uid || profile?.id || 'unknown',
      name: profile?.name || user?.email || 'Usuario',
      role: profile?.role || 'cashier',
      email: user?.email || profile?.email || ''
    };

    const log = {
      id: generateId(),
      action: 'close',
      shiftNumber: closeSummary.shiftNumber,
      createdAt: closeSummary.closeTime,
      employeeId: actor.id,
      employeeName: actor.name,
      employeeRole: actor.role,
      employeeEmail: actor.email || '',
      note: closeForm.note.trim(),
      openedAt: activeStoreSession.createdAt,
      openedByName: activeStoreSession.employeeName || '',
      startingCash: closeSummary.startingCash,
      paidIn: closeSummary.paidIn,
      paidOut: closeSummary.paidOut,
      expectedCashAmount: closeSummary.expectedCashAmount,
      actualCashAmount: closeSummary.actualCashAmount,
      difference: closeSummary.difference,
      summary: {
        cashDrawer: {
          startingCash: closeSummary.startingCash,
          cashPayments: closeSummary.cashPayments,
          cashRefunds: closeSummary.cashRefunds,
          paidIn: closeSummary.paidIn,
          paidOut: closeSummary.paidOut,
          expectedCashAmount: closeSummary.expectedCashAmount,
          actualCashAmount: closeSummary.actualCashAmount,
          difference: closeSummary.difference
        },
        sales: {
          grossSales: closeSummary.grossSales,
          refunds: closeSummary.refunds,
          discounts: closeSummary.discounts,
          netSales: closeSummary.netSales,
          taxes: closeSummary.taxes,
          totalTendered: closeSummary.totalTendered,
          cash: closeSummary.tenders.cash,
          athMovil: closeSummary.tenders.athMovil,
          card: closeSummary.tenders.card
        }
      },
      source: 'store'
    };

    try {
      await createStoreStatusLog(log);
      setShowCloseModal(false);
      setCloseForm(DEFAULT_CLOSE_FORM);
      setNotification({ type: 'success', message: 'Cierre de tienda registrado.' });
    } catch (error) {
      console.error(error);
      setNotification({ type: 'error', message: 'No se pudo registrar el cierre de tienda.' });
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Store className="text-primary-600" size={28} />
          <h1 className="page-title">Tienda</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowOpenModal(true)} className="btn-primary" disabled={isStoreOpen}>
            <LogIn size={16} className="mr-2" />
            Abrir tienda
          </button>
          <button onClick={() => setShowCloseModal(true)} className="btn-secondary" disabled={!isStoreOpen}>
            <LogOut size={16} className="mr-2" />
            Cerrar tienda
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="card">
          <div className="stat-label">Estado actual</div>
          <div className="stat-value">{isStoreOpen ? 'Abierta' : 'Cerrada'}</div>
          <div className="stat-trend">
            <Store size={16} className={isStoreOpen ? 'text-green-500' : 'text-gray-500'} />
            <span className={isStoreOpen ? 'text-green-500' : 'text-gray-500'}>
              {isStoreOpen ? `Turno #${activeStoreSession?.shiftNumber || 1}` : 'Sin turno abierto'}
            </span>
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Apertura</div>
          <div className="stat-value text-lg">{activeStoreSession ? formatDateTime(activeStoreSession.createdAt) : '-'}</div>
          <div className="stat-trend">
            <CalendarClock size={16} className="text-blue-500" />
            <span className="text-blue-500">{activeStoreSession?.employeeName || 'Sin apertura activa'}</span>
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Cuadre esperado</div>
          <div className="stat-value">{closeSummary ? formatCurrency(closeSummary.expectedCashAmount) : formatCurrency(0)}</div>
          <div className="stat-trend">
            <DollarSign size={16} className="text-green-500" />
            <span className="text-green-500">Caja esperada</span>
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Ventas del turno</div>
          <div className="stat-value">{closeSummary ? formatCurrency(closeSummary.totalTendered) : formatCurrency(0)}</div>
          <div className="stat-trend">
            <Receipt size={16} className="text-purple-500" />
            <span className="text-purple-500">Total tendered</span>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 pt-6">
          <h2 className="text-lg font-semibold text-gray-900">Historial de apertura y cierre</h2>
          <p className="text-sm text-gray-500">
            Aquí queda el historial de tienda con aperturas, cierres y cuadre registrado.
          </p>
        </div>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Shift #</th>
                <th>Fecha y hora</th>
                <th>Empleado</th>
                <th>Inicial</th>
                <th>Esperado</th>
                <th>Actual</th>
                <th>Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.length === 0 ? (
                <tr>
                  <td colSpan="8" className="text-center py-8 text-gray-500">
                    No hay historial de tienda todavía
                  </td>
                </tr>
              ) : (
                historyRows.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td>
                      <span className={log.action === 'open' ? 'badge badge-green' : 'badge badge-gray'}>
                        {log.action === 'open' ? 'Apertura' : 'Cierre'}
                      </span>
                    </td>
                    <td>#{log.shiftNumber || '-'}</td>
                    <td>{formatDateTime(log.createdAt)}</td>
                    <td>{log.employeeName || '-'}</td>
                    <td>{formatCurrency(log.startingCash || 0)}</td>
                    <td>{log.action === 'close' ? formatCurrency(log.expectedCashAmount || 0) : '-'}</td>
                    <td>{log.action === 'close' ? formatCurrency(log.actualCashAmount || 0) : '-'}</td>
                    <td>{log.action === 'close' ? formatCurrency(log.difference || 0) : '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showOpenModal && (
        <Modal isOpen={showOpenModal} onClose={() => setShowOpenModal(false)} title="Abrir tienda" size="md">
          <div className="space-y-4">
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-sm text-gray-600">Empleado</p>
              <p className="font-semibold text-gray-900">{currentEmployee?.name || profile?.name || user?.email}</p>
            </div>

            <Input
              label="Starting Cash"
              type="number"
              min="0"
              step="0.01"
              value={startingCash}
              onChange={(e) => setStartingCash(e.target.value)}
              placeholder="0.00"
            />

            <Input
              label="Nota de apertura"
              value={openNote}
              onChange={(e) => setOpenNote(e.target.value)}
              placeholder="Ej. apertura del turno mañana"
            />

            <div className="flex justify-end gap-2 pt-4">
              <button onClick={() => setShowOpenModal(false)} className="btn-secondary">
                Cancelar
              </button>
              <button onClick={handleOpenStore} className="btn-primary">
                <LogIn size={16} className="mr-2" />
                Confirmar apertura
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showCloseModal && closeSummary && (
        <Modal isOpen={showCloseModal} onClose={() => setShowCloseModal(false)} title="Cerrar tienda" size="xl">
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="card bg-gray-50">
                <p className="text-sm text-gray-500">Shift Number</p>
                <p className="text-xl font-bold text-gray-900">#{closeSummary.shiftNumber}</p>
              </div>
              <div className="card bg-gray-50">
                <p className="text-sm text-gray-500">Empleado que cierra</p>
                <p className="text-xl font-bold text-gray-900">{closeSummary.closedByName}</p>
              </div>
              <div className="card bg-gray-50">
                <p className="text-sm text-gray-500">Abrió tienda</p>
                <p className="font-semibold text-gray-900">{closeSummary.openedByName}</p>
                <p className="text-sm text-gray-500">{formatDateTime(closeSummary.openedAt)}</p>
              </div>
              <div className="card bg-gray-50">
                <p className="text-sm text-gray-500">Cierra tienda</p>
                <p className="font-semibold text-gray-900">{closeSummary.closedByName}</p>
                <p className="text-sm text-gray-500">{formatDateTime(closeSummary.closeTime)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Actual Cash Amount"
                type="number"
                min="0"
                step="0.01"
                value={closeForm.actualCashAmount}
                onChange={(e) => setCloseForm((prev) => ({ ...prev, actualCashAmount: e.target.value }))}
                placeholder="0.00"
              />
              <Input
                label="Paid In"
                type="number"
                min="0"
                step="0.01"
                value={closeForm.paidIn}
                onChange={(e) => setCloseForm((prev) => ({ ...prev, paidIn: e.target.value }))}
                placeholder="0.00"
              />
              <Input
                label="Paid Out"
                type="number"
                min="0"
                step="0.01"
                value={closeForm.paidOut}
                onChange={(e) => setCloseForm((prev) => ({ ...prev, paidOut: e.target.value }))}
                placeholder="0.00"
              />
              <Input
                label="Nota de cierre"
                value={closeForm.note}
                onChange={(e) => setCloseForm((prev) => ({ ...prev, note: e.target.value }))}
                placeholder="Observaciones del cierre"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Cash Drawer</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Starting Cash</span><strong>{formatCurrency(closeSummary.startingCash)}</strong></div>
                  <div className="flex justify-between"><span>Cash Payments</span><strong>{formatCurrency(closeSummary.cashPayments)}</strong></div>
                  <div className="flex justify-between"><span>Cash Refunds</span><strong>{formatCurrency(closeSummary.cashRefunds)}</strong></div>
                  <div className="flex justify-between"><span>Paid In</span><strong>{formatCurrency(closeSummary.paidIn)}</strong></div>
                  <div className="flex justify-between"><span>Paid Out</span><strong>{formatCurrency(closeSummary.paidOut)}</strong></div>
                  <div className="flex justify-between border-t pt-2"><span>Expected Cash Amount</span><strong>{formatCurrency(closeSummary.expectedCashAmount)}</strong></div>
                  <div className="flex justify-between"><span>Actual Cash Amount</span><strong>{formatCurrency(closeSummary.actualCashAmount)}</strong></div>
                  <div className="flex justify-between border-t pt-2">
                    <span>Difference</span>
                    <strong className={closeSummary.difference === 0 ? 'text-gray-900' : closeSummary.difference > 0 ? 'text-green-600' : 'text-red-600'}>
                      {formatCurrency(closeSummary.difference)}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Sales Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Gross Sales</span><strong>{formatCurrency(closeSummary.grossSales)}</strong></div>
                  <div className="flex justify-between"><span>Refunds</span><strong>{formatCurrency(closeSummary.refunds)}</strong></div>
                  <div className="flex justify-between"><span>Discounts</span><strong>{formatCurrency(closeSummary.discounts)}</strong></div>
                  <div className="flex justify-between"><span>Net Sales</span><strong>{formatCurrency(closeSummary.netSales)}</strong></div>
                  <div className="flex justify-between"><span>Taxes</span><strong>{formatCurrency(closeSummary.taxes)}</strong></div>
                  <div className="flex justify-between border-t pt-2"><span>Total Tendered</span><strong>{formatCurrency(closeSummary.totalTendered)}</strong></div>
                  <div className="flex justify-between"><span>Cash</span><strong>{formatCurrency(closeSummary.tenders.cash)}</strong></div>
                  <div className="flex justify-between"><span>ATH Móvil</span><strong>{formatCurrency(closeSummary.tenders.athMovil)}</strong></div>
                  <div className="flex justify-between"><span>Tarjeta</span><strong>{formatCurrency(closeSummary.tenders.card)}</strong></div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <button onClick={handlePrintCloseSummary} className="btn-secondary">
                <Receipt size={16} className="mr-2" />
                Imprimir recibo
              </button>
              <button onClick={() => setShowCloseModal(false)} className="btn-secondary">
                Cancelar
              </button>
              <button onClick={handleCloseStore} className="btn-primary">
                <LogOut size={16} className="mr-2" />
                Confirmar cierre
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

export default StorePage;
