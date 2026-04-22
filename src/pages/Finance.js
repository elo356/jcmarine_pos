import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, FileText, Receipt, Wallet } from 'lucide-react';
import Input from '../components/Input';
import Notification from '../components/Notification';
import { formatCurrency, formatDateTime, generateId } from '../data/demoData';
import { useAuth } from '../contexts/AuthContext';
import {
  deleteExpense,
  deleteInvoice,
  saveExpense,
  saveInvoice,
  subscribeExpenses,
  subscribeInvoices
} from '../services/financeRecordsService';
import { saveFinanceCompany, subscribeFinanceCompanies } from '../services/financeCompaniesService';

const INVOICE_ISSUER_NAME = 'CJ Marine';
const INVOICE_ISSUER_EMAIL = 'cjmarinepr@gmail.com';

const DEFAULT_EXPENSE_FORM = {
  title: '',
  vendor: '',
  paymentMethod: 'cash',
  amount: '',
  paidAt: new Date().toISOString().slice(0, 10),
  notes: ''
};

const DEFAULT_INVOICE_FORM = {
  invoiceNumber: '',
  title: 'Factura',
  companyName: '',
  customerPhone: '',
  issueDate: new Date().toISOString().slice(0, 10),
  status: 'unpaid',
  paidAt: '',
  amount: ''
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const FinancePage = () => {
  const { user, profile } = useAuth();
  const [expenses, setExpenses] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [companies, setCompanies] = useState([]);
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
    const unsubCompanies = subscribeFinanceCompanies(
      (rows) => setCompanies(rows.filter((company) => company.active !== false)),
      (error) => console.error('Error subscribing companies:', error)
    );

    return () => {
      unsubExpenses();
      unsubInvoices();
      unsubCompanies();
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

  const draftTotal = useMemo(() => toNumber(invoiceForm.amount), [invoiceForm.amount]);

  const resetExpenseForm = () => {
    setExpenseForm(DEFAULT_EXPENSE_FORM);
    setEditingExpenseId('');
  };

  const resetInvoiceForm = () => {
    setInvoiceForm(DEFAULT_INVOICE_FORM);
    setEditingInvoiceId('');
  };

  const handleExpenseChange = (field, value) => {
    setExpenseForm((current) => ({ ...current, [field]: value }));
  };

  const handleInvoiceFieldChange = (field, value) => {
    setInvoiceForm((current) => ({ ...current, [field]: value }));
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

    if (!invoiceForm.companyName.trim()) {
      setNotification({ type: 'error', message: 'La factura necesita una compania.' });
      return;
    }

    if (toNumber(invoiceForm.amount) <= 0) {
      setNotification({ type: 'error', message: 'El total de la factura debe ser mayor de 0.' });
      return;
    }

    setSavingInvoice(true);
    try {
      const normalizedCompanyName = invoiceForm.companyName.trim();
      const existingCompany = companies.find(
        (company) => company.name.trim().toLowerCase() === normalizedCompanyName.toLowerCase()
      );

      if (!existingCompany) {
        await saveFinanceCompany({
          name: normalizedCompanyName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }

      const result = await saveInvoice({
        id: editingInvoiceId || generateId('invoice'),
        invoiceNumber: invoiceForm.invoiceNumber || `FAC-${Date.now().toString().slice(-6)}`,
        title: invoiceForm.title,
        companyName: normalizedCompanyName,
        customerName: normalizedCompanyName,
        customerPhone: invoiceForm.customerPhone,
        issuerName: INVOICE_ISSUER_NAME,
        issuerEmail: INVOICE_ISSUER_EMAIL,
        issueDate: invoiceForm.issueDate,
        dueDate: '',
        status: invoiceForm.status,
        paidAt: invoiceForm.status === 'paid'
          ? (invoiceForm.paidAt || new Date().toISOString().slice(0, 10))
          : '',
        amount: toNumber(invoiceForm.amount),
        items: [],
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
      companyName: invoice.companyName || invoice.customerName || '',
      customerPhone: invoice.customerPhone || '',
      issueDate: invoice.issueDate || new Date().toISOString().slice(0, 10),
      status: invoice.status === 'paid' ? 'paid' : 'unpaid',
      paidAt: invoice.paidAt ? String(invoice.paidAt).slice(0, 10) : '',
      amount: invoice.amount ?? invoice.total ?? ''
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
              <h2 className="text-lg font-semibold text-gray-900">Factura</h2>
              <p className="text-sm text-gray-500">
                Emitida por {INVOICE_ISSUER_NAME} - {INVOICE_ISSUER_EMAIL}
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
                <option value="paid">Pagada</option>
                <option value="unpaid">No pagada</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Compania</label>
            <input
              list="finance-company-options"
              value={invoiceForm.companyName}
              onChange={(e) => handleInvoiceFieldChange('companyName', e.target.value)}
              className="input w-full"
              placeholder="Escribe el nombre de la compania"
              required
            />
            <datalist id="finance-company-options">
              {companies.map((company) => (
                <option key={company.id} value={company.name}>
                  {company.name}
                </option>
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label="Telefono"
              value={invoiceForm.customerPhone}
              onChange={(e) => handleInvoiceFieldChange('customerPhone', e.target.value)}
              placeholder="(787) 000-0000"
            />
            <Input
              label="Fecha registrada"
              type="date"
              value={invoiceForm.issueDate}
              onChange={(e) => handleInvoiceFieldChange('issueDate', e.target.value)}
            />
            <Input
              label="Fecha pagada"
              type="date"
              value={invoiceForm.paidAt}
              onChange={(e) => handleInvoiceFieldChange('paidAt', e.target.value)}
              disabled={invoiceForm.status !== 'paid'}
            />
          </div>

          <Input
            label="Total"
            type="number"
            min="0"
            step="0.01"
            value={invoiceForm.amount}
            onChange={(e) => handleInvoiceFieldChange('amount', e.target.value)}
            placeholder="0.00"
            required
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card bg-gray-50 p-4">
              <div className="stat-label">Fecha de registro</div>
              <div className="text-lg font-bold text-gray-900">{invoiceForm.issueDate || '-'}</div>
            </div>
            <div className="card bg-gray-50 p-4">
              <div className="stat-label">Total factura</div>
              <div className="text-2xl font-bold text-emerald-600">{formatCurrency(draftTotal)}</div>
            </div>
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
                  <th>Precio</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="text-center py-8 text-gray-500">No hay gastos registrados todavia.</td>
                  </tr>
                ) : (
                  expenses.map((expense) => (
                    <tr key={expense.id} className="hover:bg-gray-50">
                      <td>
                        <div className="font-medium text-gray-900">{expense.title || '-'}</div>
                        <div className="text-xs text-gray-500">{expense.vendor || 'Sin proveedor'} - {expense.paymentMethod || 'Metodo libre'}</div>
                      </td>
                      <td>{expense.paidAt || formatDateTime(expense.createdAt)}</td>
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
            <p className="text-sm text-gray-500">Cada factura guarda compania, fecha de registro, fecha de pago y total.</p>
          </div>
          <div className="table-container max-h-[26rem] overflow-y-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Factura</th>
                  <th>Compania</th>
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
                        <div className="text-xs text-gray-500">
                          {invoice.title || 'Factura'} - Registrada: {invoice.issueDate || formatDateTime(invoice.createdAt)}
                        </div>
                      </td>
                      <td>
                        <div className="font-medium text-gray-900">{invoice.companyName || invoice.customerName || '-'}</div>
                        <div className="text-xs text-gray-500">
                          {invoice.status === 'paid' && invoice.paidAt ? `Pagada: ${formatDateTime(invoice.paidAt)}` : 'No pagada'}
                        </div>
                      </td>
                      <td>
                        <span className={invoice.status === 'paid' ? 'badge badge-green' : 'badge badge-gray'}>
                          {invoice.status === 'paid' ? 'Pagada' : 'No pagada'}
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
