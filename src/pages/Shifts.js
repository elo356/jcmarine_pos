import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Clock, LogIn, LogOut, Coffee, Calendar, DollarSign } from 'lucide-react';
import { loadData, formatDate, formatDateTime, formatCurrency, formatDuration, generateId } from '../data/demoData';
import Modal from '../components/Modal';
import Input from '../components/Input';
import Notification from '../components/Notification';
import { useAuth } from '../contexts/AuthContext';
import { subscribeEmployees } from '../services/employeesService';
import { subscribeSales } from '../services/salesService';
import { createShift, patchShift, subscribeShifts } from '../services/shiftsService';
import { createStoreStatusLog, subscribeStoreStatusLogs } from '../services/storeStatusLogService';
import { isReportableSale } from '../utils/salesUtils';

const Shifts = () => {
  const { user, profile } = useAuth();
  const isCashier = profile?.role === 'cashier';
  const [shifts, setShifts] = useState([]);
  const [sales, setSales] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [activeShift, setActiveShift] = useState(null);
  const [storeStatusLogs, setStoreStatusLogs] = useState([]);
  const [showClockInModal, setShowClockInModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [clockInNote, setClockInNote] = useState('');
  const [showBreakModal, setShowBreakModal] = useState(false);
  const [breakNote, setBreakNote] = useState('');
  const [storeStatusNote, setStoreStatusNote] = useState('');
  const [notification, setNotification] = useState(null);
  const [filterEmployee, setFilterEmployee] = useState('all');

  const resolveCurrentEmployee = useCallback((data) => {
    if (!user) return null;

    const byUid = data.employees.find((e) => e.uid && e.uid === user.uid);
    if (byUid) return byUid;

    const byId = data.employees.find((e) => e.id === user.uid);
    if (byId) return byId;

    const byEmail = data.employees.find(
      (e) => (e.email || '').toLowerCase() === (user.email || '').toLowerCase()
    );
    if (byEmail) return byEmail;

    return {
      id: user.uid,
      uid: user.uid,
      name: profile?.name || user.email || 'Cashier',
      email: user.email || '',
      role: profile?.role || 'cashier',
      active: true
    };
  }, [user, profile?.name, profile?.role]);

  useEffect(() => {
    const data = loadData();
    setEmployees(data.employees || []);
    setShifts(data.shifts || []);
    setSales(data.sales || []);

    const unsubEmployees = isCashier
      ? () => {}
      : subscribeEmployees(
        (rows) => setEmployees(rows),
        (error) => console.error('Error subscribing employees in shifts:', error)
      );
    const unsubShifts = subscribeShifts(
      (rows) => setShifts(rows),
      (error) => console.error('Error subscribing shifts:', error)
    );
    const unsubStoreStatusLogs = subscribeStoreStatusLogs(
      (rows) => setStoreStatusLogs(rows),
      (error) => console.error('Error subscribing store status logs:', error)
    );
    const unsubSales = subscribeSales(
      (rows) => setSales(rows),
      (error) => console.error('Error subscribing sales in shifts:', error)
    );

    return () => {
      unsubEmployees();
      unsubShifts();
      unsubStoreStatusLogs();
      unsubSales();
    };
  }, [isCashier]);

  const currentEmployee = useMemo(
    () => resolveCurrentEmployee({ employees }),
    [resolveCurrentEmployee, employees]
  );

  useEffect(() => {
    if (isCashier && currentEmployee) {
      setFilterEmployee(currentEmployee.id);
    } else if (!isCashier) {
      setFilterEmployee('all');
    }

    const sortedShifts = [...shifts].sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    const active = isCashier && currentEmployee
      ? sortedShifts.find((s) => !s.endTime && s.employeeId === currentEmployee.id)
      : sortedShifts.find((s) => !s.endTime);
    setActiveShift(active || null);
  }, [isCashier, currentEmployee, shifts]);

  const handleClockIn = async () => {
    const employeeIdToUse = isCashier ? currentEmployee?.id : selectedEmployee;

    if (!employeeIdToUse) {
      setNotification({ type: 'error', message: 'Please select an employee' });
      return;
    }

    const employee = employees.find(e => e.id === employeeIdToUse) || currentEmployee;
    
    if (!employee) return;

    const newShift = {
      id: generateId(),
      employeeId: employee.id,
      employeeName: employee.name,
      employeeRole: employee.role,
      startTime: new Date().toISOString(),
      endTime: null,
      breaks: [],
      totalBreakTime: 0,
      totalHours: 0,
      totalSales: 0,
      status: 'active',
      notes: clockInNote
    };

    try {
      await createShift(newShift);
      setNotification({ type: 'success', message: `${employee.name} clocked in successfully` });
      closeClockInModal();
    } catch (error) {
      console.error(error);
      setNotification({ type: 'error', message: 'No se pudo registrar el clock in en Firestore.' });
    }
  };

  const handleClockOut = async () => {
    if (!activeShift) return;

    const endTime = new Date();
    const startTime = new Date(activeShift.startTime);
    const totalBreakTime = Number(activeShift.totalBreakTime || 0);
    const totalHours = (endTime - startTime) / (1000 * 60 * 60) - (totalBreakTime / 60);

    // Calculate sales during this shift
    const shiftSales = sales.filter(sale => {
      const saleDate = new Date(sale.date);
      return saleDate >= startTime && saleDate <= endTime && isReportableSale(sale);
    });
    const totalSales = shiftSales.reduce((sum, sale) => sum + sale.total, 0);

    try {
      await patchShift(activeShift.id, {
        endTime: endTime.toISOString(),
        status: 'completed',
        totalHours: Math.max(0, totalHours),
        totalSales
      });
      setNotification({ type: 'success', message: `${activeShift.employeeName} clocked out successfully` });
    } catch (error) {
      console.error(error);
      setNotification({ type: 'error', message: 'No se pudo registrar el clock out en Firestore.' });
    }
  };

  const handleStartBreak = async () => {
    if (!activeShift) return;

    const newBreak = {
      id: generateId(),
      startTime: new Date().toISOString(),
      endTime: null,
      duration: 0,
      notes: breakNote
    };

    const breaks = [...(activeShift.breaks || []), newBreak];

    try {
      await patchShift(activeShift.id, {
        breaks,
        status: 'on_break'
      });
      setNotification({ type: 'success', message: 'Break started' });
      closeBreakModal();
    } catch (error) {
      console.error(error);
      setNotification({ type: 'error', message: 'No se pudo iniciar break en Firestore.' });
    }
  };

  const handleEndBreak = async () => {
    if (!activeShift || activeShift.status !== 'on_break') return;

    // Find the last incomplete break
    const breaks = [...(activeShift.breaks || [])];
    const lastBreakIndex = breaks.length - 1;
    if (lastBreakIndex === -1) return;

    const lastBreak = breaks[lastBreakIndex];
    if (lastBreak.endTime) return;

    const endTime = new Date();
    const startTime = new Date(lastBreak.startTime);
    const duration = (endTime - startTime) / (1000 * 60); // minutes

    breaks[lastBreakIndex] = {
      ...breaks[lastBreakIndex],
      endTime: endTime.toISOString(),
      duration: Math.round(duration)
    };

    try {
      await patchShift(activeShift.id, {
        breaks,
        totalBreakTime: Number(activeShift.totalBreakTime || 0) + Math.round(duration),
        status: 'active'
      });
      setNotification({ type: 'success', message: `Break ended (${Math.round(duration)} mins)` });
    } catch (error) {
      console.error(error);
      setNotification({ type: 'error', message: 'No se pudo finalizar break en Firestore.' });
    }
  };

  const latestStoreStatusLog = useMemo(
    () => [...storeStatusLogs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null,
    [storeStatusLogs]
  );

  const isStoreOpen = latestStoreStatusLog?.action === 'open';

  const handleStoreStatusChange = async (action) => {
    if (!currentEmployee && !profile && !user) {
      setNotification({ type: 'error', message: 'No se pudo identificar el usuario actual.' });
      return;
    }

    if (action === 'open' && isStoreOpen) {
      setNotification({ type: 'error', message: 'La tienda ya aparece como abierta.' });
      return;
    }

    if (action === 'close' && !isStoreOpen) {
      setNotification({ type: 'error', message: 'La tienda ya aparece como cerrada.' });
      return;
    }

    const actor = currentEmployee || {
      id: user?.uid || profile?.id || 'unknown',
      name: profile?.name || user?.email || 'Usuario',
      role: profile?.role || 'cashier',
      email: user?.email || profile?.email || ''
    };

    const timestamp = new Date().toISOString();
    const log = {
      id: generateId(),
      action,
      createdAt: timestamp,
      employeeId: actor.id,
      employeeName: actor.name,
      employeeRole: actor.role,
      employeeEmail: actor.email || '',
      note: storeStatusNote.trim(),
      source: 'shifts'
    };

    try {
      await createStoreStatusLog(log);
      setNotification({
        type: 'success',
        message: action === 'open' ? 'Apertura de tienda registrada.' : 'Cierre de tienda registrado.'
      });
      setStoreStatusNote('');
    } catch (error) {
      console.error(error);
      setNotification({
        type: 'error',
        message: 'No se pudo guardar el registro de apertura/cierre de tienda.'
      });
    }
  };

  const closeClockInModal = () => {
    setShowClockInModal(false);
    if (!isCashier) setSelectedEmployee('');
    setClockInNote('');
  };

  const closeBreakModal = () => {
    setShowBreakModal(false);
    setBreakNote('');
  };

  const getFilteredShifts = () => {
    if (isCashier && employees[0]?.id) {
      return shifts.filter((s) => s.employeeId === employees[0].id);
    }
    if (filterEmployee === 'all') return shifts;
    return shifts.filter(s => s.employeeId === filterEmployee);
  };

  const getStatusBadge = (shift) => {
    if (shift.status === 'active') {
      return <span className="badge badge-green">Active</span>;
    } else if (shift.status === 'on_break') {
      return <span className="badge badge-yellow">On Break</span>;
    } else {
      return <span className="badge badge-gray">Completed</span>;
    }
  };

  const getActiveDuration = (startTime) => {
    const start = new Date(startTime);
    const now = new Date();
    const diff = (now - start) / (1000 * 60); // minutes
    return formatDuration(diff);
  };

  const filteredShifts = getFilteredShifts();
  const todayShifts = shifts.filter(s => {
    const shiftDate = new Date(s.startTime);
    const today = new Date();
    return shiftDate.toDateString() === today.toDateString();
  });
  const totalHoursToday = todayShifts.reduce((sum, s) => sum + (s.totalHours || 0), 0);
  const activeEmployeesCount = shifts.filter(s => s.status === 'active' || s.status === 'on_break').length;

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Clock className="text-primary-600" size={28} />
          <h1 className="page-title">Shift Management</h1>
        </div>
        <div className="flex gap-2">
          {activeShift ? (
            <>
              {activeShift.status === 'active' && (
                <button onClick={() => setShowBreakModal(true)} className="btn-secondary">
                  <Coffee size={16} className="mr-2" />
                  Start Break
                </button>
              )}
              {activeShift.status === 'on_break' && (
                <button onClick={handleEndBreak} className="btn-secondary">
                  <Clock size={16} className="mr-2" />
                  End Break
                </button>
              )}
              <button onClick={handleClockOut} className="btn-primary">
                <LogOut size={16} className="mr-2" />
                Clock Out
              </button>
            </>
          ) : (
            <button onClick={() => setShowClockInModal(true)} className="btn-primary">
              <LogIn size={16} className="mr-2" />
              Clock In
            </button>
          )}
        </div>
      </div>

      {/* Active Shift Card */}
      {activeShift && (
        <div className="card p-6 bg-gradient-to-r from-blue-500 to-blue-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm opacity-80">Current Shift</div>
              <div className="text-2xl font-bold">{activeShift.employeeName}</div>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-2">
                  <Clock size={16} />
                  <span>{getActiveDuration(activeShift.startTime)}</span>
                </div>
                {activeShift.breaks.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Coffee size={16} />
                    <span>{activeShift.totalBreakTime}m breaks</span>
                  </div>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm opacity-80">Status</div>
              <div className="text-xl font-bold capitalize">
                {activeShift.status.replace('_', ' ')}
              </div>
              <div className="text-sm opacity-80 mt-2">
                Started: {formatDateTime(activeShift.startTime)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="stats-grid">
        <div className="card">
          <div className="stat-label">Active Employees</div>
          <div className="stat-value">{activeEmployeesCount}</div>
          <div className="stat-trend">
            <LogIn size={16} className="text-green-500" />
            <span className="text-green-500">On shift</span>
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Hours Today</div>
          <div className="stat-value">{totalHoursToday.toFixed(1)}h</div>
          <div className="stat-trend">
            <Clock size={16} className="text-blue-500" />
            <span className="text-blue-500">Total worked</span>
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Shifts Today</div>
          <div className="stat-value">{todayShifts.length}</div>
          <div className="stat-trend">
            <Calendar size={16} className="text-purple-500" />
            <span className="text-purple-500">Completed</span>
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Total Sales Today</div>
          <div className="stat-value">
            {formatCurrency(todayShifts.reduce((sum, s) => sum + s.totalSales, 0))}
          </div>
          <div className="stat-trend">
            <DollarSign size={16} className="text-green-500" />
            <span className="text-green-500">Revenue</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Registro de tienda</h2>
            <p className="text-sm text-gray-500">
              Guarda aparte cada apertura y cierre de tienda.
            </p>
            <div className="mt-2 text-sm">
              <span className="font-medium text-gray-700">Estado actual: </span>
              <span className={isStoreOpen ? 'text-green-600 font-semibold' : 'text-gray-600 font-semibold'}>
                {isStoreOpen ? 'Abierta' : 'Cerrada'}
              </span>
              {latestStoreStatusLog && (
                <span className="text-gray-500">
                  {' '}· Último movimiento: {formatDateTime(latestStoreStatusLog.createdAt)}
                </span>
              )}
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[420px]">
            <Input
              label="Nota del registro (opcional)"
              value={storeStatusNote}
              onChange={(e) => setStoreStatusNote(e.target.value)}
              placeholder="Ej. apertura del turno de mañana"
            />
            <div className="flex gap-2">
              <button
                onClick={() => handleStoreStatusChange('open')}
                className="btn-primary"
                disabled={isStoreOpen}
              >
                <LogIn size={16} className="mr-2" />
                Abrir tienda
              </button>
              <button
                onClick={() => handleStoreStatusChange('close')}
                className="btn-secondary"
                disabled={!isStoreOpen}
              >
                <LogOut size={16} className="mr-2" />
                Cerrar tienda
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      {!isCashier && (
        <div className="card">
          <div className="filter-container">
            <span className="text-gray-600 font-medium">Filter by Employee:</span>
            <select
              value={filterEmployee}
              onChange={(e) => setFilterEmployee(e.target.value)}
              className="input"
            >
              <option value="all">All Employees</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Shifts Table */}
      <div className="card overflow-hidden">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>Start Time</th>
                <th>End Time</th>
                <th>Duration</th>
                <th>Breaks</th>
                <th>Net Hours</th>
                <th>Sales</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredShifts.length === 0 ? (
                <tr>
                  <td colSpan="9" className="text-center py-8 text-gray-500">
                    No shifts recorded
                  </td>
                </tr>
              ) : (
                filteredShifts.map((shift) => (
                  <tr key={shift.id} className="hover:bg-gray-50">
                    <td>
                      <div>
                        <div className="font-medium text-gray-900">{shift.employeeName}</div>
                        <div className="text-sm text-gray-500">{shift.employeeRole}</div>
                      </div>
                    </td>
                    <td>{formatDate(shift.startTime)}</td>
                    <td>{formatDateTime(shift.startTime)}</td>
                    <td>{shift.endTime ? formatDateTime(shift.endTime) : '-'}</td>
                    <td>
                      {shift.totalHours ? formatDuration(shift.totalHours * 60) : 
                       (activeShift?.id === shift.id ? getActiveDuration(shift.startTime) : '-')}
                    </td>
                    <td>
                      <div>
                        <div>{shift.breaks.length} breaks</div>
                        <div className="text-sm text-gray-500">
                          {formatDuration(shift.totalBreakTime)} total
                        </div>
                      </div>
                    </td>
                    <td className="font-medium">
                      {shift.totalHours ? shift.totalHours.toFixed(2) + 'h' : '-'}
                    </td>
                    <td>{shift.totalSales > 0 ? formatCurrency(shift.totalSales) : '-'}</td>
                    <td>{getStatusBadge(shift)}</td>
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
            Este registro es independiente del historial de turnos.
          </p>
        </div>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Accion</th>
                <th>Fecha y hora</th>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Nota</th>
              </tr>
            </thead>
            <tbody>
              {storeStatusLogs.length === 0 ? (
                <tr>
                  <td colSpan="5" className="text-center py-8 text-gray-500">
                    No hay registros de apertura o cierre de tienda
                  </td>
                </tr>
              ) : (
                storeStatusLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td>
                      <span className={log.action === 'open' ? 'badge badge-green' : 'badge badge-gray'}>
                        {log.action === 'open' ? 'Apertura' : 'Cierre'}
                      </span>
                    </td>
                    <td>{formatDateTime(log.createdAt)}</td>
                    <td>{log.employeeName || '-'}</td>
                    <td className="capitalize">{log.employeeRole || '-'}</td>
                    <td>{log.note || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Clock In Modal */}
      {showClockInModal && (
        <Modal
          isOpen={showClockInModal}
          onClose={closeClockInModal}
          title="Clock In"
          size="md"
        >
          <div className="space-y-4">
            {isCashier ? (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-sm text-gray-600">Empleado</p>
                <p className="font-semibold text-gray-900">{employees[0]?.name || profile?.name || user?.email}</p>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select Employee *
                </label>
                <select
                  value={selectedEmployee}
                  onChange={(e) => setSelectedEmployee(e.target.value)}
                  className="input"
                  required
                >
                  <option value="">Choose employee...</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
            )}

            <Input
              label="Notes (optional)"
              value={clockInNote}
              onChange={(e) => setClockInNote(e.target.value)}
              placeholder="Any additional notes..."
            />

            <div className="flex justify-end gap-2 pt-4">
              <button onClick={closeClockInModal} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleClockIn} className="btn-primary">
                <LogIn size={16} className="mr-2" />
                Clock In
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Break Modal */}
      {showBreakModal && (
        <Modal
          isOpen={showBreakModal}
          onClose={closeBreakModal}
          title="Start Break"
          size="sm"
        >
          <div className="space-y-4">
            <Input
              label="Notes (optional)"
              value={breakNote}
              onChange={(e) => setBreakNote(e.target.value)}
              placeholder="Reason for break..."
            />

            <div className="flex justify-end gap-2 pt-4">
              <button onClick={closeBreakModal} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleStartBreak} className="btn-primary">
                <Coffee size={16} className="mr-2" />
                Start Break
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Notification */}
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

export default Shifts;
