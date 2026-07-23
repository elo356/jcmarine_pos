import { useEffect, useRef, useState } from 'react';
import { subscribeEmployees } from '../services/employeesService';
import { subscribeSales } from '../services/salesService';
import { subscribeShifts } from '../services/shiftsService';
import { DEFAULT_SYSTEM_SETTINGS, subscribeSystemSettings } from '../services/settingsService';
import { saveWeeklyShiftClosure, subscribeWeeklyShiftClosures } from '../services/weeklyShiftClosureService';
import { getAutomaticWeeklyClosuresToCreate } from '../utils/weeklyShiftUtils';

const AUTO_CLOSE_CHECK_INTERVAL_MS = 60 * 1000;

const SYSTEM_AUTO_CLOSE_ACTOR = {
  id: 'system',
  name: 'Sistema',
  role: 'system'
};

export const useWeeklyShiftAutoClose = (enabled = true) => {
  const [employees, setEmployees] = useState([]);
  const [sales, setSales] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [closures, setClosures] = useState([]);
  const [systemSettings, setSystemSettings] = useState(DEFAULT_SYSTEM_SETTINGS);
  const latestDataRef = useRef({
    employees: [],
    sales: [],
    shifts: [],
    closures: [],
    systemSettings: DEFAULT_SYSTEM_SETTINGS
  });
  const runningRef = useRef(false);

  useEffect(() => {
    latestDataRef.current = {
      employees,
      sales,
      shifts,
      closures,
      systemSettings
    };
  }, [closures, employees, sales, shifts, systemSettings]);

  useEffect(() => {
    if (!enabled) return undefined;

    const unsubEmployees = subscribeEmployees(
      (rows) => setEmployees(rows || []),
      (error) => console.error('Error subscribing employees for weekly shift auto-close:', error)
    );
    const unsubSales = subscribeSales(
      (rows) => setSales(rows || []),
      (error) => console.error('Error subscribing sales for weekly shift auto-close:', error)
    );
    const unsubShifts = subscribeShifts(
      (rows) => setShifts(rows || []),
      (error) => console.error('Error subscribing shifts for weekly shift auto-close:', error)
    );
    const unsubClosures = subscribeWeeklyShiftClosures(
      (rows) => setClosures(rows || []),
      (error) => console.error('Error subscribing weekly closures for auto-close:', error)
    );
    const unsubSettings = subscribeSystemSettings(
      (settings) => setSystemSettings(settings || DEFAULT_SYSTEM_SETTINGS),
      (error) => console.error('Error subscribing settings for weekly shift auto-close:', error)
    );

    return () => {
      unsubEmployees();
      unsubSales();
      unsubShifts();
      unsubClosures();
      unsubSettings();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;

    const runAutoClose = async () => {
      if (runningRef.current) return;
      runningRef.current = true;

      try {
        const {
          employees: latestEmployees,
          sales: latestSales,
          shifts: latestShifts,
          closures: latestClosures,
          systemSettings: latestSettings
        } = latestDataRef.current;

        const automaticClosures = getAutomaticWeeklyClosuresToCreate({
          employees: latestEmployees,
          shifts: latestShifts,
          closures: latestClosures,
          sales: latestSales,
          closedBy: SYSTEM_AUTO_CLOSE_ACTOR,
          referenceDate: new Date(),
          weeklyShiftSettings: latestSettings.weeklyShift
        });

        if (automaticClosures.length === 0) return;

        await Promise.all(automaticClosures.map((closure) => saveWeeklyShiftClosure(closure)));
      } catch (error) {
        console.error('Error running weekly shift auto-close:', error);
      } finally {
        runningRef.current = false;
      }
    };

    runAutoClose();
    const intervalId = window.setInterval(runAutoClose, AUTO_CLOSE_CHECK_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [enabled]);
};
