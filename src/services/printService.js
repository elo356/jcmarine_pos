export const printHtmlDocument = async ({ title, html, printer = null }) => {
  const printWindow = window.open('', '_blank', 'width=900,height=700');

  if (!printWindow) {
    throw new Error('No se pudo abrir la ventana de impresión');
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.document.title = title;

  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };

  return {
    mode: 'browser',
    printerName: printer?.name || ''
  };
};
