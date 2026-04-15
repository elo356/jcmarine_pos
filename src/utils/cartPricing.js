export const IVU_STATE_RATE = 0.105;
export const IVU_MUNICIPAL_RATE = 0.01;

export const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

export const calculateItemPricing = (item = {}) => {
  const quantity = Math.max(0, Number(item.quantity || 0));
  const subtotal = Number(item.price ?? item.unitPrice ?? 0) * quantity;
  const discount = item.discount?.type === 'fixed'
    ? {
        type: 'fixed',
        value: Math.max(0, Number(item.discount?.value || 0))
      }
    : {
        type: 'percentage',
        value: Math.max(0, Number(item.discount?.value || 0))
      };

  const rawDiscountAmount = discount.type === 'percentage'
    ? subtotal * (discount.value / 100)
    : discount.value;
  const discountAmount = Math.min(Math.max(rawDiscountAmount, 0), subtotal);
  const taxableSubtotal = subtotal - discountAmount;
  const stateTax = item.ivuStateEnabled !== false ? taxableSubtotal * IVU_STATE_RATE : 0;
  const municipalTax = item.ivuMunicipalEnabled !== false ? taxableSubtotal * IVU_MUNICIPAL_RATE : 0;
  const totalTax = stateTax + municipalTax;

  return {
    subtotal: roundMoney(subtotal),
    discount,
    discountAmount: roundMoney(discountAmount),
    taxableSubtotal: roundMoney(taxableSubtotal),
    stateTax: roundMoney(stateTax),
    municipalTax: roundMoney(municipalTax),
    totalTax: roundMoney(totalTax),
    total: roundMoney(taxableSubtotal + totalTax)
  };
};
