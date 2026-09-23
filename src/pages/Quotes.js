import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Eye, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { formatCurrency, formatDate, loadData } from '../data/demoData';
import Modal from '../components/Modal';
import Notification from '../components/Notification';
import SpecialOrderForm from '../components/special-orders/SpecialOrderForm';
import { useAuth } from '../contexts/AuthContext';
import { subscribeCategories } from '../services/categoryService';
import { saveCustomer, subscribeCustomers } from '../services/customersService';
import { subscribeProducts } from '../services/inventoryService';
import { deleteQuote, saveQuote, subscribeQuotes } from '../services/quotesService';
import { saveSpecialOrder } from '../services/specialOrdersService';
import { buildSpecialOrderFromQuote, normalizeQuote } from '../utils/quoteUtils';

const getCurrentUserIdentity = (user, profile) => ({
  name: profile?.name || user?.email || 'Sistema',
  id: user?.uid || 'system'
});

function Quotes({ onCreateProductRequested = () => {} }) {
  const { user, profile } = useAuth();
  const [quotes, setQuotes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [notification, setNotification] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingQuote, setEditingQuote] = useState(null);
  const [quoteToDelete, setQuoteToDelete] = useState(null);
  const [quoteToConvert, setQuoteToConvert] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const data = loadData();
    setCustomers(data.customers || []);
    setProducts(data.products || []);
    setCategories(data.categories || []);

    const unsubQuotes = subscribeQuotes(
      (rows) => setQuotes(rows),
      (error) => console.error('Error subscribing quotes:', error)
    );
    const unsubCustomers = subscribeCustomers(
      (rows) => { if (rows.length > 0) setCustomers(rows); },
      (error) => console.error('Error subscribing customers in quotes:', error)
    );
    const unsubProducts = subscribeProducts(
      (rows) => { if (rows.length > 0) setProducts(rows); },
      (error) => console.error('Error subscribing products in quotes:', error)
    );
    const unsubCategories = subscribeCategories(
      (rows) => { if (rows.length > 0) setCategories(rows.filter((entry) => entry.active !== false)); },
      (error) => console.error('Error subscribing categories in quotes:', error)
    );

    return () => {
      unsubQuotes();
      unsubCustomers();
      unsubProducts();
      unsubCategories();
    };
  }, []);

  const showNotification = (type, message) => {
    setNotification({ id: Date.now(), type, message });
  };

  const filteredQuotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return quotes;
    return quotes.filter((quote) => [
      quote.quoteNumber,
      quote.customerName,
      quote.customerPhone,
      ...quote.items.map((item) => `${item.name} ${item.sku} ${item.description}`)
    ].join(' ').toLowerCase().includes(query));
  }, [quotes, searchQuery]);

  const createOrReuseCustomer = async (customerPayload) => {
    const existing = customers.find((customer) =>
      customer.phone.trim() === customerPayload.customerPhone.trim() &&
      customer.name.trim().toLowerCase() === customerPayload.customerName.trim().toLowerCase()
    );

    const nextCustomer = {
      id: existing?.id,
      name: customerPayload.customerName.trim(),
      phone: customerPayload.customerPhone.trim(),
      email: customerPayload.customerEmail.trim(),
      notes: customerPayload.customerNotes.trim(),
      active: true,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return saveCustomer(nextCustomer);
  };

  const handleCreateProduct = (productData) => {
    onCreateProductRequested({
      productTemplate: {
        sku: productData.sku || '',
        name: productData.name || '',
        barcode: productData.barcode || '',
        categoryId: productData.categoryId || categories?.[0]?.id || '',
        price: Number(productData.price || 0),
        cost: Number(productData.cost || 0),
        stock: Number(productData.stock || 0),
        lowStockThreshold: 0,
        description: productData.description || '',
        ivuStateEnabled: productData.ivuStateEnabled !== false,
        ivuMunicipalEnabled: productData.ivuMunicipalEnabled !== false
      }
    });
  };

  const handleCreateQuote = async ({ customer, items, expectedDate, internalNotes }) => {
    const currentUser = getCurrentUserIdentity(user, profile);
    try {
      const savedCustomer = await createOrReuseCustomer(customer);
      const newQuote = normalizeQuote({
        customerId: savedCustomer.id,
        customerName: savedCustomer.name,
        customerPhone: savedCustomer.phone,
        customerEmail: savedCustomer.email,
        items,
        expectedDate,
        internalNotes,
        createdBy: currentUser.name,
        createdById: currentUser.id,
        updatedBy: currentUser.name,
        updatedById: currentUser.id
      });
      await saveQuote(newQuote);
      showNotification('success', 'Cotización guardada correctamente.');
      setShowCreateModal(false);
    } catch (error) {
      console.error('Error creating quote:', error);
      showNotification('error', 'No se pudo guardar la cotización.');
    }
  };

  const handleUpdateQuote = async ({ customer, items, expectedDate, internalNotes }) => {
    if (!editingQuote) return;
    const currentUser = getCurrentUserIdentity(user, profile);
    try {
      const savedCustomer = await createOrReuseCustomer(customer);
      const updatedQuote = normalizeQuote({
        ...editingQuote,
        customerId: savedCustomer.id,
        customerName: savedCustomer.name,
        customerPhone: savedCustomer.phone,
        customerEmail: savedCustomer.email,
        items,
        expectedDate,
        internalNotes,
        updatedBy: currentUser.name,
        updatedById: currentUser.id,
        updatedAt: new Date().toISOString()
      });
      await saveQuote(updatedQuote);
      showNotification('success', 'Cotización actualizada correctamente.');
      setEditingQuote(null);
    } catch (error) {
      console.error('Error updating quote:', error);
      showNotification('error', 'No se pudo actualizar la cotización.');
    }
  };

  const handleConfirmConvert = async () => {
    if (!quoteToConvert) return;
    const currentUser = getCurrentUserIdentity(user, profile);
    setIsProcessing(true);
    try {
      const newOrder = buildSpecialOrderFromQuote(quoteToConvert, {
        performedBy: currentUser.name,
        performedById: currentUser.id
      });
      await saveSpecialOrder(newOrder);
      await deleteQuote(quoteToConvert.id);
      showNotification('success', 'Cotización movida a Pedidos especiales.');
      setQuoteToConvert(null);
    } catch (error) {
      console.error('Error converting quote to special order:', error);
      showNotification('error', 'No se pudo mover la cotización a Pedidos especiales.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!quoteToDelete) return;
    setIsProcessing(true);
    try {
      await deleteQuote(quoteToDelete.id);
      showNotification('success', 'Cotización eliminada.');
      setQuoteToDelete(null);
    } catch (error) {
      console.error('Error deleting quote:', error);
      showNotification('error', 'No se pudo eliminar la cotización.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {notification && (
        <Notification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cotización</h1>
          <p className="text-sm text-gray-500">
            Guarda precios para un cliente sin comprometerte a un pedido. Si el cliente acepta, muévela a Pedidos especiales.
          </p>
        </div>
        <button type="button" className="btn btn-primary flex items-center gap-2" onClick={() => setShowCreateModal(true)}>
          <Plus size={18} />
          Nueva cotización
        </button>
      </div>

      <div className="card p-4">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input w-full md:w-80"
          placeholder="Buscar por cliente, número o producto"
        />
      </div>

      <div className="card overflow-hidden">
        {filteredQuotes.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Cotización</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Fecha</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredQuotes.map((quote) => (
                  <tr key={quote.id} className="hover:bg-gray-50">
                    <td>
                      <div className="font-medium">{quote.quoteNumber}</div>
                      <div className="text-xs text-gray-500">{formatDate(quote.createdAt)}</div>
                    </td>
                    <td>
                      <div className="font-medium">{quote.customerName || 'Sin cliente'}</div>
                      <div className="text-xs text-gray-500">{quote.customerPhone}</div>
                    </td>
                    <td className="font-medium">{formatCurrency(quote.totalAmount)}</td>
                    <td>{quote.expectedDate ? formatDate(quote.expectedDate) : '-'}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm flex items-center gap-1"
                          onClick={() => setEditingQuote(quote)}
                          title="Ver / editar cotización"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm flex items-center gap-1"
                          onClick={() => setQuoteToConvert(quote)}
                        >
                          <ShoppingCart size={16} />
                          Mover a Pedidos especiales
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm flex items-center gap-1"
                          onClick={() => setQuoteToDelete(quote)}
                        >
                          <Trash2 size={16} />
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-16 text-center text-gray-400">
            <ClipboardList size={48} className="mx-auto mb-3" />
            <p>No hay cotizaciones guardadas.</p>
          </div>
        )}
      </div>

      <SpecialOrderForm
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateQuote}
        customers={customers}
        products={products}
        categories={categories}
        onCreateProduct={handleCreateProduct}
        title="Nueva cotización"
        submitLabel="Guardar cotización"
        hideDeposit
      />

      <SpecialOrderForm
        isOpen={Boolean(editingQuote)}
        onClose={() => setEditingQuote(null)}
        onSubmit={handleUpdateQuote}
        customers={customers}
        products={products}
        categories={categories}
        onCreateProduct={handleCreateProduct}
        initialData={editingQuote}
        title={editingQuote ? `Editar cotización ${editingQuote.quoteNumber}` : 'Editar cotización'}
        submitLabel="Guardar cambios"
        hideDeposit
      />

      <Modal
        isOpen={Boolean(quoteToConvert)}
        onClose={() => setQuoteToConvert(null)}
        title="Mover a Pedidos especiales"
        size="sm"
      >
        {quoteToConvert && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              La cotización <strong>{quoteToConvert.quoteNumber}</strong> se convertirá en un pedido especial
              nuevo por {formatCurrency(quoteToConvert.totalAmount)} y desaparecerá de Cotización.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setQuoteToConvert(null)} disabled={isProcessing}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={handleConfirmConvert} disabled={isProcessing}>
                Confirmar
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(quoteToDelete)}
        onClose={() => setQuoteToDelete(null)}
        title="Eliminar cotización"
        size="sm"
      >
        {quoteToDelete && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              ¿Eliminar la cotización <strong>{quoteToDelete.quoteNumber}</strong> de {quoteToDelete.customerName || 'sin cliente'}? Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setQuoteToDelete(null)} disabled={isProcessing}>
                Cancelar
              </button>
              <button type="button" className="btn btn-danger" onClick={handleConfirmDelete} disabled={isProcessing}>
                Eliminar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default Quotes;
