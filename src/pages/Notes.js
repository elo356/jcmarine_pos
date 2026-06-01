import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, Pencil, Plus, Save, Search, Trash2 } from 'lucide-react';
import Notification from '../components/Notification';
import { useAuth } from '../contexts/AuthContext';
import { generateId } from '../data/demoData';
import { deleteNote, saveNote, subscribeNotes } from '../services/notesService';

const EMPTY_FORM = {
  id: '',
  title: '',
  content: '',
  status: 'pending'
};

const NOTE_STATUS_OPTIONS = {
  pending: {
    label: 'Pendiente',
    listClass: 'border-red-200 bg-red-50/70',
    activeClass: 'border-red-300 bg-red-50 shadow-sm',
    badgeClass: 'border-red-200 bg-red-100 text-red-700',
    iconClass: 'text-red-500'
  },
  done: {
    label: 'Trabajada',
    listClass: 'border-green-200 bg-green-50/70',
    activeClass: 'border-green-300 bg-green-50 shadow-sm',
    badgeClass: 'border-green-200 bg-green-100 text-green-700',
    iconClass: 'text-green-600'
  }
};

const getNoteStatus = (note = {}) => (note.status === 'done' ? 'done' : 'pending');

const formatDateTime = (value) => {
  if (!value) return 'Sin fecha';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';

  return date.toLocaleString('es-PR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};

const getPreview = (content = '') => {
  const trimmed = String(content || '').trim();
  if (trimmed.length <= 120) return trimmed || 'Sin contenido';
  return `${trimmed.slice(0, 117)}...`;
};

function Notes() {
  const { user, profile } = useAuth();
  const [notes, setNotes] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [statusFilter, setStatusFilter] = useState('all');
  const [notification, setNotification] = useState(null);
  const [syncMeta, setSyncMeta] = useState({ fromCache: true, failed: false });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeNotes(
      (rows, meta = {}) => {
        setNotes(rows || []);
        setSyncMeta(meta);
      },
      (error) => {
        console.error('Error subscribing notes:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedNoteId) return;
    const selected = notes.find((note) => note.id === selectedNoteId);
    if (!selected) {
      setSelectedNoteId('');
      setForm(EMPTY_FORM);
    }
  }, [notes, selectedNoteId]);

  const filteredNotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const statusFiltered = statusFilter === 'all'
      ? notes
      : notes.filter((note) => getNoteStatus(note) === statusFilter);

    if (!query) return statusFiltered;

    return statusFiltered.filter((note) => (
      note.title.toLowerCase().includes(query) || note.content.toLowerCase().includes(query)
    ));
  }, [notes, searchQuery, statusFilter]);

  const noteCounts = useMemo(() => ({
    all: notes.length,
    pending: notes.filter((note) => getNoteStatus(note) === 'pending').length,
    done: notes.filter((note) => getNoteStatus(note) === 'done').length
  }), [notes]);

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) || null,
    [notes, selectedNoteId]
  );

  const showNotification = (type, message) => {
    setNotification({ id: Date.now(), type, message });
  };

  const startNewNote = () => {
    setSelectedNoteId('');
    setForm(EMPTY_FORM);
  };

  const handleSelectNote = (note) => {
    setSelectedNoteId(note.id);
    setForm({
      id: note.id,
      title: note.title,
      content: note.content,
      status: getNoteStatus(note)
    });
  };

  const handleSaveNote = async () => {
    const trimmedTitle = form.title.trim();
    const trimmedContent = form.content.trim();

    if (!trimmedTitle && !trimmedContent) {
      showNotification('warning', 'Escribe un titulo o contenido para guardar la nota.');
      return;
    }

    setIsSaving(true);

    const noteId = form.id || generateId('note');
    const existingNote = notes.find((note) => note.id === noteId);
    const saved = await saveNote({
      id: noteId,
      title: trimmedTitle || 'Nota rapida',
      content: trimmedContent,
      status: getNoteStatus(form),
      createdAt: existingNote?.createdAt,
      createdBy: existingNote?.createdBy || user?.uid || '',
      createdByName: existingNote?.createdByName || profile?.name || user?.email || 'Usuario',
      updatedBy: user?.uid || '',
      updatedByName: profile?.name || user?.email || 'Usuario'
    });

    setSelectedNoteId(saved.id);
    setForm({
      id: saved.id,
      title: saved.title,
      content: saved.content,
      status: getNoteStatus(saved)
    });
    setIsSaving(false);

    if (saved.localOnly) {
      showNotification('warning', 'La nota se guardo en este equipo. Si vuelve la conexion, puedes editarla otra vez para sincronizarla.');
    } else {
      showNotification('success', existingNote ? 'Nota actualizada.' : 'Nota creada.');
    }
  };

  const handleChangeNoteStatus = async (note, status) => {
    if (!note || getNoteStatus(note) === status) return;

    const saved = await saveNote({
      ...note,
      status,
      updatedBy: user?.uid || '',
      updatedByName: profile?.name || user?.email || 'Usuario'
    });

    if (selectedNoteId === note.id) {
      setForm((current) => ({ ...current, status: getNoteStatus(saved) }));
    }

    showNotification(
      saved.localOnly ? 'warning' : 'success',
      status === 'done' ? 'Nota marcada como trabajada.' : 'Nota marcada como pendiente.'
    );
  };

  const handleDeleteNote = async (note) => {
    if (!note) return;
    if (!window.confirm(`¿Eliminar la nota "${note.title || 'Sin titulo'}"?`)) return;

    const result = await deleteNote(note.id);
    if (selectedNoteId === note.id) {
      startNewNote();
    }

    if (result.localOnly) {
      showNotification('warning', 'La nota se elimino del cache local, pero no se pudo sincronizar en la nube.');
    } else {
      showNotification('success', 'Nota eliminada.');
    }
  };

  return (
    <div className="page-container">
      {notification && (
        <Notification
          key={notification.id}
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Notas</h1>
          <p className="text-sm text-gray-500">
            Espacio rapido para apuntar llamadas, recordatorios y seguimientos con fecha y hora.
          </p>
        </div>
        <div className={`rounded-lg border px-3 py-2 text-sm font-medium ${
          syncMeta.failed
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : syncMeta.fromCache
              ? 'border-blue-200 bg-blue-50 text-blue-800'
              : 'border-green-200 bg-green-50 text-green-800'
        }`}>
          {syncMeta.failed
            ? 'Trabajando con cache local'
            : syncMeta.fromCache
              ? 'Cargando notas...'
              : 'Notas sincronizadas'}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[22rem,minmax(0,1fr)]">
        <div className="card p-4 space-y-4">
          <button type="button" onClick={startNewNote} className="w-full btn btn-primary">
            <Plus size={18} />
            Nueva nota
          </button>

          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar nota..."
              className="input w-full pl-10"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'all', label: 'Todas', count: noteCounts.all },
              { id: 'pending', label: 'Rojas', count: noteCounts.pending },
              { id: 'done', label: 'Verdes', count: noteCounts.done }
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setStatusFilter(option.id)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  statusFilter === option.id
                    ? 'border-primary-300 bg-primary-50 text-primary-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                {option.label}
                <span className="ml-1 text-xs text-gray-500">{option.count}</span>
              </button>
            ))}
          </div>

          <div className="space-y-3 max-h-[38rem] overflow-y-auto pr-1">
            {filteredNotes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500">
                No hay notas que coincidan.
              </div>
            ) : (
              filteredNotes.map((note) => {
                const isActive = note.id === selectedNoteId;
                const status = getNoteStatus(note);
                const statusOption = NOTE_STATUS_OPTIONS[status];
                const StatusIcon = status === 'done' ? CheckCircle2 : AlertCircle;
                return (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => handleSelectNote(note)}
                    className={`w-full rounded-xl border p-4 text-left transition ${
                      isActive
                        ? statusOption.activeClass
                        : `${statusOption.listClass} hover:border-gray-300`
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-gray-900">{note.title || 'Sin titulo'}</p>
                        <p className="mt-1 text-sm text-gray-600">{getPreview(note.content)}</p>
                      </div>
                      <StatusIcon size={18} className={`mt-1 flex-shrink-0 ${statusOption.iconClass}`} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Clock3 size={14} />
                        <span>{formatDateTime(note.updatedAt || note.createdAt)}</span>
                      </div>
                      <span className={`rounded-full border px-2 py-1 text-xs font-medium ${statusOption.badgeClass}`}>
                        {statusOption.label}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="card p-6 space-y-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {selectedNote ? 'Editar nota' : 'Nueva nota rapida'}
              </h2>
              <p className="text-sm text-gray-500">
                Guarda detalles cortos de una llamada, seguimiento o tarea pendiente.
              </p>
            </div>
            {selectedNote && (
              <div className="text-xs text-gray-500 space-y-1">
                <p>Creada: {formatDateTime(selectedNote.createdAt)}</p>
                <p>Actualizada: {formatDateTime(selectedNote.updatedAt)}</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setForm((current) => ({ ...current, status: 'pending' }));
                if (selectedNote) handleChangeNoteStatus(selectedNote, 'pending');
              }}
              className={`rounded-lg border px-4 py-3 text-left transition ${
                getNoteStatus(form) === 'pending'
                  ? 'border-red-300 bg-red-50 text-red-800'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-red-200'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle size={18} />
                Roja / pendiente
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                setForm((current) => ({ ...current, status: 'done' }));
                if (selectedNote) handleChangeNoteStatus(selectedNote, 'done');
              }}
              className={`rounded-lg border px-4 py-3 text-left transition ${
                getNoteStatus(form) === 'done'
                  ? 'border-green-300 bg-green-50 text-green-800'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-green-200'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 size={18} />
                Verde / trabajada
              </div>
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Titulo</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))}
                placeholder="Ej. Llamada con cliente de motores"
                className="input w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Nota</label>
              <textarea
                value={form.content}
                onChange={(e) => setForm((current) => ({ ...current, content: e.target.value }))}
                placeholder="Escribe aqui los detalles importantes..."
                className="input min-h-[22rem] w-full resize-y"
              />
            </div>
          </div>

          <div className="rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
            <div className="flex items-center gap-2 font-medium text-gray-800">
              <Pencil size={16} />
              <span>Detalles</span>
            </div>
            <div className="mt-2 space-y-1">
              <p>Autor: {selectedNote?.createdByName || profile?.name || user?.email || 'Usuario'}</p>
              <p>Ultima edicion: {selectedNote?.updatedByName || profile?.name || user?.email || 'Usuario'}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <div className="flex gap-2">
              <button type="button" onClick={startNewNote} className="btn btn-secondary">
                Limpiar
              </button>
              {selectedNote && (
                <button type="button" onClick={() => handleDeleteNote(selectedNote)} className="btn btn-danger">
                  <Trash2 size={18} />
                  Borrar
                </button>
              )}
            </div>

            <button type="button" onClick={handleSaveNote} className="btn btn-primary" disabled={isSaving}>
              <Save size={18} />
              {isSaving ? 'Guardando...' : selectedNote ? 'Guardar cambios' : 'Guardar nota'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Notes;
