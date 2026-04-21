import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, FileText, Plus, Receipt, Trash2, Wallet } from 'lucide-react';
import Input from '../components/Input';
import Notification from '../components/Notification';
import { formatCurrency, formatDateTime, generateId } from '../data/demoData';
import { useAuth } from '../contexts/AuthContext';
import {
  calculateInvoiceTotals,
  deleteExpense,
  deleteInvoice,
  normalizeInvoiceItem,
  saveExpense,
  saveInvoice,
  subscribeExpenses,
  subscribeInvoices
} from '../services/financeRecordsService';

const DEFAULT_EXPENSE_FORM = {
  title: '',
  vendor: '',
  category: '',
  paymentMethod: 'cash',
  amount: '',
  paidAt: new Date().toISOString().slice(0, 10),
  notes: ''
};

const createInvoiceItem = () => ({
  id: generateId('invoice_item'),
  description: '',
  quantity: 1,
  unitPrice: 0
});

const DEFAULT_INVOICE_FORM = {
  invoiceNumber: '',
  title: 'Factura',
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  billTo: '',
  issueDate: new Date().toISOString().slice(0, 10),
  dueDate: '',
  status: 'draft',
  notes: '',
  terms: '',
  footerText: '',
  taxRate: '',
  discountAmount: '',
  items: [createInvoiceItem()]
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getStatusBadgeClass = (status) => {
  switch (status) {
    case 'paid':
      return 'badge badge-green';
    case 'sent':
      return 'badge badge-blue';
    case 'overdue':
      return 'badge badge-red';
    default:
      return 'badge badge-gray';
  }
};

const FinancePage = () => {
  const { user, profile } = useAuth();
  const [expenses, setExpenses] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [expenseForm, setExpenseForm] = useState(DEFAULT_EXPENSE_FORM);
  const [invoiceForm, setInvoiceForm] = useState(DEFAULT_INVOICE_FORM);
  const [editingExpenseId, setEditingExpenseId] = useState('');
  const [editingInvoiceId, setEditingInvoiceId] = useState('');
  const [savingExpense, setSavingExpense] = useState(false);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    const unsubExpenses = subscribeExpenses(
      (rows) => setExpenses(rows),
      (error) => console.error('Error subscribing expenses:', error)
    );
    const unsubInvoices = subscribeInvoices(
      (rows) => setInvoices(rows),
      (error) => console.error('Error subscribing invoices:', error)
    );

    return () => {
      unsubExpenses();
      unsubInvoices();
    };
  }, []);

  const currentActor = useMemo(
    () => ({
      id: user?.uid || profile?.id || 'unknown',
      name: profile?.name || user?.email || 'Usuario',
      email: profile?.email || user?.email || '',
      role: profile?.role || 'cashier'
    }),
    [profile?.email, profile?.id, profile?.name, profile?.role, user?.email, user?.uid]
  );

  const expenseTotal = useMemo(
    () => expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    [expenses]
  );

  const invoiceTotal = useMemo(
    () => invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
    [invoices]
  );

  const draftTotals = useMemo(
    () => calculateInvoiceTotals({
      items: invoiceForm.items.map((item, index) => normalizeInvoiceItem(item, index)),
      taxRate: invoiceForm.taxRate,
      discountAmount: invoiceForm.discountAmount
    }),
    [invoiceForm.discountAmount, invoiceForm.items, invoiceForm.taxRate]
  );

  const resetExpenseForm = () => {
    setExpenseForm(DEFAULT_EXPENSE_FORM);
    setEditingExpenseId('');
  };

  const resetInvoiceForm = () => {
    setInvoiceForm({
      ...DEFAULT_INVOICE_FORM,
      items: [createInvoiceItem()]
    });
    setEditingInvoiceId('');
  };

  const handleExpenseChange = (field, value) => {
    setExpenseForm((current) => ({ ...current, [field]: value }));
  };

  const handleInvoiceFieldChange = (field, value) => {
    setInvoiceForm((current) => ({ ...current, [field]: value }));
  };

  const handleInvoiceItemChange = (itemId, field, value) => {
    setInvoiceForm((current) => ({
      ...current,
      items: current.items.map((item) => (
        item.id === itemId
          ? { ...item, [field]: field === 'description' ? value : value }
          : item
      ))
    }));
  };

  const addInvoiceItem = () => {
    setInvoiceForm((current) => ({
      ...current,
      items: [...current.items, createInvoiceItem()]
    }));
  };

  const removeInvoiceItem = (itemId) => {
    setInvoiceForm((current) => {
      if (current.items.length === 1) return current;
      return {
        ...current,
        items: current.items.filter((item) => item.id !== itemId)
      };
    });
  };

  const handleSaveExpense = async (event) => {
    event.preventDefault();

    if (!expenseForm.title.trim()) {
      setNotification({ type: 'error', message: 'Ponle un nombre al gasto.' });
      return;
    }

    if (toNumber(expenseForm.amount) <= 0) {
      setNotification({ type: 'error', message: 'El gasto debe ser mayor de 0.' });
      return;
    }

    setSavingExpense(true);
    try {
      const result = await saveExpense({
        id: editingExpenseId || generateId('expense'),
        title: expenseForm.title,
        vendor: expenseForm.vendor,
        category: expenseForm.category,
        paymentMethod: expenseForm.paymentMethod,
        amount: toNumber(expenseForm.amount),
        paidAt: expenseForm.paidAt,
        notes: expenseForm.notes,
        createdBy: currentActor.id,
        createdByName: currentActor.name,
        updatedBy: currentActor.id,
        updatedByName: currentActor.name
      });

      setNotification({
        type: result.localOnly ? 'warning' : 'success',
        message: result.localOnly
          ? 'Gasto guardado localmente. No se pudo sincronizar con Firestore.'
          : editingExpenseId
            ? 'Gasto actualizado.'
            : 'Gasto registrado.'
      });
      resetExpenseForm();
    } catch (error) {
      console.error('Error saving expense:', error);
      setNotification({ type: 'error', message: 'No se pudo guardar el gasto.' });
    } finally {
      setSavingExpense(false);
    }
  };

  const handleSaveInvoice = async (event) => {
    event.preventDefault();

    const normalizedItems = invoiceForm.items
      .map((item, index) => normalizeInvoiceItem(item, index))
      .filter((item) => item.description || toNumber(item.unitPrice) > 0);

    if (!invoiceForm.customerName.trim()) {
      setNotification({ type: 'error', message: 'La factura necesita cliente.' });
      return;
    }

    if (normalizedItems.length === 0) {
      setNotification({ type: 'error', message: 'Agrega al menos una linea a la factura.' });
      return;
    }

    setSavingInvoice(true);
    try {
      const result = await saveInvoice({
        id: editingInvoiceId || generateId('invoice'),
        invoiceNumber: invoiceForm.invoiceNumber || `FAC-${Date.now().toString().slice(-6)}`,
        title: invoiceForm.title,
        customerName: invoiceForm.customerName,
        customerEmail: invoiceForm.customerEmail,
        customerPhone: invoiceForm.customerPhone,
        billTo: invoiceForm.billTo,
        issueDate: invoiceForm.issueDate,
        dueDate: invoiceForm.dueDate,
        status: invoiceForm.status,
        notes: invoiceForm.notes,
        terms: invoiceForm.terms,
        footerText: invoiceForm.footerText,
        taxRate: toNumber(invoiceForm.taxRate),
        discountAmount: toNumber(invoiceForm.discountAmount),
        items: normalizedItems,
        createdBy: currentActor.id,
        createdByName: currentActor.name,
        updatedBy: currentActor.id,
        updatedByName: currentActor.name
      });

      setNotification({
        type: result.localOnly ? 'warning' : 'success',
        message: result.localOnly
          ? 'Factura guardada localmente. No se pudo sincronizar con Firestore.'
          : editingInvoiceId
            ? 'Factura actualizada.'
            : 'Factura creada.'
      });
      resetInvoiceForm();
    } catch (error) {
      console.error('Error saving invoice:', error);
      setNotification({ type: 'error', message: 'No se pudo guardar la factura.' });
    } finally {
      setSavingInvoice(false);
    }
  };

  const handleEditExpense = (expense) => {
    setEditingExpenseId(expense.id);
    setExpenseForm({
      title: expense.title || '',
      vendor: expense.vendor || '',
      category: expense.category || '',
      paymentMethod: expense.paymentMethod || 'cash',
      amount: expense.amount ?? '',
      paidAt: expense.paidAt || new Date().toISOString().slice(0, 10),
      notes: expense.notes || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEditInvoice = (invoice) => {
    setEditingInvoiceId(invoice.id);
    setInvoiceForm({
      invoiceNumber: invoice.invoiceNumber || '',
      title: invoice.title || 'Factura',
      customerName: invoice.customerName || '',
      customerEmail: invoice.customerEmail || '',
      customerPhone: invoice.customerPhone || '',
      billTo: invoice.billTo || '',
      issueDate: invoice.issueDate || new Date().toISOString().slice(0, 10),
      dueDate: invoice.dueDate || '',
      status: invoice.status || 'draft',
      notes: invoice.notes || '',
      terms: invoice.terms || '',
      footerText: invoice.footerText || '',
      taxRate: invoice.taxRate ?? '',
      discountAmount: invoice.discountAmount ?? '',
      items: (invoice.items?.length ? invoice.items : [createInvoiceItem()]).map((item, index) => ({
        ...normalizeInvoiceItem(item, index),
        quantity: item.quantity ?? 1,
        unitPrice: item.unitPrice ?? 0
      }))
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteExpense = async (expenseId) => {
    const result = await deleteExpense(expenseId);
    setNotification({
      type: result.localOnly ? 'warning' : 'success',
      message: result.localOnly
        ? 'Gasto borrado localmente. Fallo la sincronizacion remota.'
        : 'Gasto eliminado.'
    });
    if (editingExpenseId === expenseId) resetExpenseForm();
  };

  const handleDeleteInvoice = async (invoiceId) => {
    const result = await deleteInvoice(invoiceId);
    setNotification({
      type: result.localOnly ? 'warning' : 'success',
      message: result.localOnly
        ? 'Factura borrada localmente. Fallo la sincronizacion remota.'
        : 'Factura eliminada.'
    });
    if (editingInvoiceId === invoiceId) resetInvoiceForm();
  };

  return (
    <div className="page-container">
      {notification && (
        <Notification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Gastos y facturas</h1>
          <p className="text-sm text-gray-500 mt-1">
            Registra gastos del negocio y arma facturas completas desde un solo lugar.
          </p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <div className="stat-label">Total gastos</div>
              <div className="stat-value text-red-600">{formatCurrency(expenseTotal)}</div>
            </div>
            <Wallet className="text-red-500" size={28} />
          </div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <div className="stat-label">Total facturas</div>
              <div className="stat-value text-blue-600">{formatCurrency(invoiceTotal)}</div>
            </div>
            <Receipt className="text-blue-500" size={28} />
          </div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <div className="stat-label">Balance</div>
              <div className={`stat-value ${invoiceTotal - expenseTotal >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {formatCurrency(invoiceTotal - expenseTotal)}
              </div>
            </div>
            <Calculator className="text-emerald-500" size={28} />
          </div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <div className="stat-label">Documentos</div>
              <div className="stat-value">{expenses.length + invoices.length}</div>
              <div className="text-sm text-gray-500 mt-2">{invoices.length} facturas y {expenses.length} gastos</div>
            </div>
            <FileText className="text-gray-500" size={28} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <form onSubmit={handleSaveExpense} className="card p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Registrar gasto</h2>
              <p className="text-sm text-gray-500">Guarda compras, pagos y cualquier salida de dinero.</p>
            </div>
            {editingExpenseId && (
              <button type="button" className="btn-secondary" onClick={resetExpenseForm}>
                Cancelar edicion
              </button>
            )}
          </div>

          <Input
            label="Concepto"
            value={expenseForm.title}
            onChange={(e) => handleExpenseChange('title', e.target.value)}
            placeholder="Ej. compra de suplidos"
            required
          />
          <Input
            label="Proveedor"
            value={expenseForm.vendor}
            onChange={(e) => handleExpenseChange('vendor', e.target.value)}
            placeholder="Ej. Home Depot"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Categoria"
              value={expenseForm.category}
              onChange={(e) => handleExpenseChange('category', e.target.value)}
              placeholder="Ej. mantenimiento"
            />
            <Input
              label="Precio"
              type="number"
              min="0"
              step="0.01"
              value={expenseForm.amount}
              onChange={(e) => handleExpenseChange('amount', e.target.value)}
              placeholder="0.00"
              required
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Metodo</label>
              <select
                value={expenseForm.paymentMethod}
                onChange={(e) => handleExpenseChange('paymentMethod', e.target.value)}
                className="input w-full"
              >
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="transfer">Transferencia</option>
                <option value="check">Cheque</option>
                <option value="other">Otro</option>
              </select>
            </div>
            <Input
              label="Fecha"
              type="date"
              value={expenseForm.paidAt}
              onChange={(e) => handleExpenseChange('paidAt', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nota</label>
            <textarea
              value={expenseForm.notes}
              onChange={(e) => handleExpenseChange('notes', e.target.value)}
              rows={4}
              className="input w-full"
              placeholder="Detalle del gasto, referencia, observaciones..."
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={savingExpense}>
            <Wallet size={18} />
            {savingExpense ? 'Guardando...' : editingExpenseId ? 'Actualizar gasto' : 'Guardar gasto'}
          </button>
        </form>

        <form onSubmit={handleSaveInvoice} className="card p-6 space-y-5 xl:col-span-2">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Factura personalizable</h2>
              <p className="text-sm text-gray-500">
                Personaliza cliente, titulo, lineas, impuestos, descuento, terminos y notas.
              </p>
            </div>
            {editingInvoiceId && (
              <button type="button" className="btn-secondary" onClick={resetInvoiceForm}>
                Cancelar edicion
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label="Numero"
              value={invoiceForm.invoiceNumber}
              onChange={(e) => handleInvoiceFieldChange('invoiceNumber', e.target.value)}
              placeholder="FAC-1001"
            />
            <Input
              label="Titulo"
              value={invoiceForm.title}
              onChange={(e) => handleInvoiceFieldChange('title', e.target.value)}
              placeholder="Factura marina"
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
              <select
                value={invoiceForm.status}
                onChange={(e) => handleInvoiceFieldChange('status', e.target.value)}
                className="input w-full"
              >
                <option value="draft">Borrador</option>
                <option value="sent">Enviada</option>
                <option value="paid">Pagada</option>
                <option value="overdue">Vencida</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Cliente"
              value={invoiceForm.customerName}
              onChange={(e) => handleInvoiceFieldChange('customerName', e.target.value)}
              placeholder="Nombre del cliente"
              required
            />
            <Input
              label="Email"
              type="email"
              value={invoiceForm.customerEmail}
              onChange={(e) => handleInvoiceFieldChange('customerEmail', e.target.value)}
              placeholder="cliente@email.com"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label="Telefono"
              value={invoiceForm.customerPhone}
              onChange={(e) => handleInvoiceFieldChange('customerPhone', e.target.value)}
              placeholder="(787) 000-0000"
            />
            <Input
              label="Fecha emision"
              type="date"
              value={invoiceForm.issueDate}
              onChange={(e) => handleInvoiceFieldChange('issueDate', e.target.value)}
            />
            <Input
              label="Fecha vencimiento"
              type="date"
              value={invoiceForm.dueDate}
              onChange={(e) => handleInvoiceFieldChange('dueDate', e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Facturar a</label>
            <textarea
              value={invoiceForm.billTo}
              onChange={(e) => handleInvoiceFieldChange('billTo', e.target.value)}
              rows={3}
              className="input w-full"
              placeholder="Direccion o datos completos del cliente"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Lineas de factura</h3>
              <button type="button" onClick={addInvoiceItem} className="btn-secondary">
                <Plus size={16} />
                Agregar linea
              </button>
            </div>

            <div className="space-y-3 max-h-[24rem] overflow-y-auto pr-1">
              {invoiceForm.items.map((item, index) => {
                const quantity = toNumber(item.quantity || 0);
                const unitPrice = toNumber(item.unitPrice || 0);
                const lineTotal = quantity * unitPrice;

                return (
                  <div key={item.id} className="border border-gray-200 rounded-xl p-4 bg-gray-50">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="font-medium text-gray-900">Linea {index + 1}</div>
                      <button
                        type="button"
                        onClick={() => removeInvoiceItem(item.id)}
                        className="btn-secondary"
                        disabled={invoiceForm.items.length === 1}
                      >
                        <Trash2 size={16} />
                        Quitar
                      </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-[1.8fr,0.8fr,0.8fr,0.8fr] gap-3">
                      <Input
                        label="Descripcion"
                        value={item.description}
                        onChange={(e) => handleInvoiceItemChange(item.id, 'description', e.target.value)}
                        placeholder="Servicio, pieza o trabajo realizado"
                      />
                      <Input
                        label="Cantidad"
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.quantity}
                        onChange={(e) => handleInvoiceItemChange(item.id, 'quantity', e.target.value)}
                      />
                      <Input
                        label="Precio"
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => handleInvoiceItemChange(item.id, 'unitPrice', e.target.value)}
                      />
                      <div className="rounded-lg border border-gray-200 bg-white px-4 py-2">
                        <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Total linea</div>
                        <div className="text-lg font-semibold text-gray-900">{formatCurrency(lineTotal)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Impuesto %"
              type="number"
              min="0"
              step="0.01"
              value={invoiceForm.taxRate}
              onChange={(e) => handleInvoiceFieldChange('taxRate', e.target.value)}
              placeholder="0"
            />
            <Input
              label="Descuento"
              type="number"
              min="0"
              step="0.01"
              value={invoiceForm.discountAmount}
              onChange={(e) => handleInvoiceFieldChange('discountAmount', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card bg-gray-50 p-4">
              <div className="stat-label">Subtotal</div>
              <div className="text-2xl font-bold text-gray-900">{formatCurrency(draftTotals.subtotal)}</div>
            </div>
            <div className="card bg-gray-50 p-4">
              <div className="stat-label">Impuesto</div>
              <div className="text-2xl font-bold text-blue-600">{formatCurrency(draftTotals.taxAmount)}</div>
            </div>
            <div className="card bg-gray-50 p-4">
              <div className="stat-label">Total factura</div>
              <div className="text-2xl font-bold text-emerald-600">{formatCurrency(draftTotals.total)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Terminos</label>
              <textarea
                value={invoiceForm.terms}
                onChange={(e) => handleInvoiceFieldChange('terms', e.target.value)}
                rows={4}
                className="input w-full"
                placeholder="Condiciones de pago, garantia, entrega..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notas internas o visibles</label>
              <textarea
                value={invoiceForm.notes}
                onChange={(e) => handleInvoiceFieldChange('notes', e.target.value)}
                rows={4}
                className="input w-full"
                placeholder="Notas adicionales para esta factura"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Pie o mensaje final</label>
            <textarea
              value={invoiceForm.footerText}
              onChange={(e) => handleInvoiceFieldChange('footerText', e.target.value)}
              rows={3}
              className="input w-full"
              placeholder="Gracias por su negocio, informacion bancaria, instrucciones..."
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={savingInvoice}>
            <Receipt size={18} />
            {savingInvoice ? 'Guardando...' : editingInvoiceId ? 'Actualizar factura' : 'Guardar factura'}
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="card overflow-hidden">
          <div className="px-6 pt-6">
            <h2 className="text-lg font-semibold text-gray-900">Historial de gastos</h2>
            <p className="text-sm text-gray-500">Se muestran los gastos mas recientes con scroll para mantener la vista limpia.</p>
          </div>
          <div className="table-container max-h-[26rem] overflow-y-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th>Fecha</th>
                  <th>Categoria</th>
                  <th>Precio</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="text-center py-8 text-gray-500">No hay gastos registrados todavia.</td>
                  </tr>
                ) : (
                  expenses.map((expense) => (
                    <tr key={expense.id} className="hover:bg-gray-50">
                      <td>
                        <div className="font-medium text-gray-900">{expense.title || '-'}</div>
                        <div className="text-xs text-gray-500">{expense.vendor || 'Sin proveedor'} • {expense.paymentMethod || 'Metodo libre'}</div>
                      </td>
                      <td>{expense.paidAt || formatDateTime(expense.createdAt)}</td>
                      <td>{expense.category || '-'}</td>
                      <td className="font-semibold text-red-600">{formatCurrency(expense.amount || 0)}</td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => handleEditExpense(expense)} className="btn-secondary btn-sm">
                            Editar
                          </button>
                          <button type="button" onClick={() => handleDeleteExpense(expense.id)} className="btn-secondary btn-sm">
                            Borrar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-6 pt-6">
            <h2 className="text-lg font-semibold text-gray-900">Historial de facturas</h2>
            <p className="text-sm text-gray-500">Cada factura guarda cliente, lineas, terminos y total calculado.</p>
          </div>
          <div className="table-container max-h-[26rem] overflow-y-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Factura</th>
                  <th>Cliente</th>
                  <th>Estado</th>
                  <th>Total</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="text-center py-8 text-gray-500">No hay facturas registradas todavia.</td>
                  </tr>
                ) : (
                  invoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-gray-50">
                      <td>
                        <div className="font-medium text-gray-900">{invoice.invoiceNumber || invoice.id}</div>
                        <div className="text-xs text-gray-500">{invoice.title || 'Factura'} • {invoice.items?.length || 0} lineas</div>
                      </td>
                      <td>
                        <div className="font-medium text-gray-900">{invoice.customerName || '-'}</div>
                        <div className="text-xs text-gray-500">{invoice.issueDate || formatDateTime(invoice.createdAt)}</div>
                      </td>
                      <td>
                        <span className={getStatusBadgeClass(invoice.status)}>
                          {invoice.status === 'draft' ? 'Borrador' : invoice.status === 'sent' ? 'Enviada' : invoice.status === 'paid' ? 'Pagada' : 'Vencida'}
                        </span>
                      </td>
                      <td className="font-semibold text-emerald-600">{formatCurrency(invoice.total || 0)}</td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => handleEditInvoice(invoice)} className="btn-secondary btn-sm">
                            Editar
                          </button>
                          <button type="button" onClick={() => handleDeleteInvoice(invoice.id)} className="btn-secondary btn-sm">
                            Borrar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FinancePage;
