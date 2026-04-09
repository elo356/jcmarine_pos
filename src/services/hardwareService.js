export const openCashDrawer = () => {
  if (typeof window === 'undefined') return false;

  window.dispatchEvent(
    new CustomEvent('pos:cash-drawer-open', {
      detail: {
        requestedAt: new Date().toISOString()
      }
    })
  );

  return true;
};
