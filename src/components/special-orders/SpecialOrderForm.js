import React, { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Search, ShoppingCart, Trash2 } from 'lucide-react';
import Modal from '../Modal';
import Input from '../Input';
import Select from '../Select';
import CustomerLookupSection from './CustomerLookupSection';
import { formatCurrency, formatQuantity, getPrimaryProductBarcode, getProductBarcodes } from '../../data/demoData';
import { calculateItemPricing, IVU_MUNICIPAL_RATE, IVU_STATE_RATE, roundMoney } from '../../utils/cartPricing';

const DEFAULT_ITEM_DISCOUNT = { type: 'percentage', value: 0 };

const normalizeItemDiscount = (discount = {}) => ({
  type: discount?.type === 'fixed' ? 'fixed' : 'percentage',
  value: Math.max(0, Number.isFinite(Number(discount?.value)) ? Number(discount.value) : 0)
});

const createEmptyItem = () => ({
  productId: '',
  productSearch: '',
  name: '',
  description: '',
  sku: '',
  quantity: 1,
  unitCost: '',
  unitPrice: '',
  discount: { ...DEFAULT_ITEM_DISCOUNT },
  ivuStateEnabled: true,
  ivuMunicipalEnabled: true
});

function SpecialOrderForm({
  isOpen,
  onClose,
  onSubmit,
  customers,
  products,
  categories,
  onCreateProduct,
  initialData = null,
  title = 'Nuevo pedido especial',
  submitLabel = 'Guardar pedido'
}) {
  const [customer, setCustomer] = useState({
    customerId: '',
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    customerNotes: ''
  });
  const [items, setItems] = useState([createEmptyItem()]);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositMethod, setDepositMethod] = useState('cash');
  const [expectedDate, setExpectedDate] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [errors, setErrors] = useState({});
  const activeProducts = useMemo(
    () => (products || []).filter((product) => product.active !== false),
    [products]
  );
  const activeCategories = useMemo(
    () => (categories || []).filter((category) => category.active !== false),
    [categories]
  );
  const filteredProducts = useMemo(() => {
    const query = itemSearchQuery.trim().toLowerCase();
    return activeProducts.filter((product) => {
      const matchesCategory = selectedCategory === 'all' || product.categoryId === selectedCategory;
      if (!matchesCategory) return false;
      if (!query) return true;
      return [
        product.name,
        product.sku || '',
        ...getProductBarcodes(product),
        product.description || ''
      ].join(' ').toLowerCase().includes(query);
    });
  }, [activeProducts, itemSearchQuery, selectedCategory]);

  const totalAmount = useMemo(
    () => roundMoney(items.reduce((sum, item) => sum + calculateItemPricing(item).total, 0)),
    [items]
  );
  const subtotalAmount = useMemo(
    () => roundMoney(items.reduce((sum, item) => sum + calculateItemPricing(item).subtotal, 0)),
    [items]
  );
  const taxSummary = useMemo(
    () => items.reduce((summary, item) => {
      const pricing = calculateItemPricing(item);
      return {
        state: summary.state + pricing.stateTax,
        municipal: summary.municipal + pricing.municipalTax
      };
    }, { state: 0, municipal: 0 }),
    [items]
  );
  const roundedTaxSummary = useMemo(
    () => ({
      state: roundMoney(taxSummary.state),
      municipal: roundMoney(taxSummary.municipal)
    }),
    [taxSummary]
  );
  const taxAmount = roundMoney(roundedTaxSummary.state + roundedTaxSummary.municipal);
  const discountAmount = useMemo(
    () => roundMoney(items.reduce((sum, item) => sum + calculateItemPricing(item).discountAmount, 0)),
    [items]
  );
  const balanceDue = roundMoney(Math.max(0, totalAmount - Number(depositAmount || 0)));

  useEffect(() => {
    if (!isOpen) return;
    if (!initialData) {
      resetForm();
      return;
    }

    setCustomer({
      customerId: initialData.customerId || '',
      customerName: initialData.customerName || '',
      customerPhone: initialData.customerPhone || '',
      customerEmail: initialData.customerEmail || '',
      customerNotes: initialData.customerNotes || ''
    });
    setItems((initialData.items || []).map((item) => ({
      productId: item.productId || '',
      productSearch: item.name ? `${item.name} (${item.sku || item.productId || ''})` : '',
      name: item.name || '',
      description: item.description || '',
      sku: item.sku || '',
      quantity: item.quantity || 1,
      unitCost: item.unitCost ?? '',
      unitPrice: item.unitPrice ?? '',
      discount: normalizeItemDiscount(item.discount),
      ivuStateEnabled: item.ivuStateEnabled !== false,
      ivuMunicipalEnabled: item.ivuMunicipalEnabled !== false
    })));
    setDepositAmount(String(initialData.depositAmount || 0));
    setDepositMethod(initialData.depositMethod || initialData.payments?.[0]?.method || 'cash');
    setExpectedDate(initialData.expectedDate || '');
    setInternalNotes(initialData.internalNotes || '');
    setItemSearchQuery('');
    setSelectedCategory('all');
    setErrors({});
  }, [initialData, isOpen]);

  const resetForm = () => {
    setCustomer({
      customerId: '',
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      customerNotes: ''
    });
    setItems([createEmptyItem()]);
    setDepositAmount('');
    setDepositMethod('cash');
    setExpectedDate('');
    setInternalNotes('');
    setItemSearchQuery('');
    setSelectedCategory('all');
    setErrors({});
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const updateItem = (index, patch) => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const addManualItem = () => {
    setItems((current) => [...current, createEmptyItem()]);
  };

  const addProductToItems = (product) => {
    if (!product) return;
    setItems((current) => {
      const existingIndex = current.findIndex((item) => item.productId && item.productId === product.id);
      if (existingIndex >= 0) {
        return current.map((item, index) => {
          if (index !== existingIndex) return item;
          return {
            ...item,
            quantity: Math.max(1, Number(item.quantity || 1) + 1)
          };
        });
      }

      return [
        ...current,
        {
          productId: product.id,
          productSearch: `${product.name} (${product.sku || getPrimaryProductBarcode(product) || product.id})`,
          name: product.name || '',
          description: '',
          sku: '',
          quantity: 1,
          unitCost: '',
          unitPrice: product.price ?? '',
          discount: { ...DEFAULT_ITEM_DISCOUNT },
          ivuStateEnabled: product.ivuStateEnabled !== false,
          ivuMunicipalEnabled: product.ivuMunicipalEnabled !== false
        }
      ];
    });
  };

  const updateItemQuantity = (index, delta) => {
    setItems((current) => {
      const nextItems = current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        return {
          ...item,
          quantity: Math.max(1, Number(item.quantity || 1) + delta)
        };
      });

      return nextItems;
    });
  };

  const updateItemDiscount = (index, field, value) => {
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      return {
        ...item,
        discount: normalizeItemDiscount({
          ...item.discount,
          [field]: value
        })
      };
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const nextErrors = {};

    if (!customer.customerName.trim()) nextErrors.customerName = 'El nombre es requerido';
    if (!customer.customerPhone.trim()) nextErrors.customerPhone = 'El teléfono es requerido';

    const normalizedItems = items.map((item) => ({
      ...item,
      quantity: Math.max(1, Number(item.quantity || 1)),
      unitCost: Number(item.unitCost || 0),
      unitPrice: Number(item.unitPrice || 0),
      discount: normalizeItemDiscount(item.discount),
      ivuStateEnabled: item.ivuStateEnabled !== false,
      ivuMunicipalEnabled: item.ivuMunicipalEnabled !== false
    })).filter((item) => item.name.trim());

    if (normalizedItems.length === 0) nextErrors.items = 'Agrega al menos una pieza o producto';
    if (normalizedItems.some((item) => Number(item.unitPrice || 0) <= 0)) {
      nextErrors.items = 'Cada item debe tener un precio de venta mayor que cero';
    }

    const deposit = Number(depositAmount || 0);
    if (deposit < 0) nextErrors.depositAmount = 'El anticipo no puede ser negativo';
    if (deposit > totalAmount) nextErrors.depositAmount = 'El anticipo no puede ser mayor al total';

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    onSubmit({
      customer,
      items: normalizedItems,
      depositAmount: deposit,
      depositMethod,
      expectedDate,
      internalNotes
    });
    resetForm();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} size="xl">
      <form className="space-y-6" onSubmit={handleSubmit}>
        <CustomerLookupSection
          customers={customers}
          value={customer}
          onChange={(patch) => setCustomer((current) => ({ ...current, ...patch }))}
          errors={errors}
        />

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">Piezas o productos solicitados</h3>
              {errors.items && <p className="text-sm text-red-500 mt-1">{errors.items}</p>}
            </div>
            <button
              type="button"
              onClick={addManualItem}
              className="btn btn-secondary flex items-center gap-2"
            >
              <Plus size={16} />
              Item manual
            </button>
          </div>

          <div className="rounded-lg border border-gray-200 p-4 space-y-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search size={18} className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  value={itemSearchQuery}
                  onChange={(e) => setItemSearchQuery(e.target.value)}
                  className="input w-full pl-10"
                  placeholder="Buscar por nombre, SKU o código"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedCategory === 'all'
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Todos
              </button>
              {activeCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategory(category.id)}
                  className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedCategory === category.id
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>

            {filteredProducts.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 max-h-72 overflow-y-auto pr-1">
                {filteredProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addProductToItems(product)}
                    className="rounded-lg border border-gray-200 p-3 text-left hover:border-primary-300 hover:shadow-sm transition-all"
                  >
                    <p className="font-medium text-sm text-gray-900 truncate">{product.name}</p>
                    <p className="text-xs text-gray-500 truncate">{product.sku || getPrimaryProductBarcode(product) || product.id}</p>
                    <p className="text-sm font-semibold text-primary-600 mt-1">{formatCurrency(product.price || 0)}</p>
                    <p className="text-xs text-gray-400">
                      {formatQuantity(Number(product.stock || 0), product.unitType || 'unit')} disponibles
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
                No hay productos que coincidan con la búsqueda.
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-base font-semibold flex items-center gap-2 text-gray-900">
                <ShoppingCart size={18} />
                Carrito del pedido
              </h4>
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={() => setItems([createEmptyItem()])}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Limpiar
                </button>
              )}
            </div>

            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
              {items.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <ShoppingCart size={36} className="mx-auto mb-2" />
                  <p>Carrito vacío</p>
                </div>
              ) : (
                items.map((item, index) => {
                  const pricing = calculateItemPricing(item);
                  return (
                    <div key={`item-${index}`} className="rounded-lg bg-gray-50 p-3 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <input
                            type="text"
                            value={item.name}
                            onChange={(e) => updateItem(index, { name: e.target.value })}
                            className="input w-full"
                            placeholder="Nombre del item"
                          />
                          {item.productId && (
                            <p className="mt-2 text-xs text-gray-500">Producto del catálogo</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                          className="text-red-500 hover:text-red-700 shrink-0"
                          aria-label={`Eliminar item ${index + 1}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitCost}
                          onChange={(e) => updateItem(index, { unitCost: e.target.value })}
                          className="input w-full"
                          placeholder="Costo"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(e) => updateItem(index, { unitPrice: e.target.value })}
                          className="input w-full"
                          placeholder="Precio de venta"
                        />
                        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => updateItemQuantity(index, -1)}
                            className="flex h-7 w-7 items-center justify-center rounded bg-gray-200 hover:bg-gray-300"
                          >
                            <Minus size={14} />
                          </button>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={item.quantity}
                            onChange={(e) => updateItem(index, { quantity: Math.max(1, Number(e.target.value || 1)) })}
                            className="w-16 text-center bg-transparent outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => updateItemQuantity(index, 1)}
                            className="flex h-7 w-7 items-center justify-center rounded bg-gray-200 hover:bg-gray-300"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="flex min-w-0 items-center gap-2">
                        <select
                          value={item.discount?.type || DEFAULT_ITEM_DISCOUNT.type}
                          onChange={(e) => updateItemDiscount(index, 'type', e.target.value)}
                          className="input w-16 shrink-0 text-sm"
                        >
                          <option value="percentage">%</option>
                          <option value="fixed">$</option>
                        </select>
                        <input
                          type="number"
                          value={item.discount?.value ?? 0}
                          onChange={(e) => updateItemDiscount(index, 'value', e.target.value)}
                          placeholder="Descuento por producto"
                          className="input min-w-0 flex-1"
                          min="0"
                          step="0.01"
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700">
                          <input
                            type="checkbox"
                            checked={item.ivuStateEnabled !== false}
                            onChange={(e) => updateItem(index, { ivuStateEnabled: e.target.checked })}
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <span>{`${(IVU_STATE_RATE * 100).toFixed(1)}% IVU estatal`}</span>
                        </label>
                        <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700">
                          <input
                            type="checkbox"
                            checked={item.ivuMunicipalEnabled !== false}
                            onChange={(e) => updateItem(index, { ivuMunicipalEnabled: e.target.checked })}
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <span>{`${(IVU_MUNICIPAL_RATE * 100).toFixed(0)}% IVU municipal`}</span>
                        </label>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                        <div className="rounded-lg bg-white px-3 py-2 border border-gray-200">
                          <p className="text-xs text-gray-500">Subtotal</p>
                          <p className="font-semibold text-gray-900">{formatCurrency(pricing.subtotal)}</p>
                        </div>
                        <div className="rounded-lg bg-white px-3 py-2 border border-gray-200">
                          <p className="text-xs text-gray-500">Descuento</p>
                          <p className="font-semibold text-green-600">-{formatCurrency(pricing.discountAmount)}</p>
                        </div>
                        <div className="rounded-lg bg-white px-3 py-2 border border-gray-200">
                          <p className="text-xs text-gray-500">Total</p>
                          <p className="font-semibold text-gray-900">{formatCurrency(pricing.total)}</p>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => onCreateProduct({
                            name: item.name || '',
                            sku: item.sku || '',
                            barcode: '',
                            categoryId: categories?.[0]?.id || '',
                            cost: item.unitCost || 0,
                            price: item.unitPrice || 0,
                            stock: 0,
                            description: item.description || '',
                            ivuStateEnabled: item.ivuStateEnabled !== false,
                            ivuMunicipalEnabled: item.ivuMunicipalEnabled !== false
                          })}
                        >
                          Crear como producto nuevo
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Anticipo inicial"
            type="number"
            min="0"
            step="0.01"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            error={errors.depositAmount}
          />
          <Select
            label="Método del anticipo"
            value={depositMethod}
            onChange={(e) => setDepositMethod(e.target.value)}
            options={[
              { value: 'cash', label: 'Efectivo' },
              { value: 'card', label: 'Tarjeta' },
              { value: 'ath_movil', label: 'ATH Móvil' }
            ]}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Fecha estimada"
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
          />
        </div>

        <Input
          label="Notas internas"
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          placeholder="Notas para seguimiento, suplidor, condiciones, etc."
        />

        <div className="rounded-lg bg-gray-50 p-4 space-y-2">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <strong>{formatCurrency(subtotalAmount)}</strong>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Descuento</span>
              <strong>-{formatCurrency(discountAmount)}</strong>
            </div>
          )}
          <div className="flex justify-between">
            <span>IVU estatal</span>
            <strong>{formatCurrency(roundedTaxSummary.state)}</strong>
          </div>
          <div className="flex justify-between">
            <span>IVU municipal</span>
            <strong>{formatCurrency(roundedTaxSummary.municipal)}</strong>
          </div>
          <div className="flex justify-between">
            <span>IVU total</span>
            <strong>{formatCurrency(taxAmount)}</strong>
          </div>
          <div className="flex justify-between text-base text-gray-900">
            <span>Total del pedido</span>
            <strong>{formatCurrency(totalAmount)}</strong>
          </div>
          <div className="flex justify-between">
            <span>Anticipo</span>
            <strong>{formatCurrency(Number(depositAmount || 0))}</strong>
          </div>
          <div className="flex justify-between">
            <span>Balance pendiente</span>
            <strong className="text-amber-600">{formatCurrency(balanceDue)}</strong>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-secondary" onClick={handleClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default SpecialOrderForm;
