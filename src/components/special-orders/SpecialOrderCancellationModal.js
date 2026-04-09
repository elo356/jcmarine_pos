import React, { useState } from 'react';
import Modal from '../Modal';
import Input from '../Input';
import { formatCurrency } from '../../data/demoData';

function SpecialOrderCancellationModal({
  isOpen,
  onClose,
  onSubmit,
  order
}) {
  const [reason, setReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [error, setError] = useState('');

  const handleClose = () => {
    setReason('');
    setRefundAmount('');
    setError('');
    onClose();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Indica una razón de cancelación');
      return;
    }
    const normalizedRefund = Number(refundAmount || 0);
    if (normalizedRefund < 0 || normalizedRefund > Number(order?.amountPaid || 0)) {
      setError('El reembolso no puede exceder lo cobrado');
      return;
    }
    onSubmit({
      reason,
      refundAmount: normalizedRefund
    });
    handleClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Cancelar pedido" size="md">
      {order && (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
            Este pedido quedará cancelado. Si el negocio lo permite, puedes registrar un reembolso parcial o total del anticipo.
          </div>

          <div className="rounded-lg bg-gray-50 p-4 space-y-2">
            <div className="flex justify-between">
              <span>Total cobrado</span>
              <strong>{formatCurrency(Number(order.amountPaid || 0))}</strong>
            </div>
            <div className="flex justify-between">
              <span>Balance pendiente</span>
              <strong>{formatCurrency(Number(order.balanceDue || 0))}</strong>
            </div>
          </div>

          <Input
            label="Razón de cancelación"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={error}
          />

          <Input
            label="Monto a reembolsar"
            type="number"
            min="0"
            step="0.01"
            value={refundAmount}
            onChange={(e) => setRefundAmount(e.target.value)}
            placeholder="0.00"
          />

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              Volver
            </button>
            <button type="submit" className="btn btn-primary">
              Confirmar cancelación
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default SpecialOrderCancellationModal;
