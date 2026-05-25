import { loadData, saveData } from '../../data/demoData';
import { normalizeSpecialOrder, calculateSpecialOrderPaymentSummary, getSpecialOrderFinancialSummary } from '../specialOrderUtils';

// Script de migración (ejecutar en la consola del navegador o importar y llamar desde el app)
export const migrateSpecialOrdersTaxFormat = () => {
  if (typeof window === 'undefined') {
    console.warn('Este script está diseñado para ejecutarse en el navegador (usa localStorage).');
    return;
  }

  const current = loadData();
  const rawOrders = Array.isArray(current.specialOrders) ? current.specialOrders : [];
  if (rawOrders.length === 0) {
    console.info('No hay pedidos especiales en cache para migrar.');
    return;
  }

  const migrated = rawOrders.map((order) => {
    const normalized = normalizeSpecialOrder(order);

    const financialSummary = getSpecialOrderFinancialSummary(normalized);
    const subtotalAmount = financialSummary.subtotal;
    const discountAmount = financialSummary.discount;
    const taxAmount = financialSummary.tax;
    const taxBreakdown = financialSummary.taxBreakdown;
    const totalAmount = financialSummary.total;

    const paymentSummary = calculateSpecialOrderPaymentSummary(normalized.payments || [], totalAmount);

    return {
      ...normalized,
      subtotalAmount,
      discountAmount,
      taxAmount,
      taxBreakdown,
      totalAmount,
      depositAmount: paymentSummary.deposit,
      amountPaid: paymentSummary.netPaid,
      balanceDue: paymentSummary.balanceDue,
      paymentStatus: paymentSummary.paymentStatus
    };
  });

  const next = { ...current, specialOrders: migrated };
  saveData(next);
  console.info(`Migración completada: ${migrated.length} pedidos actualizados en local cache.`);
  return migrated.length;
};

export default migrateSpecialOrdersTaxFormat;
