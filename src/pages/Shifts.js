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
import { getNetSaleTotal, isReportableSale } from '../utils/salesUtils';

const calculateShiftTotals = (shift, sales, options = {}) => {
  const startValue = options.startTime ?? shift.startTime;
  const endValue = options.endTime ?? shift.endTime;
  const breakMinutes = Number(options.totalBreakTime ?? shift.totalBreakTime ?? 0);

  const startTime = new Date(startValue);
  const endTime = endValue ? new Date(endValue) : new Date();

  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime < startTime) {
    return { totalHours: 0, totalSales: 0 };
  }

  const totalHours = (endTime - startTime) / (1000 * 60 * 60) - (breakMinutes / 60);
  const shiftSales = sales.filter((sale) => {
    const saleDate = new Date(sale.date);
    return saleDate >= startTime && saleDate <= endTime && isReportableSale(sale);
  });
  const totalSales = shiftSales.reduce((sum, sale) => sum + getNetSaleTotal(sale), 0);

  return {
    totalHours: Math.max(0, totalHours),
    totalSales
  };
};

const Shifts = () => {
  const { user, profile } = useAuth();
  const isCashier = profile?.role === 'cashier';
  const [shifts, setShifts] = useState([]);
  const [sales, setSales] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [activeShift, setActiveShift] = useState(null);
  const [showClockInModal, setShowClockInModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [clockInNote, setClockInNote] = useState('');
  const [showBreakModal, setShowBreakModal] = useState(false);
  const [breakNote, setBreakNote] = useState('');
  const [notification, setNotification] = useState(null);
  const [filterEmployee, setFilterEmployee] = useState('all');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(intervalId);
  }, []);

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
      name: profile?.name || user.email || 'Cashier',
      email: user.email || '',
      role: profile?.role || 'cashier',
      active: true
    };
  }, [profile?.name, profile?.role, user]);

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
    const unsubSales = subscribeSales(
      (rows) => setSales(rows),
      (error) => console.error('Error subscribing sales in shifts:', error)
    );

    return () => {
      unsubEmployees();
      unsubShifts();
      unsubSales();
    };
  }, [isCashier]);

  const currentEmployee = useMemo(
    () => resolveCurrentEmployee(employees),
    [employees, resolveCurrentEmployee]
  );

  useEffect(() => {
    if (isCashier && currentEmployee) {
      setFilterEmployee(currentEmployee.id);
    } else if (!isCashier) {
      setFilterEmployee('all');
    }

    const sortedShifts = [...shifts].sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    const active = isCashier && currentEmployee
      ? sortedShifts.find((shift) => !shift.endTime && shift.employeeId === currentEmployee.id)
      : sortedShifts.find((shift) => !shift.endTime);

    setActiveShift(active || null);
  }, [currentEmployee, isCashier, shifts]);

  const closeClockInModal = () => {
    setShowClockInModal(false);
    if (!isCashier) setSelectedEmployee('');
    setClockInNote('');
  };

  const closeBreakModal = () => {
    setShowBreakModal(false);
    setBreakNote('');
  };

  const handleClockIn = async () => {
    const employeeIdToUse = isCashier ? currentEmployee?.id : selectedEmployee;
    if (!employeeIdToUse) {
      setNotification({ type: 'error', message: 'Please select an employee' });
      return;
    }

    const employee = employees.find((row) => row.id === employeeIdToUse) || currentEmployee;
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
    const { totalHours, totalSales } = calculateShiftTotals(activeShift, sales, {
      endTime: endTime.toISOString()
    });

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

    try {
      await patchShift(activeShift.id, {
        breaks: [...(activeShift.breaks || []), newBreak],
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

    const breaks = [...(activeShift.breaks || [])];
    const lastBreakIndex = breaks.length - 1;
    if (lastBreakIndex === -1) return;

    const lastBreak = breaks[lastBreakIndex];
    if (lastBreak.endTime) return;

    const endTime = new Date();
    const startTime = new Date(lastBreak.startTime);
    const duration = Math.round((endTime - startTime) / (1000 * 60));

    breaks[lastBreakIndex] = {
      ...lastBreak,
      endTime: endTime.toISOString(),
      duration
    };

    try {
      await patchShift(activeShift.id, {
        breaks,
        totalBreakTime: Number(activeShift.totalBreakTime || 0) + duration,
        status: 'active'
      });
      setNotification({ type: 'success', message: `Break ended (${duration} mins)` });
    } catch (error) {
      console.error(error);
      setNotification({ type: 'error', message: 'No se pudo finalizar break en Firestore.' });
    }
  };

  const filteredShifts = useMemo(() => {
    if (isCashier && currentEmployee?.id) {
      return shifts.filter((shift) => shift.employeeId === currentEmployee.id);
    }
    if (filterEmployee === 'all') return shifts;
    return shifts.filter((shift) => shift.employeeId === filterEmployee);
  }, [currentEmployee?.id, filterEmployee, isCashier, shifts]);

  const todayShifts = useMemo(() => {
    const today = new Date().toDateString();
    return shifts.filter((shift) => new Date(shift.startTime).toDateString() === today);
  }, [shifts]);

  const totalHoursToday = todayShifts.reduce((sum, shift) => sum + Number(shift.totalHours || 0), 0);
  const activeEmployeesCount = shifts.filter((shift) => shift.status === 'active' || shift.status === 'on_break').length;

  const getStatusBadge = (shift) => {
    if (shift.status === 'active') return <span className="badge badge-green">Active</span>;
    if (shift.status === 'on_break') return <span className="badge badge-yellow">On Break</span>;
    return <span className="badge badge-gray">Completed</span>;
  };

  const getActiveDuration = (startTime) => {
    const start = new Date(startTime);
    const currentTime = new Date(now);
    return formatDuration((currentTime - start) / (1000 * 60));
  };

  const getRunningNetHours = (shift) => {
    const { totalHours } = calculateShiftTotals(shift, sales);
    return `${totalHours.toFixed(2)}h`;
  };

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
                {activeShift.breaks?.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Coffee size={16} />
                    <span>{activeShift.totalBreakTime}m breaks</span>
                  </div>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm opacity-80">Status</div>
              <div className="text-xl font-bold capitalize">{activeShift.status.replace('_', ' ')}</div>
              <div className="text-sm opacity-80 mt-2">Started: {formatDateTime(activeShift.startTime)}</div>
            </div>
          </div>
        </div>
      )}

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
          <div className="stat-value">{formatCurrency(todayShifts.reduce((sum, shift) => sum + Number(shift.totalSales || 0), 0))}</div>
          <div className="stat-trend">
            <DollarSign size={16} className="text-green-500" />
            <span className="text-green-500">Revenue</span>
          </div>
        </div>
      </div>

      {!isCashier && (
        <div className="card">
          <div className="filter-container">
            <span className="text-gray-600 font-medium">Filter by Employee:</span>
            <select value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)} className="input">
              <option value="all">All Employees</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

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
                  <td colSpan={9} className="text-center py-8 text-gray-500">No shifts recorded</td>
                </tr>
              ) : (
                filteredShifts.map((shift) => {
                  const liveTotals = shift.endTime ? null : calculateShiftTotals(shift, sales);
                  const salesAmount = shift.endTime ? Number(shift.totalSales || 0) : liveTotals.totalSales;

                  return (
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
                        {shift.endTime
                          ? formatDuration((shift.totalHours || 0) * 60)
                          : getActiveDuration(shift.startTime)}
                      </td>
                      <td>
                        <div>
                          <div>{(shift.breaks || []).length} breaks</div>
                          <div className="text-sm text-gray-500">{formatDuration(shift.totalBreakTime || 0)} total</div>
                        </div>
                      </td>
                      <td className="font-medium">{shift.endTime ? `${Number(shift.totalHours || 0).toFixed(2)}h` : getRunningNetHours(shift)}</td>
                      <td>{salesAmount > 0 ? formatCurrency(salesAmount) : '-'}</td>
                      <td>{getStatusBadge(shift)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showClockInModal && (
        <Modal isOpen={showClockInModal} onClose={closeClockInModal} title="Clock In" size="md">
          <div className="space-y-4">
            {isCashier ? (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-sm text-gray-600">Empleado</p>
                <p className="font-semibold text-gray-900">{currentEmployee?.name || profile?.name || user?.email}</p>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Select Employee *</label>
                <select value={selectedEmployee} onChange={(e) => setSelectedEmployee(e.target.value)} className="input" required>
                  <option value="">Choose employee...</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>{employee.name}</option>
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
              <button onClick={closeClockInModal} className="btn-secondary">Cancel</button>
              <button onClick={handleClockIn} className="btn-primary">
                <LogIn size={16} className="mr-2" />
                Clock In
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showBreakModal && (
        <Modal isOpen={showBreakModal} onClose={closeBreakModal} title="Start Break" size="sm">
          <div className="space-y-4">
            <Input
              label="Notes (optional)"
              value={breakNote}
              onChange={(e) => setBreakNote(e.target.value)}
              placeholder="Reason for break..."
            />

            <div className="flex justify-end gap-2 pt-4">
              <button onClick={closeBreakModal} className="btn-secondary">Cancel</button>
              <button onClick={handleStartBreak} className="btn-primary">
                <Coffee size={16} className="mr-2" />
                Start Break
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

export default Shifts;
