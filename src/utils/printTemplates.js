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
              <td>${item.name}${item.quantity > 1 ? ` x${formatQuantity(item.quantity, item.unitType)}` : ''}${item.discountAmount > 0 ? ` <span class="muted">(Desc. ${formatCurrency(item.discountAmount)})</span>` : ''}</td>
              <td>${formatCurrency(item.taxableSubtotal || item.subtotal)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="totals">
      <div class="row"><span>Subtotal</span><strong>${formatCurrency(sale.subtotal)}</strong></div>
      ${sale.discount > 0 ? `<div class="row"><span>Descuentos</span><strong>-${formatCurrency(sale.discount)}</strong></div>` : ''}
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

export const buildSaleRefundPrintHtml = ({ sale, refund, printerName = '' }) => {
  const body = `
    ${buildStoreHeader({
      employeeLabel: 'Empleado',
      employeeValue: refund.refundedBy || sale.cashier,
      printerName
    })}

    ${dottedDivider}

    <div class="section">
      <div class="row"><span>Venta</span><strong>${sale.id}</strong></div>
      <div class="row"><span>Fecha venta</span><strong>${formatDateTime(sale.date)}</strong></div>
      <div class="row"><span>Fecha refund</span><strong>${formatDateTime(refund.refundedAt)}</strong></div>
      <div class="row"><span>Método</span><strong>${getPaymentMethodLabel(refund.method)}</strong></div>
      <div class="row"><span>Monto refund</span><strong>${formatCurrency(refund.amount)}</strong></div>
      <div class="row"><span>Total original</span><strong>${formatCurrency(sale.total)}</strong></div>
    </div>

    ${refund.reason ? `
      ${dottedDivider}
      <div class="section">
        <p><strong>Razón:</strong> ${refund.reason}</p>
        ${refund.notes ? `<p class="muted" style="margin-top:8px;">${refund.notes}</p>` : ''}
      </div>
    ` : ''}

    ${dottedDivider}

    <div class="footer">
      <p class="muted" style="margin-top:12px;">Documento: Recibo de reembolso</p>
      <p class="muted">Venta: ${sale.id}</p>
      <p class="muted">Reembolso: ${refund.id}</p>
    </div>
  `;

  return basePrintDocument({ title: `Reembolso ${refund.id}`, body });
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

export const buildStoreClosurePrintHtml = ({ summary, printerName = '' }) => {
  const body = `
    ${buildStoreHeader({
      employeeLabel: 'Cierre',
      employeeValue: `Shift #${summary.shiftNumber}`,
      printerName
    })}

    ${dottedDivider}

    <div class="section">
      <div class="row"><span>Abrió</span><strong>${summary.openedByName}</strong></div>
      <div class="row"><span>Hora apertura</span><strong>${formatDateTime(summary.openedAt)}</strong></div>
      <div class="row"><span>Cerró</span><strong>${summary.closedByName}</strong></div>
      <div class="row"><span>Hora cierre</span><strong>${formatDateTime(summary.closeTime)}</strong></div>
    </div>

    ${dottedDivider}

    <div class="section">
      <h3 style="margin-bottom:8px;">Cash Drawer</h3>
      <div class="row"><span>Starting Cash</span><strong>${formatCurrency(summary.startingCash)}</strong></div>
      <div class="row"><span>Cash Payments</span><strong>${formatCurrency(summary.cashPayments)}</strong></div>
      <div class="row"><span>Cash Refunds</span><strong>${formatCurrency(summary.cashRefunds)}</strong></div>
      <div class="row"><span>Paid In</span><strong>${formatCurrency(summary.paidIn)}</strong></div>
      <div class="row"><span>Paid Out</span><strong>${formatCurrency(summary.paidOut)}</strong></div>
      <div class="row"><span>Expected Cash Amount</span><strong>${formatCurrency(summary.expectedCashAmount)}</strong></div>
      <div class="row"><span>Actual Cash Amount</span><strong>${formatCurrency(summary.actualCashAmount)}</strong></div>
      <div class="row"><span>Difference</span><strong>${formatCurrency(summary.difference)}</strong></div>
    </div>

    ${dottedDivider}

    <div class="section">
      <h3 style="margin-bottom:8px;">Sales Summary</h3>
      <div class="row"><span>Gross Sales</span><strong>${formatCurrency(summary.grossSales)}</strong></div>
      <div class="row"><span>Refunds</span><strong>${formatCurrency(summary.refunds)}</strong></div>
      <div class="row"><span>Discounts</span><strong>${formatCurrency(summary.discounts)}</strong></div>
      <div class="row"><span>Net Sales</span><strong>${formatCurrency(summary.netSales)}</strong></div>
      <div class="row"><span>Taxes</span><strong>${formatCurrency(summary.taxes)}</strong></div>
      <div class="row"><span>Total Tendered</span><strong>${formatCurrency(summary.totalTendered)}</strong></div>
      <div class="row"><span>Cash</span><strong>${formatCurrency(summary.tenders.cash)}</strong></div>
      <div class="row"><span>ATH Móvil</span><strong>${formatCurrency(summary.tenders.athMovil)}</strong></div>
      <div class="row"><span>Tarjeta</span><strong>${formatCurrency(summary.tenders.card)}</strong></div>
    </div>
  `;

  return basePrintDocument({ title: `Cierre tienda ${summary.shiftNumber}`, body });
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
