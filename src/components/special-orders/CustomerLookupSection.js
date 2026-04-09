import React, { useMemo, useState } from 'react';
import Input from '../Input';

function CustomerLookupSection({
  customers,
  value,
  onChange,
  errors = {}
}) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCustomers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return customers.slice(0, 8);
    return customers.filter((customer) =>
      customer.name.toLowerCase().includes(query) ||
      customer.phone.toLowerCase().includes(query) ||
      (customer.email || '').toLowerCase().includes(query)
    ).slice(0, 8);
  }, [customers, searchQuery]);

  const selectedExistingId = value.customerId || '';

  const handleSelectExisting = (customer) => {
    onChange({
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerEmail: customer.email || '',
      customerNotes: customer.notes || ''
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 p-4 bg-gray-50">
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="font-medium text-gray-900">Cliente</p>
          {selectedExistingId && (
            <button
              type="button"
              className="text-sm text-primary-600 hover:text-primary-700"
              onClick={() => onChange({
                customerId: '',
                customerName: value.customerName,
                customerPhone: value.customerPhone,
                customerEmail: value.customerEmail,
                customerNotes: value.customerNotes
              })}
            >
              Quitar selección
            </button>
          )}
        </div>

        <Input
          label="Buscar cliente existente"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Nombre, teléfono o email"
        />

        {filteredCustomers.length > 0 && (
          <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-lg bg-white">
            {filteredCustomers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                className={`w-full px-4 py-3 text-left border-b last:border-b-0 hover:bg-gray-50 ${
                  selectedExistingId === customer.id ? 'bg-primary-50' : ''
                }`}
                onClick={() => handleSelectExisting(customer)}
              >
                <div className="font-medium text-gray-900">{customer.name}</div>
                <div className="text-sm text-gray-500">{customer.phone}</div>
                {customer.email && <div className="text-xs text-gray-400">{customer.email}</div>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Nombre del cliente"
          value={value.customerName}
          onChange={(e) => onChange({ customerName: e.target.value })}
          required
          error={errors.customerName}
        />
        <Input
          label="Teléfono"
          value={value.customerPhone}
          onChange={(e) => onChange({ customerPhone: e.target.value })}
          required
          error={errors.customerPhone}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Correo electrónico"
          type="email"
          value={value.customerEmail}
          onChange={(e) => onChange({ customerEmail: e.target.value })}
        />
        <Input
          label="Notas del cliente"
          value={value.customerNotes}
          onChange={(e) => onChange({ customerNotes: e.target.value })}
          placeholder="Observaciones opcionales"
        />
      </div>
    </div>
  );
}

export default CustomerLookupSection;
