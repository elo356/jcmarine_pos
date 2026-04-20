const MINUTE_IN_MS = 60 * 1000;

const toDate = (value) => {
  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const roundHours = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export const getWeeklyShiftCycleWindow = (referenceDate = new Date()) => {
  const now = toDate(referenceDate) || new Date();
  const cycleStart = new Date(now);
  cycleStart.setHours(0, 0, 0, 0);
  cycleStart.setDate(cycleStart.getDate() - cycleStart.getDay());

  const cycleEnd = new Date(cycleStart);
  cycleEnd.setDate(cycleEnd.getDate() + 6);
  cycleEnd.setHours(23, 59, 59, 999);

  return {
    cycleStart,
    cycleEnd,
    cycleKey: cycleStart.toISOString().slice(0, 10),
    isSaturday: now.getDay() === 6
  };
};

const getLatestClosureForEmployee = (employeeId, closures = []) => {
  const employeeClosures = closures
    .filter((closure) => closure.employeeId === employeeId)
    .sort((a, b) => new Date(b.closedAt || b.createdAt || 0) - new Date(a.closedAt || a.createdAt || 0));

  return employeeClosures[0] || null;
};

const getShiftNetHours = (shift, referenceDate = new Date()) => {
  const start = toDate(shift?.startTime);
  if (!start) return 0;

  const shiftEnd = toDate(shift?.endTime) || toDate(referenceDate) || new Date();
  if (!shiftEnd || shiftEnd <= start) return 0;

  const totalBreakMinutes = Number(shift?.totalBreakTime || 0);
  const diffHours = (shiftEnd.getTime() - start.getTime()) / (1000 * 60 * 60);
  return Math.max(0, diffHours - (totalBreakMinutes / 60));
};

const getShiftOverlapHours = (shift, periodStart, periodEnd, referenceDate = new Date()) => {
  const shiftStart = toDate(shift?.startTime);
  const rawShiftEnd = toDate(shift?.endTime) || toDate(referenceDate) || new Date();

  if (!shiftStart || !rawShiftEnd || rawShiftEnd <= shiftStart) return 0;

  const overlapStartMs = Math.max(shiftStart.getTime(), periodStart.getTime());
  const overlapEndMs = Math.min(rawShiftEnd.getTime(), periodEnd.getTime());

  if (overlapEndMs <= overlapStartMs) return 0;

  const shiftDurationMs = rawShiftEnd.getTime() - shiftStart.getTime();
  if (shiftDurationMs <= 0) return 0;

  const overlapMs = overlapEndMs - overlapStartMs;
  const overlapRatio = overlapMs / shiftDurationMs;
  const rawOverlapHours = overlapMs / (1000 * 60 * 60);
  const proportionalBreakHours = (Number(shift?.totalBreakTime || 0) / 60) * overlapRatio;

  return Math.max(0, rawOverlapHours - proportionalBreakHours);
};

const getSalesForPeriod = (employeeId, periodStart, periodEnd, sales = []) => roundMoney(
  sales.reduce((sum, sale) => {
    const saleDate = toDate(sale?.date || sale?.created_at);
    if (!saleDate) return sum;
    if (saleDate < periodStart || saleDate > periodEnd) return sum;
    if (sale.cashierId !== employeeId && sale.shiftEmployeeId !== employeeId) return sum;
    return sum + Number(sale.total || 0);
  }, 0)
);

export const calculateEmployeeWeeklyShiftStats = ({
  employee,
  shifts = [],
  closures = [],
  sales = [],
  referenceDate = new Date()
}) => {
  const cycle = getWeeklyShiftCycleWindow(referenceDate);
  const latestClosure = getLatestClosureForEmployee(employee?.id, closures);
  const latestClosureDate = toDate(latestClosure?.closedAt || latestClosure?.createdAt);
  const baseline = latestClosureDate && latestClosureDate > cycle.cycleStart
    ? latestClosureDate
    : cycle.cycleStart;
  const effectiveEnd = toDate(referenceDate) || new Date();

  const relevantShifts = shifts.filter((shift) => shift.employeeId === employee?.id);
  const totalHours = roundHours(
    relevantShifts.reduce((sum, shift) => sum + getShiftOverlapHours(shift, baseline, effectiveEnd, referenceDate), 0)
  );
  const hourlyRate = Number(employee?.hourlyRate || 0);
  const totalEarned = roundMoney(totalHours * hourlyRate);
  const totalSales = getSalesForPeriod(employee?.id, baseline, effectiveEnd, sales);

  return {
    employeeId: employee?.id || '',
    employeeName: employee?.name || '',
    hourlyRate,
    totalHours,
    totalEarned,
    totalSales,
    periodStart: baseline.toISOString(),
    periodEnd: effectiveEnd.toISOString(),
    cycleKey: cycle.cycleKey,
    isSaturday: cycle.isSaturday,
    lastClosure: latestClosure
  };
};

export const buildWeeklyShiftClosureRecord = ({
  employee,
  stats,
  closedBy,
  mode = 'manual',
  closedAt = new Date(),
  id
}) => {
  const closedAtDate = toDate(closedAt) || new Date();

  return {
    id: id || `weekly_shift_${employee?.id || 'employee'}_${Date.now()}`,
    employeeId: employee?.id || '',
    employeeName: employee?.name || '',
    employeeEmail: employee?.email || '',
    employeeRole: employee?.role || '',
    hourlyRate: Number(employee?.hourlyRate || stats?.hourlyRate || 0),
    totalHours: roundHours(stats?.totalHours || 0),
    totalEarned: roundMoney(stats?.totalEarned || 0),
    totalSales: roundMoney(stats?.totalSales || 0),
    periodStart: stats?.periodStart || closedAtDate.toISOString(),
    periodEnd: closedAtDate.toISOString(),
    cycleKey: stats?.cycleKey || getWeeklyShiftCycleWindow(closedAtDate).cycleKey,
    closedAt: closedAtDate.toISOString(),
    closedById: closedBy?.id || '',
    closedByName: closedBy?.name || 'Sistema',
    closedByRole: closedBy?.role || '',
    mode,
    source: 'weekly_shift'
  };
};

export const getAutomaticWeeklyClosuresToCreate = ({
  employees = [],
  shifts = [],
  closures = [],
  sales = [],
  closedBy,
  referenceDate = new Date()
}) => {
  const cycle = getWeeklyShiftCycleWindow(referenceDate);
  if (!cycle.isSaturday) return [];

  return employees
    .filter((employee) => employee?.id)
    .map((employee) => {
      const stats = calculateEmployeeWeeklyShiftStats({
        employee,
        shifts,
        closures,
        sales,
        referenceDate
      });

      const existingAutoClosure = closures.find((closure) => (
        closure.employeeId === employee.id
        && closure.cycleKey === stats.cycleKey
        && closure.mode === 'auto'
      ));

      if (existingAutoClosure) return null;
      if ((stats.totalHours || 0) <= 0 && (stats.totalEarned || 0) <= 0 && (stats.totalSales || 0) <= 0) {
        return null;
      }

      return buildWeeklyShiftClosureRecord({
        employee,
        stats,
        closedBy,
        mode: 'auto',
        closedAt: referenceDate,
        id: `weekly_shift_auto_${employee.id}_${stats.cycleKey}`
      });
    })
    .filter(Boolean);
};

export const getEmployeeShiftLifetimeTotals = (employee, shifts = []) => {
  const totalHours = roundHours(
    shifts
      .filter((shift) => shift.employeeId === employee?.id)
      .reduce((sum, shift) => sum + getShiftNetHours(shift), 0)
  );
  const totalEarned = roundMoney(totalHours * Number(employee?.hourlyRate || 0));

  return {
    totalHours,
    totalEarned
  };
};
