import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Store, LogIn, LogOut, Receipt, DollarSign, CalendarClock, Printer, Calculator } from 'lucide-react';
import { loadData, formatCurrency, formatDateTime, generateId, normalizePrintSettings } from '../data/demoData';
import Modal from '../components/Modal';
import Input from '../components/Input';
import Notification from '../components/Notification';
import { useAuth } from '../contexts/AuthContext';
import { subscribeEmployees } from '../services/employeesService';
import { subscribeSales } from '../services/salesService';
import { subscribeShifts } from '../services/shiftsService';
import { verifyFirestoreAvailability } from '../services/firestoreHealthService';
import { createStoreStatusLog, subscribeStoreStatusLogs } from '../services/storeStatusLogService';
import { saveWeeklyShiftClosure, subscribeWeeklyShiftClosures } from '../services/weeklyShiftClosureService';
import { subscribeSpecialOrderPayments } from '../services/specialOrdersService';
import { normalizePaymentMethod, PAYMENT_METHODS } from '../utils/paymentUtils';
import { buildStoreClosurePrintHtml } from '../utils/printTemplates';
import { getNetSaleTotal, getSaleRefundTotal, isReportableSale } from '../utils/salesUtils';
import { getStandaloneSpecialOrderPaymentNet } from '../utils/specialOrderUtils';
import { printHtmlDocument } from '../services/printService';
import {
  buildWeeklyShiftClosureRecord,
  calculateEmployeeWeeklyShiftStats,
  getAutomaticWeeklyClosuresToCreate
} from '../utils/weeklyShiftUtils';

const CASH_COUNT_FIELDS = [
  { key: '100', label: '$100', value: 100 },
  { key: '50', label: '$50', value: 50 },
  { key: '20', label: '$20', value: 20 },
  { key: '10', label: '$10', value: 10 },
  { key: '5', label: '$5', value: 5 },
  { key: '1', label: '$1', value: 1 },
  { key: 'quarter', label: '25c', value: 0.25 },
  { key: 'dime', label: '10c', value: 0.10 },
  { key: 'nickel', label: '5c', value: 0.05 },
  { key: 'penny', label: '1c', value: 0.01 }
];

const DEFAULT_CLOSE_FORM = {
  actualCashAmount: '',
  paidIn: '',
  paidOut: '',
  note: '',
  cashCountBreakdown: {}
};

const getNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const getCashCountTotal = (cashCountBreakdown = {}) => roundMoney(
  CASH_COUNT_FIELDS.reduce(
    (sum, field) => sum + (getNumber(cashCountBreakdown[field.key]) * field.value),
    0
  )
);

