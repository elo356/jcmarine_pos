import React, { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  Download,
  Search,
  TrendingUp,
  TrendingDown,
  Scale,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  X
} from 'lucide-react';
import { formatQuantity } from '../data/demoData';
import Select from '../components/Select';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { subscribeInventoryLogsInRange } from '../services/inventoryService';
import { INVENTORY_MOVEMENT_LABELS } from '../utils/inventoryLogUtils';

const PAGE_SIZE = 25;
const IN_TYPES = ['refund', 'adjustment_in', 'special_order_revert'];
const OUT_TYPES = ['sale', 'adjustment_out', 'special_order_delivery'];

const formatDateInputValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const parseLocalDate = (value, endOfDay = false) => {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
};

const formatDateTime = (isoDate) => {
  const date = new Date(isoDate);
  return {
    date: date.toLocaleDateString('es-ES'),
    time: date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };
};

// El signo real de "quantity" solo es confiable para reconciliacion (se guarda ya con
// signo); el resto de movimientos guardan la magnitud sin signo, asi que el sentido
// (entrada/salida) depende del tipo de movimiento.
const getSignedQuantity = (log) => {
  const magnitude = Number(log.quantity || 0);
  if (log.type === 'reconciliation') return magnitude;
  if (OUT_TYPES.includes(log.type)) return -Math.abs(magnitude);
  return Math.abs(magnitude);
};

const escapeCsvValue = (value) => {
  const stringValue = String(value ?? '');
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const buildLogsCsv = (rows) => {
  const headers = [
    'Fecha',
    'Hora',
    'Tipo',
    'Producto',
    'Cantidad',
    'Stock antes',
    'Stock despues',
    'Motivo',
    'Referencia',
    'Usuario'
  ];

  const lines = rows.map((log) => {
    const { date, time } = formatDateTime(log.date);
    return [
      date,
      time,
      INVENTORY_MOVEMENT_LABELS[log.type] || log.type,
      log.productName || log.productId || '',
      getSignedQuantity(log),
      log.oldStock ?? '',
      log.newStock ?? '',
      log.reason || '',
      log.reference || '',
      log.performedBy || ''
    ].map(escapeCsvValue).join(',');
  });

  return [headers.join(','), ...lines].join('\r\n');
};

const TYPE_BADGE_CLASS = {
  sale: 'badge-red',
  refund: 'badge-green',
  adjustment_in: 'badge-green',
  adjustment_out: 'badge-yellow',
  special_order_delivery: 'badge-red',
  special_order_revert: 'badge-green',
  reconciliation: 'badge-blue'
};

const QUICK_RANGES = [
  { id: 'today', label: 'Hoy', getRange: () => { const d = formatDateInputValue(new Date()); return [d, d]; } },
  { id: 'yesterday', label: 'Ayer', getRange: () => { const d = formatDateInputValue(addDays(new Date(), -1)); return [d, d]; } },
  { id: '7d', label: 'Ultimos 7 dias', getRange: () => [formatDateInputValue(addDays(new Date(), -6)), formatDateInputValue(new Date())] },
  { id: '30d', label: 'Ultimos 30 dias', getRange: () => [formatDateInputValue(addDays(new Date(), -29)), formatDateInputValue(new Date())] },
  {
    id: 'month',
    label: 'Este mes',
    getRange: () => {
      const now = new Date();
      return [formatDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)), formatDateInputValue(now)];
    }
  }
];

