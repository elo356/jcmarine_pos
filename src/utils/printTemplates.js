import { formatCurrency, formatDateTime, formatQuantity } from '../data/demoData';
import { getPaymentMethodLabel } from './paymentUtils';

const basePrintDocument = ({ title, body }) => `
  <!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          color: #111827;
          margin: 0;
          padding: 24px;
        }
        .sheet {
          max-width: 720px;
          margin: 0 auto;
        }
        h1, h2, h3, p {
          margin: 0;
        }
        .header, .footer, .section {
          margin-bottom: 16px;
        }
        .muted {
          color: #6b7280;
          font-size: 12px;
        }
        .row {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 6px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }
        th, td {
          padding: 8px 0;
          border-bottom: 1px solid #e5e7eb;
          text-align: left;
        }
        th:last-child, td:last-child {
          text-align: right;
        }
        .totals {
          margin-top: 12px;
          border-top: 2px solid #111827;
          padding-top: 12px;
        }
        @media print {
          body {
            padding: 0;
          }
          .sheet {
            max-width: 100%;
          }
        }
      </style>
    </head>
    <body>
      <div class="sheet">
        ${body}
      </div>
    </body>
  </html>
`;

const buildStoreHeader = ({ employeeLabel, employeeValue, printerName = '' }) => `
  <div class="header" style="text-align:center;">
    <img
      src="${window.location.origin}/logo3-removebg-preview.png"
      alt="CJ Marine"
      style="width:88px;height:auto;display:block;margin:0 auto 8px;"
    />
    <h1 style="font-size:22px;">CJ Marine</h1>
    <p class="muted" style="margin-top:6px;">Carr 111 km 05</p>
    <p class="muted">Aguadilla 00603</p>
    <p class="muted">939 200 8820</p>
    ${employeeValue ? `<p class="muted" style="margin-top:8px;">${employeeLabel}: ${employeeValue}</p>` : ''}
    ${printerName ? `<p class="muted">Destino: ${printerName}</p>` : ''}
  </div>
`;

const dottedDivider = `
  <div class="section">
    <p class="muted" style="letter-spacing:2px;">................................</p>
  </div>
`;

export const buildSalePrintHtml = ({ sale, documentType = 'receipt', printerName = '' }) => {
  const title = documentType === 'invoice' ? `Factura ${sale.id}` : `Recibo ${sale.id}`;
  const body = `
    ${buildStoreHeader({
      employeeLabel: 'Empleado',
      employeeValue: sale.cashier,
      printerName
    })}

    ${dottedDivider}

    <div class="section">
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>Precio</th>
          </tr>
        </thead>
        <tbody>
          ${sale.items.map((item) => `
            <tr>
              <td>${item.name}${item.quantity > 1 ? ` x${formatQuantity(item.quantity, item.unitType)}` : ''}</td>
              <td>${formatCurrency(item.subtotal)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="totals">
      <div class="row"><span>Subtotal</span><strong>${formatCurrency(sale.subtotal)}</strong></div>
      <div class="row"><span>IVU municipal</span><strong>${formatCurrency(sale.taxBreakdown?.municipal || 0)}</strong></div>
      <div class="row"><span>IVU estatal</span><strong>${formatCurrency(sale.taxBreakdown?.state || 0)}</strong></div>
      <div class="row"><span>Total</span><strong>${formatCurrency(sale.total)}</strong></div>
      <div class="row"><span>Tipo de pago</span><strong>${getPaymentMethodLabel(sale.paymentMethod)}</strong></div>
      ${sale.payments?.[0]?.change_due ? `<div class="row"><span>Cambio</span><strong>${formatCurrency(sale.payments[0].change_due)}</strong></div>` : ''}
    </div>

    ${dottedDivider}

    <div class="footer">
      <p style="font-size:12px;line-height:1.45;">
        Piezas y accesorios despachados correctamente no tienen devolucion. Se aceptan cambios dentro de los primeros 7 dias de la compra con recibo y empaque original.
      </p>
      <p class="muted" style="margin-top:12px;">Fecha: ${formatDateTime(sale.date)}</p>
      <p class="muted">Venta: ${sale.id}</p>
      <p class="muted">${documentType === 'invoice' ? 'Factura' : 'Recibo'}</p>
    </div>
  `;

  return basePrintDocument({ title, body });
};

export const buildSpecialOrderPrintHtml = ({ order, printerName = '' }) => {
  const body = `
    ${buildStoreHeader({
      employeeLabel: 'Cliente',
      employeeValue: order.customerName,
      printerName
    })}

    ${dottedDivider}

    <div class="section">
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>Precio</th>
          </tr>
        </thead>
        <tbody>
          ${order.items.map((item) => `
            <tr>
              <td>${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ''}</td>
              <td>${formatCurrency(item.subtotal || 0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="totals">
      <div class="row"><span>Total</span><strong>${formatCurrency(order.totalAmount)}</strong></div>
      <div class="row"><span>Anticipo</span><strong>${formatCurrency(order.depositAmount)}</strong></div>
      <div class="row"><span>Cobrado</span><strong>${formatCurrency(order.amountPaid)}</strong></div>
      <div class="row"><span>Balance</span><strong>${formatCurrency(order.balanceDue)}</strong></div>
    </div>

    ${dottedDivider}

    <div class="footer">
      <p style="font-size:12px;line-height:1.45;">
        Piezas y accesorios despachados correctamente no tienen devolucion. Se aceptan cambios dentro de los primeros 7 dias de la compra con recibo y empaque original.
      </p>
      <p class="muted" style="margin-top:12px;">Fecha: ${formatDateTime(order.createdAt)}</p>
      <p class="muted">Pedido: ${order.orderNumber}</p>
      <p class="muted">Teléfono: ${order.customerPhone || '-'}</p>
    </div>
  `;

  return basePrintDocument({ title: `Pedido ${order.orderNumber}`, body });
};

export const buildPrinterTestHtml = ({ printer }) => basePrintDocument({
  title: `Prueba ${printer.name}`,
  body: `
    <div class="header">
      <h1>Prueba de impresora</h1>
      <p class="muted">CJ Marine</p>
    </div>
    <div class="section">
      <p><strong>Impresora:</strong> ${printer.name}</p>
      <p><strong>Marca/Modelo:</strong> ${printer.brand || 'N/A'} ${printer.model || ''}</p>
      <p><strong>Conexión:</strong> ${printer.connectionType || 'N/A'}</p>
      <p><strong>Fecha:</strong> ${formatDateTime(new Date().toISOString())}</p>
    </div>
    <div class="section">
      <p>Si este documento sale correctamente, la impresión desde el navegador está funcionando.</p>
    </div>
  `
});