const StorePage = () => {
  const { user, profile } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [sales, setSales] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [specialOrderPayments, setSpecialOrderPayments] = useState([]);
  const [storeStatusLogs, setStoreStatusLogs] = useState([]);
  const [weeklyShiftClosures, setWeeklyShiftClosures] = useState([]);
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showCashCountModal, setShowCashCountModal] = useState(false);
  const [startingCash, setStartingCash] = useState('');
  const [openNote, setOpenNote] = useState('');
  const [closeForm, setCloseForm] = useState(DEFAULT_CLOSE_FORM);
  const [notification, setNotification] = useState(null);
  const [firestoreReady, setFirestoreReady] = useState(true);

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
    verifyFirestoreAvailability().then((status) => {
      setFirestoreReady(status.ok);
    });

    const data = loadData();
    setEmployees(data.employees || []);
    setSales(data.sales || []);
    setSpecialOrderPayments(data.specialOrderPayments || []);

    const unsubEmployees = subscribeEmployees(
      (rows) => setEmployees(rows),
      (error) => console.error('Error subscribing employees in store page:', error)
    );
    const unsubSales = subscribeSales(
      (rows) => setSales(rows),
      (error) => console.error('Error subscribing sales in store page:', error)
    );
    const unsubShifts = subscribeShifts(
      (rows) => setShifts(rows),
      (error) => console.error('Error subscribing shifts in store page:', error)
    );
    const unsubStoreStatusLogs = subscribeStoreStatusLogs(
      (rows) => setStoreStatusLogs(rows),
      (error) => console.error('Error subscribing store status logs in store page:', error)
    );
    const unsubWeeklyShiftClosures = subscribeWeeklyShiftClosures(
      (rows) => setWeeklyShiftClosures(rows),
      (error) => console.error('Error subscribing weekly shift closures in store page:', error)
    );
    const unsubSpecialPayments = subscribeSpecialOrderPayments(
      (rows) => setSpecialOrderPayments(rows),
      (error) => console.error('Error subscribing special order payments in store page:', error)
    );

    return () => {
      unsubEmployees();
      unsubSales();
      unsubShifts();
      unsubStoreStatusLogs();
      unsubSpecialPayments();
      unsubWeeklyShiftClosures();
    };
  }, []);

  const ensureFirestoreReady = useCallback(async () => {
    const status = await verifyFirestoreAvailability({ force: true });
    setFirestoreReady(status.ok);

    if (!status.ok) {
      setNotification({
        type: 'error',
        message: 'Firestore no esta disponible. No se puede abrir o cerrar la tienda hasta que vuelva a responder.'
      });
      return false;
    }

    return true;
  }, []);

  const currentEmployee = useMemo(
    () => resolveCurrentEmployee(employees),
    [employees, resolveCurrentEmployee]
  );
  const currentActor = useMemo(
    () => ({
      id: currentEmployee?.id || user?.uid || profile?.id || 'unknown',
      name: currentEmployee?.name || profile?.name || user?.email || 'Usuario',
      role: currentEmployee?.role || profile?.role || 'cashier',
      email: currentEmployee?.email || user?.email || profile?.email || ''
    }),
    [currentEmployee, profile?.email, profile?.id, profile?.name, profile?.role, user?.email, user?.uid]
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

    const openedAtMs = new Date(activeStoreSession.createdAt).getTime();
    const paidSales = activeSessionSales.filter(isReportableSale);
    const standalonePayments = (specialOrderPayments || []).filter((payment) => {
      const paymentTime = new Date(payment.createdAt || payment.confirmed_at).getTime();
      return paymentTime >= openedAtMs;
    });
    const activeStandaloneSpecialRevenue = roundMoney(getStandaloneSpecialOrderPaymentNet(
      standalonePayments,
      sales,
      () => true
    ));
    const grossSales = roundMoney(paidSales.reduce((sum, sale) => sum + Number(sale.subtotal || 0), 0));
    const discounts = roundMoney(paidSales.reduce((sum, sale) => sum + Number(sale.discount || 0), 0));
    const refunds = roundMoney(activeSessionSales.reduce((sum, sale) => sum + getSaleRefundTotal(sale), 0));
    const taxes = roundMoney(paidSales.reduce((sum, sale) => sum + Number(sale.tax || 0), 0));
    const totalTendered = roundMoney(paidSales.reduce((sum, sale) => sum + getNetSaleTotal(sale), 0) + activeStandaloneSpecialRevenue);
    const cashPayments = roundMoney(
      paidSales
        .filter((sale) => sale.paymentMethod === PAYMENT_METHODS.cash)
        .reduce((sum, sale) => sum + getNetSaleTotal(sale), 0) +
      getStandaloneSpecialOrderPaymentNet(standalonePayments, sales, (payment) => normalizePaymentMethod(payment.method) === PAYMENT_METHODS.cash)
    );
    const athMovilPayments = roundMoney(
      paidSales
        .filter((sale) => sale.paymentMethod === PAYMENT_METHODS.athMovil)
        .reduce((sum, sale) => sum + getNetSaleTotal(sale), 0) +
      getStandaloneSpecialOrderPaymentNet(standalonePayments, sales, (payment) => normalizePaymentMethod(payment.method) === PAYMENT_METHODS.athMovil)
    );
    const cardPayments = roundMoney(
      paidSales
        .filter((sale) => sale.paymentMethod === PAYMENT_METHODS.card)
        .reduce((sum, sale) => sum + getNetSaleTotal(sale), 0) +
      getStandaloneSpecialOrderPaymentNet(standalonePayments, sales, (payment) => normalizePaymentMethod(payment.method) === PAYMENT_METHODS.card)
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
  }, [activeSessionSales, activeStoreSession, closeForm.actualCashAmount, closeForm.paidIn, closeForm.paidOut, currentEmployee?.name, profile?.name, sales, specialOrderPayments, user?.email]);

  const historyRows = useMemo(() => {
    return [...storeStatusLogs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [storeStatusLogs]);

  const employeeWeeklyRows = useMemo(() => {
    return employees
      .filter((employee) => employee.status !== 'inactive')
      .map((employee) => ({
        employee,
        stats: calculateEmployeeWeeklyShiftStats({
          employee,
          shifts,
          closures: weeklyShiftClosures,
          sales,
          referenceDate: new Date()
        })
      }))
      .sort((a, b) => b.stats.totalEarned - a.stats.totalEarned);
  }, [employees, sales, shifts, weeklyShiftClosures]);

  const weeklyHistoryRows = useMemo(
    () => [...weeklyShiftClosures].sort((a, b) => new Date(b.closedAt || 0) - new Date(a.closedAt || 0)),
    [weeklyShiftClosures]
  );

  const cashCountTotal = useMemo(
    () => getCashCountTotal(closeForm.cashCountBreakdown),
    [closeForm.cashCountBreakdown]
  );

  useEffect(() => {
    if (profile?.role !== 'admin' || !firestoreReady || employees.length === 0) return;

    const automaticClosures = getAutomaticWeeklyClosuresToCreate({
      employees,
      shifts,
      closures: weeklyShiftClosures,
      sales,
      closedBy: currentActor,
      referenceDate: new Date()
    });

    if (automaticClosures.length === 0) return;

    Promise.all(automaticClosures.map((closure) => saveWeeklyShiftClosure(closure)))
      .then(() => {
        setNotification({
          type: 'success',
          message: `Se cerraron automaticamente ${automaticClosures.length} shift(s) semanales de esta semana.`
        });
      })
      .catch((error) => {
        console.error('Error creating automatic weekly closures:', error);
      });
  }, [currentActor, employees, firestoreReady, profile?.role, sales, shifts, weeklyShiftClosures]);

  const handleManualWeeklyClose = async (employee, stats) => {
    const firestoreAvailable = await ensureFirestoreReady();
    if (!firestoreAvailable) return;

    const closure = buildWeeklyShiftClosureRecord({
      employee,
      stats,
      closedBy: currentActor,
      mode: 'manual',
      closedAt: new Date(),
      id: generateId('weekly_shift_close')
    });

    try {
      await saveWeeklyShiftClosure(closure);
      setNotification({ type: 'success', message: `Shift semanal cerrado para ${employee.name}.` });
    } catch (error) {
      console.error(error);
      setNotification({ type: 'error', message: 'No se pudo cerrar el shift semanal del empleado.' });
    }
  };

  const handleOpenStore = async () => {
    if (isStoreOpen) {
      setNotification({ type: 'error', message: 'La tienda ya está abierta.' });
      return;
    }

    const firestoreAvailable = await ensureFirestoreReady();
    if (!firestoreAvailable) {
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

  const buildCloseSummaryFromLog = useCallback((log) => {
    if (!log || log.action !== 'close') return null;

    return {
      shiftNumber: log.shiftNumber || 1,
      openedAt: log.openedAt || log.createdAt,
      openedByName: log.openedByName || '-',
      closeTime: log.createdAt,
      closedByName: log.employeeName || '-',
      startingCash: roundMoney(log.summary?.cashDrawer?.startingCash ?? log.startingCash ?? 0),
      cashPayments: roundMoney(log.summary?.cashDrawer?.cashPayments ?? 0),
      cashRefunds: roundMoney(log.summary?.cashDrawer?.cashRefunds ?? 0),
      paidIn: roundMoney(log.summary?.cashDrawer?.paidIn ?? log.paidIn ?? 0),
      paidOut: roundMoney(log.summary?.cashDrawer?.paidOut ?? log.paidOut ?? 0),
      expectedCashAmount: roundMoney(log.summary?.cashDrawer?.expectedCashAmount ?? log.expectedCashAmount ?? 0),
      actualCashAmount: roundMoney(log.summary?.cashDrawer?.actualCashAmount ?? log.actualCashAmount ?? 0),
      difference: roundMoney(log.summary?.cashDrawer?.difference ?? log.difference ?? 0),
      grossSales: roundMoney(log.summary?.sales?.grossSales ?? 0),
      refunds: roundMoney(log.summary?.sales?.refunds ?? 0),
      discounts: roundMoney(log.summary?.sales?.discounts ?? 0),
      netSales: roundMoney(log.summary?.sales?.netSales ?? 0),
      taxes: roundMoney(log.summary?.sales?.taxes ?? 0),
      totalTendered: roundMoney(log.summary?.sales?.totalTendered ?? 0),
      tenders: {
        cash: roundMoney(log.summary?.sales?.cash ?? 0),
        athMovil: roundMoney(log.summary?.sales?.athMovil ?? 0),
        card: roundMoney(log.summary?.sales?.card ?? 0)
      }
    };
  }, []);

  const handlePrintHistoricalCloseSummary = async (log) => {
    const summary = buildCloseSummaryFromLog(log);
    if (!summary) {
      setNotification({ type: 'error', message: 'Ese registro no tiene un cierre imprimible.' });
      return;
    }

    const printer = getReceiptPrinter();

    try {
      await printHtmlDocument({
        title: `Cierre tienda turno ${summary.shiftNumber}`,
        html: buildStoreClosurePrintHtml({
          summary,
          printerName: printer?.name || ''
        }),
        printer
      });

      setNotification({ type: 'success', message: 'Recibo de cierre enviado a impresión.' });
    } catch (error) {
      console.error(error);
      setNotification({ type: 'error', message: 'No se pudo imprimir ese cierre.' });
    }
  };

  const updateCashCountField = (key, value) => {
    setCloseForm((prev) => ({
      ...prev,
      cashCountBreakdown: {
        ...(prev.cashCountBreakdown || {}),
        [key]: value
      }
    }));
  };

  const applyCashCountToCloseForm = () => {
    setCloseForm((prev) => ({
      ...prev,
      actualCashAmount: String(getCashCountTotal(prev.cashCountBreakdown))
    }));
    setShowCashCountModal(false);
  };

  const resetCashCount = () => {
    setCloseForm((prev) => ({
      ...prev,
      cashCountBreakdown: {}
    }));
  };

  const handleCloseStore = async () => {
    if (!activeStoreSession || !closeSummary) {
      setNotification({ type: 'error', message: 'No hay una tienda abierta para cerrar.' });
      return;
    }

    const firestoreAvailable = await ensureFirestoreReady();
    if (!firestoreAvailable) {
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
          difference: closeSummary.difference,
          cashCountBreakdown: closeForm.cashCountBreakdown || {}
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
          <button
            onClick={() => setShowCashCountModal(true)}
            className="btn-secondary"
            disabled={!isStoreOpen}
          >
            <Calculator size={16} className="mr-2" />
            Calculadora de caja
          </button>
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
        {!firestoreReady && (
          <div className="card border border-red-200 bg-red-50 lg:col-span-4">
            <div className="stat-label text-red-700">Estado de Firebase</div>
            <div className="stat-value text-red-800">Bloqueado</div>
            <div className="stat-trend text-red-700">
              Firestore no esta respondiendo. No abras ni cierres tienda hasta que vuelva.
            </div>
          </div>
        )}
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
          <h2 className="text-lg font-semibold text-gray-900">Shift semanal por empleado</h2>
          <p className="text-sm text-gray-500">
            Esto muestra lo acumulado desde el ultimo cierre semanal del empleado. El sabado se cierra automaticamente y tambien puedes cerrarlo manualmente.
          </p>
        </div>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Desde</th>
                <th>Horas</th>
                <th>Tarifa</th>
                <th>Ganado</th>
                <th>Ventas</th>
                <th>Ultimo cierre</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {employeeWeeklyRows.length === 0 ? (
                <tr>
                  <td colSpan="8" className="text-center py-8 text-gray-500">No hay empleados para calcular.</td>
                </tr>
              ) : (
                employeeWeeklyRows.map(({ employee, stats }) => (
                  <tr key={`weekly_row_${employee.id}`}>
                    <td>{employee.name}</td>
                    <td>{formatDateTime(stats.periodStart)}</td>
                    <td>{stats.totalHours.toFixed(2)}h</td>
                    <td>{formatCurrency(stats.hourlyRate)}</td>
                    <td className="font-semibold text-emerald-700">{formatCurrency(stats.totalEarned)}</td>
                    <td>{formatCurrency(stats.totalSales)}</td>
                    <td>{stats.lastClosure ? formatDateTime(stats.lastClosure.closedAt || stats.lastClosure.createdAt) : '-'}</td>
                    <td>
                      {profile?.role === 'admin' ? (
                        <button
                          type="button"
                          onClick={() => handleManualWeeklyClose(employee, stats)}
                          className="btn-secondary inline-flex items-center gap-2"
                        >
                          <CalendarClock size={14} />
                          Cerrar semanal
                        </button>
                      ) : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.length === 0 ? (
                <tr>
                  <td colSpan="9" className="text-center py-8 text-gray-500">
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
                    <td>
                      {log.action === 'close' ? (
                        <button
                          type="button"
                          onClick={() => handlePrintHistoricalCloseSummary(log)}
                          className="btn-secondary inline-flex items-center gap-2"
                        >
                          <Printer size={14} />
                          Imprimir
                        </button>
                      ) : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 pt-6">
          <h2 className="text-lg font-semibold text-gray-900">Historial de shift semanales</h2>
          <p className="text-sm text-gray-500">
            Cada cierre semanal baja el acumulado del empleado a cero y queda guardado aqui.
          </p>
        </div>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Periodo</th>
                <th>Horas</th>
                <th>Tarifa</th>
                <th>Ganado</th>
                <th>Ventas</th>
                <th>Cerrado</th>
                <th>Modo</th>
              </tr>
            </thead>
            <tbody>
              {weeklyHistoryRows.length === 0 ? (
                <tr>
                  <td colSpan="8" className="text-center py-8 text-gray-500">No hay cierres semanales todavia.</td>
                </tr>
              ) : (
                weeklyHistoryRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.employeeName}</td>
                    <td>{formatDateTime(row.periodStart)} - {formatDateTime(row.periodEnd)}</td>
                    <td>{Number(row.totalHours || 0).toFixed(2)}h</td>
                    <td>{formatCurrency(row.hourlyRate || 0)}</td>
                    <td className="font-semibold text-emerald-700">{formatCurrency(row.totalEarned || 0)}</td>
                    <td>{formatCurrency(row.totalSales || 0)}</td>
                    <td>{formatDateTime(row.closedAt || row.createdAt)}</td>
                    <td>
                      <span className={row.mode === 'auto' ? 'badge badge-green' : 'badge badge-blue'}>
                        {row.mode === 'auto' ? 'Auto sabado' : 'Manual'}
                      </span>
                    </td>
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
              <div>
                <Input
                  label="Actual Cash Amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={closeForm.actualCashAmount}
                  onChange={(e) => setCloseForm((prev) => ({ ...prev, actualCashAmount: e.target.value }))}
                  placeholder="0.00"
                />
                <button
                  type="button"
                  onClick={() => setShowCashCountModal(true)}
                  className="btn btn-secondary w-full -mt-2"
                >
                  <Calculator size={16} className="mr-2 inline" />
                  Calculadora de caja
                </button>
              </div>
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

      {showCashCountModal && (
        <Modal
          isOpen={showCashCountModal}
          onClose={() => setShowCashCountModal(false)}
          title="Calculadora de caja"
          size="md"
        >
          <div className="space-y-6">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="font-medium text-blue-900">Cuenta por denominaciones</p>
              <p className="text-sm text-blue-700">
                Escribe cuántos billetes y monedas hay en caja, y el sistema calculará el total automáticamente.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {CASH_COUNT_FIELDS.map((field) => (
                <Input
                  key={field.key}
                  label={field.label}
                  type="number"
                  min="0"
                  step="1"
                  value={closeForm.cashCountBreakdown?.[field.key] || ''}
                  onChange={(e) => updateCashCountField(field.key, e.target.value)}
                  placeholder="0"
                />
              ))}
            </div>

            <div className="rounded-lg bg-gray-50 p-4 space-y-2 text-sm">
              {CASH_COUNT_FIELDS.map((field) => {
                const quantity = getNumber(closeForm.cashCountBreakdown?.[field.key]);
                const subtotal = roundMoney(quantity * field.value);
                return (
                  <div key={`subtotal_${field.key}`} className="flex justify-between">
                    <span>{field.label} x {quantity}</span>
                    <strong>{formatCurrency(subtotal)}</strong>
                  </div>
                );
              })}
              <div className="flex justify-between border-t pt-2 text-base">
                <span>Total contado</span>
                <strong>{formatCurrency(cashCountTotal)}</strong>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={resetCashCount} className="btn-secondary">
                Limpiar
              </button>
              <button type="button" onClick={() => setShowCashCountModal(false)} className="btn-secondary">
                Cancelar
              </button>
              <button type="button" onClick={applyCashCountToCloseForm} className="btn-primary">
                Usar total en cierre
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
