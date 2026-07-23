import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, Pencil, Plus, RotateCcw, Save, Search, Trash2 } from 'lucide-react';
import Notification from '../components/Notification';
import { useAuth } from '../contexts/AuthContext';
import { generateId } from '../data/demoData';
import { deleteNote, NOTE_TRASH_RETENTION_DAYS, restoreNote, saveNote, subscribeDeletedNotes, subscribeNotes } from '../services/notesService';

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
  const [trashedNotes, setTrashedNotes] = useState([]);
  const [viewMode, setViewMode] = useState('notes');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [statusFilter, setStatusFilter] = useState('all');
  const [notification, setNotification] = useState(null);
  const [syncMeta, setSyncMeta] = useState({ fromCache: true, failed: false });
  const [isSaving, setIsSaving] = useState(false);
  const [notePendingDeletion, setNotePendingDeletion] = useState(null);
  const noteEditorRef = useRef(null);

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
    const unsubscribe = subscribeDeletedNotes(
      (rows) => setTrashedNotes(rows || []),
      (error) => console.error('Error subscribing deleted notes:', error)
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedNoteId) return;
    const selected = (viewMode === 'trash' ? trashedNotes : notes).find((note) => note.id === selectedNoteId);
    if (!selected) {
      setSelectedNoteId('');
      setForm(EMPTY_FORM);
    }
  }, [notes, selectedNoteId, trashedNotes, viewMode]);

  const filteredNotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const currentNotes = viewMode === 'trash' ? trashedNotes : notes;
    const statusFiltered = viewMode === 'trash' || statusFilter === 'all'
      ? currentNotes
      : currentNotes.filter((note) => getNoteStatus(note) === statusFilter);

    const byDateDesc = (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    const sorted = [...statusFiltered].sort(byDateDesc);

    if (!query) return sorted;

    return sorted.filter((note) => (
      note.title.toLowerCase().includes(query) || note.content.toLowerCase().includes(query)
    ));
  }, [notes, searchQuery, statusFilter, trashedNotes, viewMode]);

  const noteCounts = useMemo(() => ({
    all: notes.length,
    pending: notes.filter((note) => getNoteStatus(note) === 'pending').length,
    done: notes.filter((note) => getNoteStatus(note) === 'done').length
  }), [notes]);

  const selectedNote = useMemo(
    () => (viewMode === 'trash' ? trashedNotes : notes).find((note) => note.id === selectedNoteId) || null,
    [notes, selectedNoteId, trashedNotes, viewMode]
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

  const confirmDeleteNote = async () => {
    const note = notePendingDeletion;
    if (!note) return;
    setNotePendingDeletion(null);

    const result = await deleteNote(note, {
      id: user?.uid || '',
      name: profile?.name || user?.email || 'Usuario'
    });
    if (selectedNoteId === note.id) {
      startNewNote();
      window.requestAnimationFrame(() => noteEditorRef.current?.focus());
    }

    if (result.localOnly) {
      showNotification('warning', 'La nota se movio a la papelera local, pero no se pudo sincronizar en la nube.');
    } else {
      showNotification('success', `Nota movida a la papelera por ${NOTE_TRASH_RETENTION_DAYS} dias.`);
    }
  };

  const handleRestoreNote = async (note) => {
    if (!note) return;
    const result = await restoreNote(note, {
      id: user?.uid || '',
      name: profile?.name || user?.email || 'Usuario'
    });
    // El boton de restaurar desaparece al volver a la lista. Seleccionamos la
    // nota recuperada y devolvemos el foco al editor para que se pueda seguir
    // escribiendo sin tener que cerrar ni reiniciar la aplicacion.
    setViewMode('notes');
    setSelectedNoteId(result.id);
    setForm({
      id: result.id,
      title: result.title,
      content: result.content,
      status: getNoteStatus(result)
    });
    window.requestAnimationFrame(() => noteEditorRef.current?.focus());
    showNotification(result.localOnly ? 'warning' : 'success', result.localOnly
      ? 'La nota se restauro solo en este equipo hasta que vuelva la conexion.'
      : 'Nota restaurada correctamente.');
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

      {notePendingDeletion && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-black/50"
            aria-label="Cancelar eliminacion"
            onClick={() => setNotePendingDeletion(null)}
          />
          <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-gray-900">¿Mover nota a la papelera?</h2>
            <p className="mt-2 text-sm text-gray-600">
              “{notePendingDeletion.title || 'Sin titulo'}” se podra restaurar durante {NOTE_TRASH_RETENTION_DAYS} dias.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn btn-secondary" onClick={() => setNotePendingDeletion(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-danger" onClick={confirmDeleteNote}>
                Mover a papelera
              </button>
            </div>
          </div>
        </div>
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
          {viewMode === 'notes' && <button type="button" onClick={startNewNote} className="w-full btn btn-primary">
            <Plus size={18} />
            Nueva nota
          </button>}

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { setViewMode('notes'); startNewNote(); }} className={`rounded-lg border px-3 py-2 text-sm font-medium ${viewMode === 'notes' ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600'}`}>
              Notas <span className="text-xs">{notes.length}</span>
            </button>
            <button type="button" onClick={() => { setViewMode('trash'); startNewNote(); }} className={`rounded-lg border px-3 py-2 text-sm font-medium ${viewMode === 'trash' ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600'}`}>
              Papelera <span className="text-xs">{trashedNotes.length}</span>
            </button>
          </div>

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

          {viewMode === 'notes' && <div className="grid grid-cols-3 gap-2">
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
          </div>}

          <div className="space-y-3 max-h-[38rem] overflow-y-auto pr-1">
            {filteredNotes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500">
                {viewMode === 'trash' ? 'La papelera esta vacia.' : 'No hay notas que coincidan.'}
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
                      <span>{viewMode === 'trash' ? `Eliminada: ${formatDateTime(note.deletedAt)}` : formatDateTime(note.updatedAt || note.createdAt)}</span>
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

        {viewMode === 'trash' ? (
          <div className="card p-6 space-y-5">
            {selectedNote ? <>
              <div className="flex items-start justify-between gap-4">
                <div><h2 className="text-xl font-semibold text-gray-900">{selectedNote.title || 'Sin titulo'}</h2><p className="mt-1 text-sm text-gray-500">Eliminada el {formatDateTime(selectedNote.deletedAt)}. Se borrara permanentemente el {formatDateTime(selectedNote.expiresAt)}.</p></div>
                <Trash2 size={24} className="text-gray-400" />
              </div>
              <div className="rounded-xl bg-gray-50 p-4 whitespace-pre-wrap text-gray-700 min-h-[12rem]">{selectedNote.content || 'Sin contenido'}</div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Esta nota permanecera en la papelera durante {NOTE_TRASH_RETENTION_DAYS} dias desde su eliminacion.</div>
              <button type="button" onClick={() => handleRestoreNote(selectedNote)} className="btn btn-primary"><RotateCcw size={18} />Restaurar nota</button>
            </> : <div className="py-20 text-center text-gray-500"><Trash2 size={32} className="mx-auto mb-3 text-gray-300" />Selecciona una nota de la papelera para verla o restaurarla.</div>}
          </div>
        ) : <div className="card p-6 space-y-5">
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
                ref={noteEditorRef}
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
                <button type="button" onClick={() => setNotePendingDeletion(selectedNote)} className="btn btn-danger">
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
        </div>}
      </div>
    </div>
  );
}

export default Notes;
