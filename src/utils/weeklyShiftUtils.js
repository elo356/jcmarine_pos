const toDate = (value) => {
  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const roundHours = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const DEFAULT_CLOSE_DAY = 6;
const DEFAULT_CLOSE_TIME = '23:00';

const getCloseMinutes = (closeTime = DEFAULT_CLOSE_TIME) => {
  const [, hours = '23', minutes = '00'] = String(closeTime || DEFAULT_CLOSE_TIME).match(/^(\d{2}):(\d{2})$/) || [];
  return Math.min(23, Math.max(0, Number(hours || 23))) * 60
    + Math.min(59, Math.max(0, Number(minutes || 0)));
};

const normalizeWeeklyShiftSettings = (settings = {}) => ({
  closeDay: Number.isInteger(Number(settings.closeDay)) && Number(settings.closeDay) >= 0 && Number(settings.closeDay) <= 6
    ? Number(settings.closeDay)
    : DEFAULT_CLOSE_DAY,
  closeTime: /^\d{2}:\d{2}$/.test(String(settings.closeTime || '')) ? String(settings.closeTime) : DEFAULT_CLOSE_TIME
});

const getCycleStartForDate = (date) => {
  const cycleStart = new Date(date);
  cycleStart.setHours(0, 0, 0, 0);
  cycleStart.setDate(cycleStart.getDate() - cycleStart.getDay());
  return cycleStart;
};

const getCloseDateForCycleStart = (cycleStart, settings) => {
  const closeDate = new Date(cycleStart);
  const closeMinutes = getCloseMinutes(settings.closeTime);
  closeDate.setDate(closeDate.getDate() + settings.closeDay);
  closeDate.setHours(Math.floor(closeMinutes / 60), closeMinutes % 60, 0, 0);
  return closeDate;
};

const getLatestCompletedWeeklyClose = (referenceDate = new Date(), weeklyShiftSettings = {}) => {
  const now = toDate(referenceDate) || new Date();
  const settings = normalizeWeeklyShiftSettings(weeklyShiftSettings);
  const currentCycleStart = getCycleStartForDate(now);
  const currentCycleClose = getCloseDateForCycleStart(currentCycleStart, settings);
  const targetCycleStart = now >= currentCycleClose
    ? currentCycleStart
    : new Date(currentCycleStart.getTime() - (7 * 24 * 60 * 60 * 1000));
  const closeAt = getCloseDateForCycleStart(targetCycleStart, settings);

  return {
    cycleStart: targetCycleStart,
    cycleKey: targetCycleStart.toISOString().slice(0, 10),
    closeAt
  };
};

export const getWeeklyShiftCycleWindow = (referenceDate = new Date(), weeklyShiftSettings = {}) => {
  const now = toDate(referenceDate) || new Date();
  const settings = normalizeWeeklyShiftSettings(weeklyShiftSettings);
  const cycleStart = getCycleStartForDate(now);

  const cycleEnd = new Date(cycleStart);
  cycleEnd.setDate(cycleEnd.getDate() + 6);
  cycleEnd.setHours(23, 59, 59, 999);

  return {
    cycleStart,
    cycleEnd,
    cycleKey: cycleStart.toISOString().slice(0, 10),
    isCloseDay: now.getDay() === settings.closeDay,
    isCloseDue: now.getDay() === settings.closeDay
      && (now.getHours() * 60 + now.getMinutes()) >= getCloseMinutes(settings.closeTime),
    closeDay: settings.closeDay,
    closeTime: settings.closeTime,
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
  referenceDate = new Date(),
  weeklyShiftSettings = {}
}) => {
  const cycle = getWeeklyShiftCycleWindow(referenceDate, weeklyShiftSettings);
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
  referenceDate = new Date(),
  weeklyShiftSettings = {}
}) => {
  const latestCompletedClose = getLatestCompletedWeeklyClose(referenceDate, weeklyShiftSettings);
  const closedAt = latestCompletedClose.closeAt;

  return employees
    .filter((employee) => employee?.id)
    .map((employee) => {
      const stats = calculateEmployeeWeeklyShiftStats({
        employee,
        shifts,
        closures,
        sales,
        referenceDate: closedAt,
        weeklyShiftSettings
      });

      const existingClosure = closures.find((closure) => (
        closure.employeeId === employee.id
        && closure.cycleKey === latestCompletedClose.cycleKey
      ));

      if (existingClosure) return null;
      if ((stats.totalHours || 0) <= 0 && (stats.totalEarned || 0) <= 0 && (stats.totalSales || 0) <= 0) {
        return null;
      }

      return buildWeeklyShiftClosureRecord({
        employee,
        stats: {
          ...stats,
          cycleKey: latestCompletedClose.cycleKey
        },
        closedBy,
        mode: 'auto',
        closedAt,
        id: `weekly_shift_auto_${employee.id}_${latestCompletedClose.cycleKey}`
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