const Logs = () => {
  const today = formatDateInputValue(new Date());
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const debouncedSearch = useDebouncedValue(searchTerm, 250);

  const rangeIsValid = Boolean(fromDate && toDate && fromDate <= toDate);

  useEffect(() => {
    if (!rangeIsValid) {
      setLogs([]);
      setLoading(false);
      return undefined;
    }

    const startDate = parseLocalDate(fromDate, false);
    const endDate = parseLocalDate(toDate, true);

    setLoading(true);
    setError(null);
    const unsubscribe = subscribeInventoryLogsInRange(
      startDate.toISOString(),
      endDate.toISOString(),
      (rows) => {
        setLogs(rows);
        setLoading(false);
      },
      (err) => {
        console.error('Error subscribing to inventory logs:', err);
        setError('No se pudo cargar la bitacora. Verifica tu conexion e intenta de nuevo.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [fromDate, toDate, rangeIsValid]);

  useEffect(() => {
    setCurrentPage(1);
  }, [fromDate, toDate, typeFilter, debouncedSearch]);

  const filteredLogs = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    return logs.filter((log) => {
      const matchesType = typeFilter === 'all' || log.type === typeFilter;
      const matchesSearch = !query || [log.productName, log.productId, log.reason, log.performedBy, log.reference]
        .some((field) => String(field || '').toLowerCase().includes(query));
      return matchesType && matchesSearch;
    });
  }, [logs, typeFilter, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredLogs.slice(start, start + PAGE_SIZE);
  }, [filteredLogs, currentPage]);

  const handleExportCsv = () => {
    const csv = buildLogsCsv(filteredLogs);
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fromDate === toDate
      ? `bitacora-inventario-${fromDate}.csv`
      : `bitacora-inventario-${fromDate}_a_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summary = useMemo(() => {
    const unitsIn = logs.filter((l) => IN_TYPES.includes(l.type)).reduce((sum, l) => sum + Math.abs(Number(l.quantity || 0)), 0);
    const unitsOut = logs.filter((l) => OUT_TYPES.includes(l.type)).reduce((sum, l) => sum + Math.abs(Number(l.quantity || 0)), 0);
    const netChange = logs.reduce((sum, l) => sum + getSignedQuantity(l), 0);
    const reconciliations = logs.filter((l) => l.type === 'reconciliation').length;
    return { total: logs.length, unitsIn, unitsOut, netChange, reconciliations };
  }, [logs]);

  const activeQuickRange = QUICK_RANGES.find((r) => {
    const [rangeFrom, rangeTo] = r.getRange();
    return rangeFrom === fromDate && rangeTo === toDate;
  })?.id;

  const applyQuickRange = (range) => {
    const [rangeFrom, rangeTo] = range.getRange();
    setFromDate(rangeFrom);
    setToDate(rangeTo);
  };

  const hasActiveFilters = typeFilter !== 'all' || searchTerm.trim() !== '';
  const clearFilters = () => {
    setTypeFilter('all');
    setSearchTerm('');
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <ClipboardList className="text-primary-600" size={28} />
          <div>
            <h1 className="page-title">Bitacora de Inventario</h1>
            <p className="text-sm text-gray-600">
              Historial de movimientos de stock: ventas, reembolsos, ajustes manuales, pedidos especiales
              y correcciones. Usala para auditar el inventario contra el conteo fisico.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={filteredLogs.length === 0}
          className="btn btn-secondary flex items-center gap-2 shrink-0"
        >
          <Download size={18} />
          Exportar CSV ({filteredLogs.length})
        </button>
      </div>

      <div className="stats-grid">
        <div className="card p-6">
          <div className="stat-label">Movimientos</div>
          <div className="stat-value">{summary.total}</div>
        </div>
        <div className="card p-6">
          <div className="flex items-center gap-2 stat-label">
            <TrendingUp size={16} className="text-green-600" /> Unidades entraron
          </div>
          <div className="stat-value text-green-600">+{formatQuantity(summary.unitsIn)}</div>
        </div>
        <div className="card p-6">
          <div className="flex items-center gap-2 stat-label">
            <TrendingDown size={16} className="text-red-600" /> Unidades salieron
          </div>
          <div className="stat-value text-red-600">-{formatQuantity(summary.unitsOut)}</div>
        </div>
        <div className="card p-6">
          <div className="flex items-center gap-2 stat-label">
            <Scale size={16} className="text-blue-600" /> Balance neto de stock
          </div>
          <div className={`stat-value ${summary.netChange > 0 ? 'text-green-600' : summary.netChange < 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {summary.netChange > 0 ? '+' : ''}{formatQuantity(summary.netChange)}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="filter-container flex-wrap items-start md:items-center">
          <div className="flex flex-wrap gap-2">
            {QUICK_RANGES.map((range) => (
              <button
                key={range.id}
                type="button"
                onClick={() => applyQuickRange(range)}
                className={`btn btn-sm ${activeQuickRange === range.id ? 'btn-primary' : 'btn-secondary'}`}
              >
                {range.label}
              </button>
            ))}
          </div>
          {summary.reconciliations > 0 && (
            <button
              type="button"
              onClick={() => setTypeFilter('reconciliation')}
              className={`btn btn-sm flex items-center gap-1.5 ${typeFilter === 'reconciliation' ? 'btn-primary' : 'badge-blue rounded-lg'}`}
            >
              <RotateCcw size={14} />
              {summary.reconciliations} correccion{summary.reconciliations === 1 ? '' : 'es'}
            </button>
          )}
        </div>

        <div className="filter-container pt-0">
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)}
              className="input"
              aria-label="Desde"
            />
            <span className="text-gray-500 text-sm">a</span>
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
              className="input"
              aria-label="Hasta"
            />
          </div>
          <Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            options={[
              { value: 'all', label: 'Todos los tipos' },
              ...Object.entries(INVENTORY_MOVEMENT_LABELS).map(([value, label]) => ({ value, label }))
            ]}
          />
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Buscar por producto, motivo, referencia o usuario..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input pl-10 w-full"
            />
          </div>
          {hasActiveFilters && (
            <button type="button" onClick={clearFilters} className="btn btn-secondary btn-sm flex items-center gap-1.5">
              <X size={14} />
              Limpiar filtros
            </button>
          )}
        </div>

        {!rangeIsValid && (
          <p className="px-4 pb-4 md:px-6 text-sm text-red-600">
            La fecha "Desde" no puede ser posterior a la fecha "Hasta".
          </p>
        )}
      </div>

      {error && (
        <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
      )}

      <div className="card overflow-hidden">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha y hora</th>
                <th>Tipo</th>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Stock antes → despues</th>
                <th>Motivo / Referencia</th>
                <th>Usuario</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" className="text-center py-8 text-gray-500">Cargando...</td>
                </tr>
              ) : paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan="7" className="text-center py-8 text-gray-500">
                    {logs.length === 0
                      ? 'No hay movimientos registrados en este rango de fechas.'
                      : 'Ningun movimiento coincide con los filtros seleccionados.'}
                  </td>
                </tr>
              ) : (
                paginatedLogs.map((log) => {
                  const { date, time } = formatDateTime(log.date);
                  const signedQuantity = getSignedQuantity(log);
                  return (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap">
                        <div className="text-sm text-gray-900">{time}</div>
                        <div className="text-xs text-gray-500">{date}</div>
                      </td>
                      <td>
                        <span className={`badge ${TYPE_BADGE_CLASS[log.type] || 'badge-blue'}`}>
                          {INVENTORY_MOVEMENT_LABELS[log.type] || log.type}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setSearchTerm(log.productName || log.productId || '')}
                          className="text-left hover:underline hover:text-primary-700"
                          title="Filtrar por este producto"
                        >
                          {log.productName || log.productId}
                        </button>
                      </td>
                      <td className={`font-medium whitespace-nowrap ${signedQuantity > 0 ? 'text-green-600' : signedQuantity < 0 ? 'text-red-600' : 'text-gray-700'}`}>
                        {signedQuantity > 0 ? '+' : ''}{formatQuantity(signedQuantity)}
                      </td>
                      <td className="whitespace-nowrap text-sm text-gray-600">{log.oldStock ?? '-'} → {log.newStock ?? '-'}</td>
                      <td className="text-sm text-gray-600 max-w-xs">
                        <div>{log.reason || '-'}</div>
                        {log.reference && <div className="text-xs text-gray-400 mt-0.5">Ref: {log.reference}</div>}
                      </td>
                      <td className="text-sm text-gray-600" title={log.performedById || ''}>{log.performedBy || '-'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {filteredLogs.length > 0 && (
        <div className="flex items-center justify-between px-2">
          <p className="text-sm text-gray-600">
            Mostrando {(currentPage - 1) * PAGE_SIZE + 1} - {Math.min(currentPage * PAGE_SIZE, filteredLogs.length)} de {filteredLogs.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm flex items-center gap-1"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft size={16} />
              Anterior
            </button>
            <span className="text-sm text-gray-600">{currentPage}/{totalPages}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm flex items-center gap-1"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Siguiente
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Logs;
