import React, { useMemo, useState } from 'react';
import Modal from '../Modal';
import Input from '../Input';
import Select from '../Select';
import { formatCurrency } from '../../data/demoData';

const PAYMENT_METHOD_OPTIONS = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'card', label: 'Tarjeta' },
  { value: 'ath_movil', label: 'ATH Movil' }
];

const CARD_PAYMENT_MODES = {
  terminal: 'terminal',
  manual: 'manual'
};

function RegisterSpecialOrderPaymentModal({
  isOpen,
  onClose,
  onSubmit,
  order,
  mode = 'payment',
  spinConfiguration = null,
  spinConfigurationMessage = ''
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [cardMode, setCardMode] = useState(CARD_PAYMENT_MODES.terminal);
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
    setCardMode(CARD_PAYMENT_MODES.terminal);
    setReference('');
    setNotes('');
    setError('');
    onClose();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const normalizedAmount = Number(amount || 0);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      setError('Ingresa un monto valido');
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
      cardMode,
      reference,
      notes
    });
    handleClose();
  };

  const isCardPayment = method === 'card' && mode !== 'refund';

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
              <span>{mode === 'refund' ? 'Maximo a reembolsar' : 'Balance pendiente'}</span>
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
            label="Metodo de pago"
            value={method}
            onChange={(e) => {
              const nextMethod = e.target.value;
              setMethod(nextMethod);
              if (nextMethod !== 'card') {
                setCardMode(CARD_PAYMENT_MODES.terminal);
              }
            }}
            options={PAYMENT_METHOD_OPTIONS}
          />

          {isCardPayment && (
            <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div>
                <p className="font-medium text-blue-800">Modo de cobro con tarjeta</p>
                <p className="text-sm text-blue-700">Escoge si quieres enviar el cobro a la terminal o registrarlo manualmente.</p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setCardMode(CARD_PAYMENT_MODES.terminal)}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    cardMode === CARD_PAYMENT_MODES.terminal
                      ? 'border-blue-500 bg-blue-100'
                      : 'border-gray-200 bg-white hover:border-blue-300'
                  }`}
                >
                  <p className="font-medium text-gray-900">Pagar por terminal</p>
                  <p className="text-sm text-gray-600">Usa SPIn para cobrar la tarjeta de verdad.</p>
                </button>

                <button
                  type="button"
                  onClick={() => setCardMode(CARD_PAYMENT_MODES.manual)}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    cardMode === CARD_PAYMENT_MODES.manual
                      ? 'border-blue-500 bg-blue-100'
                      : 'border-gray-200 bg-white hover:border-blue-300'
                  }`}
                >
                  <p className="font-medium text-gray-900">Pagar manual</p>
                  <p className="text-sm text-gray-600">Guarda la transaccion sin enviarla a la terminal.</p>
                </button>
              </div>

              {cardMode === CARD_PAYMENT_MODES.terminal && (
                <div className={`rounded-lg border p-3 text-sm ${
                  spinConfiguration?.isConfigured
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}>
                  {spinConfigurationMessage || 'Verifica la configuracion de SPIn antes de cobrar.'}
                </div>
              )}
            </div>
          )}

          <Input
            label={
              isCardPayment
                ? cardMode === CARD_PAYMENT_MODES.terminal
                  ? 'Referencia de la terminal'
                  : 'Referencia manual'
                : 'Referencia'
            }
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={
              isCardPayment
                ? cardMode === CARD_PAYMENT_MODES.terminal
                  ? 'Codigo de aprobacion o ultimos 4 digitos'
                  : 'Voucher, autorizacion o ultimos 4 digitos'
                : 'Codigo de aprobacion, nota o referencia'
            }
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
              {mode === 'refund'
                ? 'Confirmar reembolso'
                : isCardPayment && cardMode === CARD_PAYMENT_MODES.terminal
                  ? 'Cobrar en terminal'
                  : isCardPayment && cardMode === CARD_PAYMENT_MODES.manual
                    ? 'Confirmar pago manual'
                    : 'Registrar pago'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default RegisterSpecialOrderPaymentModal;
