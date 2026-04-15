import React, { useEffect, useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import Modal from '../Modal';
import Input from '../Input';
import Select from '../Select';
import CustomerLookupSection from './CustomerLookupSection';
import { formatCurrency, getPrimaryProductBarcode, getProductBarcodes } from '../../data/demoData';
import { calculateItemPricing, IVU_MUNICIPAL_RATE, IVU_STATE_RATE, roundMoney } from '../../utils/cartPricing';

const createEmptyItem = () => ({
  productId: '',
  productSearch: '',
  name: '',
  description: '',
  sku: '',
  quantity: 1,
  unitCost: '',
  unitPrice: '',
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
  const [errors, setErrors] = useState({});
  const activeProducts = useMemo(
    () => (products || []).filter((product) => product.active !== false),
    [products]
  );

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
      ivuStateEnabled: item.ivuStateEnabled !== false,
      ivuMunicipalEnabled: item.ivuMunicipalEnabled !== false
    })));
    setDepositAmount(String(initialData.depositAmount || 0));
    setDepositMethod(initialData.depositMethod || initialData.payments?.[0]?.method || 'cash');
    setExpectedDate(initialData.expectedDate || '');
    setInternalNotes(initialData.internalNotes || '');
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
    setErrors({});
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const updateItem = (index, patch) => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const handleSelectProduct = (index, productId) => {
    const product = activeProducts.find((entry) => entry.id === productId);
    updateItem(index, {
      productId,
      productSearch: product ? `${product.name} (${product.sku || getPrimaryProductBarcode(product) || product.id})` : '',
      name: product?.name || '',
      description: product?.description || '',
      sku: product?.sku || getPrimaryProductBarcode(product) || '',
      unitCost: product?.cost ?? '',
      unitPrice: product?.price ?? '',
      ivuStateEnabled: product?.ivuStateEnabled !== false,
      ivuMunicipalEnabled: product?.ivuMunicipalEnabled !== false
    });
  };

  const filteredProductsForItem = (item) => {
    const query = (item.productSearch || '').trim().toLowerCase();
    if (!query) return activeProducts.slice(0, 8);
    return activeProducts.filter((product) =>
      [
        product.name,
        product.sku || '',
        ...getProductBarcodes(product),
        product.description || ''
      ].join(' ').toLowerCase().includes(query)
    ).slice(0, 8);
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
              onClick={() => setItems((current) => [...current, createEmptyItem()])}
              className="btn btn-secondary flex items-center gap-2"
            >
              <Plus size={16} />
              Agregar item
            </button>
          </div>

          {items.map((item, index) => (
            <div key={`item-${index}`} className="rounded-lg border border-gray-200 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="font-medium text-gray-900">Item {index + 1}</p>
                {items.length > 1 && (
                  <button
                    type="button"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <Minus size={16} />
                  </button>
                )}
              </div>

              <Select
                label="Producto del catálogo (opcional)"
                value={item.productId}
                onChange={(e) => handleSelectProduct(index, e.target.value)}
                options={activeProducts.map((product) => ({
                  value: product.id,
                  label: `${product.name} (${product.sku || getPrimaryProductBarcode(product) || product.id})`
                }))}
              />

              <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                <Input
                  label="Buscar producto registrado"
                  value={item.productSearch || ''}
                  onChange={(e) => updateItem(index, { productSearch: e.target.value })}
                  placeholder="Escribe nombre, SKU o código"
                />

                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg bg-white">
                  {filteredProductsForItem(item).length > 0 ? filteredProductsForItem(item).map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className="w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-gray-50"
                      onClick={() => handleSelectProduct(index, product.id)}
                    >
                      <div className="font-medium text-gray-900">{product.name}</div>
                      <div className="text-xs text-gray-500">
                        {product.sku || getPrimaryProductBarcode(product) || product.id} · {formatCurrency(product.price || 0)}
                      </div>
                    </button>
                  )) : (
                    <div className="px-4 py-4 text-sm text-gray-500">
                      No hay productos que coincidan con la búsqueda.
                    </div>
                  )}
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Nombre de la pieza"
                  value={item.name}
                  onChange={(e) => updateItem(index, { name: e.target.value })}
                  required
                />
                <Input
                  label="SKU / código"
                  value={item.sku}
                  onChange={(e) => updateItem(index, { sku: e.target.value })}
                />
              </div>

              <Input
                label="Descripción"
                value={item.description}
                onChange={(e) => updateItem(index, { description: e.target.value })}
                placeholder="Detalles relevantes de la pieza"
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  label="Cantidad"
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(e) => updateItem(index, { quantity: e.target.value })}
                />
                <Input
                  label="Costo"
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unitCost}
                  onChange={(e) => updateItem(index, { unitCost: e.target.value })}
                />
                <Input
                  label="Precio de venta"
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(index, { unitPrice: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">IVU del item</p>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item.ivuStateEnabled !== false}
                      onChange={(e) => updateItem(index, { ivuStateEnabled: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span>{`${(IVU_STATE_RATE * 100).toFixed(1)}% IVU estatal`}</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item.ivuMunicipalEnabled !== false}
                      onChange={(e) => updateItem(index, { ivuMunicipalEnabled: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span>{`${(IVU_MUNICIPAL_RATE * 100).toFixed(0)}% IVU municipal`}</span>
                  </label>
                </div>

                <div className="text-sm text-gray-600 space-y-1">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <strong>{formatCurrency(calculateItemPricing(item).subtotal)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>IVU</span>
                    <strong>{formatCurrency(calculateItemPricing(item).totalTax)}</strong>
                  </div>
                  <div className="flex justify-between text-base text-gray-900">
                    <span>Total</span>
                    <strong>{formatCurrency(calculateItemPricing(item).total)}</strong>
                  </div>
                </div>
              </div>
            </div>
          ))}
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
