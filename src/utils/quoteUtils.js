import { generateId } from '../data/demoData';
import { getSpecialOrderFinancialSummary } from './specialOrderUtils';

export const formatQuoteNumber = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const stamp = `${year}${month}${day}`;
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `COT-${stamp}-${suffix}`;
};

export const normalizeQuote = (quote = {}) => {
  const financialSummary = getSpecialOrderFinancialSummary(quote);

  return {
    id: quote.id || generateId('quote'),
    quoteNumber: quote.quoteNumber || quote.quote_number || formatQuoteNumber(),
    customerId: quote.customerId || quote.customer_id || '',
    customerName: quote.customerName || quote.customer_name || '',
    customerPhone: quote.customerPhone || quote.customer_phone || '',
    customerEmail: quote.customerEmail || quote.customer_email || '',
    items: financialSummary.items,
    subtotalAmount: financialSummary.subtotal,
    discountAmount: financialSummary.discount,
    taxAmount: financialSummary.tax,
    taxBreakdown: financialSummary.taxBreakdown,
    totalAmount: financialSummary.total,
    expectedDate: quote.expectedDate || quote.expected_date || '',
    internalNotes: quote.internalNotes || quote.internal_notes || '',
    createdBy: quote.createdBy || quote.created_by || '',
    createdById: quote.createdById || quote.created_by_id || '',
    updatedBy: quote.updatedBy || quote.updated_by || '',
    updatedById: quote.updatedById || quote.updated_by_id || '',
    createdAt: quote.createdAt || quote.created_at || new Date().toISOString(),
    updatedAt: quote.updatedAt || quote.updated_at || new Date().toISOString()
  };
};

export const buildSpecialOrderFromQuote = (quote, { performedBy, performedById } = {}) => {
  const normalizedQuote = normalizeQuote(quote);
  const now = new Date().toISOString();

  return {
    id: generateId('special_order'),
    customerId: normalizedQuote.customerId,
    customerName: normalizedQuote.customerName,
    customerPhone: normalizedQuote.customerPhone,
    customerEmail: normalizedQuote.customerEmail,
    items: normalizedQuote.items,
    expectedDate: normalizedQuote.expectedDate,
    internalNotes: normalizedQuote.internalNotes,
    createdBy: performedBy || normalizedQuote.createdBy,
    createdById: performedById || normalizedQuote.createdById,
    updatedBy: performedBy || normalizedQuote.updatedBy,
    updatedById: performedById || normalizedQuote.updatedById,
    createdAt: now,
    updatedAt: now,
    payments: []
  };
};
