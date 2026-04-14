const WEEKLY_SALES_CACHE_KEY = 'pos:weekly-sales-cache:v1';

const normalizeSaleDate = (sale) => {
  const parsed = new Date(sale?.date || sale?.created_at || 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const dedupeSales = (sales = []) => {
  const seen = new Set();

  return [...sales]
    .filter((sale) => sale && sale.id && !seen.has(sale.id) && seen.add(sale.id))
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
};

const getWeekWindow = (referenceDate = new Date()) => {
  const now = new Date(referenceDate);
  now.setHours(0, 0, 0, 0);

  const weekday = now.getDay();
  if (weekday === 0) {
    return {
      active: false,
      weekStartKey: null
    };
  }

  const mondayOffset = weekday - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - mondayOffset);
  monday.setHours(0, 0, 0, 0);

  return {
    active: true,
    weekStartKey: monday.toISOString().slice(0, 10),
    startAt: monday.getTime(),
    endAt: now.getTime() + (24 * 60 * 60 * 1000) - 1
  };
};

const readCache = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = localStorage.getItem(WEEKLY_SALES_CACHE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error('Error parsing weekly sales cache:', error);
    localStorage.removeItem(WEEKLY_SALES_CACHE_KEY);
    return null;
  }
};

const writeCache = (payload) => {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(WEEKLY_SALES_CACHE_KEY, JSON.stringify(payload));
};

const clearCache = () => {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.removeItem(WEEKLY_SALES_CACHE_KEY);
};

const filterSalesForCurrentWeek = (sales = [], referenceDate = new Date()) => {
  const week = getWeekWindow(referenceDate);
  if (!week.active) {
    return [];
  }

  return dedupeSales(
    sales.filter((sale) => {
      const saleDate = normalizeSaleDate(sale);
      if (!saleDate) return false;

      const saleTime = saleDate.getTime();
      return saleTime >= week.startAt && saleTime <= week.endAt;
    })
  );
};

export const loadWeeklySalesCache = (referenceDate = new Date()) => {
  const week = getWeekWindow(referenceDate);
  if (!week.active) {
    clearCache();
    return [];
  }

  const cached = readCache();
  if (!cached || cached.weekStartKey !== week.weekStartKey) {
    clearCache();
    return [];
  }

  return dedupeSales(Array.isArray(cached.sales) ? cached.sales : []);
};

export const syncWeeklySalesCache = (sales = [], referenceDate = new Date()) => {
  const week = getWeekWindow(referenceDate);
  if (!week.active) {
    clearCache();
    return [];
  }

  const weeklySales = filterSalesForCurrentWeek(sales, referenceDate);
  writeCache({
    weekStartKey: week.weekStartKey,
    updatedAt: new Date().toISOString(),
    sales: weeklySales
  });
  return weeklySales;
};

export const upsertWeeklyCachedSale = (sale, referenceDate = new Date()) => {
  const week = getWeekWindow(referenceDate);
  if (!week.active) {
    clearCache();
    return [];
  }

  const saleDate = normalizeSaleDate(sale);
  if (!saleDate) {
    return loadWeeklySalesCache(referenceDate);
  }

  const currentWeekSales = loadWeeklySalesCache(referenceDate);
  const weeklySales = filterSalesForCurrentWeek([sale, ...currentWeekSales], referenceDate);

  writeCache({
    weekStartKey: week.weekStartKey,
    updatedAt: new Date().toISOString(),
    sales: weeklySales
  });

  return weeklySales;
};

export const mergeWeeklyCachedSales = (sales = [], referenceDate = new Date()) =>
  dedupeSales([...(sales || []), ...loadWeeklySalesCache(referenceDate)]);
