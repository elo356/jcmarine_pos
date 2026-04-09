import React, { useMemo, useState } from 'react';
import Modal from '../Modal';
import Input from '../Input';
import Select from '../Select';
import { formatCurrency } from '../../data/demoData';

const PAYMENT_METHOD_OPTIONS = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'card', label: 'Tarjeta' },
  { value: 'ath_movil', label: 'ATH Móvil' }
];

function RegisterSpecialOrderPaymentModal({
  isOpen,
  onClose,
  onSubmit,
  order,
  mode = 'payment'
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const maxAmount = useMemo(() => {
    if (!order) return 0;
    return mode === 'refund' ? Number(order.amountPaid || 0) : Number(order.balanceDue || 0);
  }, [order, mode]);

  const handleClose = () => {
    setAmount('');
    setMethod('cash');
    setReference('');
    setNotes('');
    setError('');
    onClose();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const normalizedAmount = Number(amount || 0);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      setError('Ingresa un monto válido');
      return;
    }
    if (normalizedAmount > maxAmount) {
      setError(mode === 'refund'
        ? 'El reembolso no puede exceder lo cobrado'
        : 'El pago no puede exceder el balance pendiente');
      return;
    }

    onSubmit({
      amount: normalizedAmount,
      method,
      reference,
      notes
    });
    handleClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={mode === 'refund' ? 'Registrar reembolso' : 'Registrar pago'}
      size="md"
    >
      {order && (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="rounded-lg bg-gray-50 p-4 space-y-2">
            <div className="flex justify-between">
              <span>Pedido</span>
              <strong>{order.orderNumber}</strong>
            </div>
            <div className="flex justify-between">
              <span>{mode === 'refund' ? 'Máximo a reembolsar' : 'Balance pendiente'}</span>
              <strong>{formatCurrency(maxAmount)}</strong>
            </div>
          </div>

          <Input
            label={mode === 'refund' ? 'Monto a reembolsar' : 'Monto a cobrar'}
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={error}
          />

          <Select
            label="Método de pago"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            options={PAYMENT_METHOD_OPTIONS}
          />

          <Input
            label="Referencia"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Código de aprobación, nota o referencia"
          />

          <Input
            label="Notas"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observaciones opcionales"
          />

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              Cancelar
            </button>
            <button type="submit" className={`btn ${mode === 'refund' ? 'btn-secondary' : 'btn-primary'}`}>
              {mode === 'refund' ? 'Confirmar reembolso' : 'Registrar pago'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default RegisterSpecialOrderPaymentModal;
