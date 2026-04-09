import React, { useMemo, useState } from 'react';
import { KeyRound, Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';
import Notification from '../components/Notification';
import Input from '../components/Input';
import { MODULE_PERMISSION_OPTIONS } from '../config/rolePermissions';
import { useRoleDefinitions } from '../hooks/useRoleDefinitions';
import { deleteRoleDefinition, saveRoleDefinition } from '../services/rolesService';

const buildRoleId = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const EMPTY_FORM = {
  id: '',
  name: '',
  description: '',
  permissions: []
};

function RolesPermissions() {
  const { roles } = useRoleDefinitions();
  const [selectedRoleId, setSelectedRoleId] = useState('admin');
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [notification, setNotification] = useState(null);
  const [saving, setSaving] = useState(false);

  const selectedRole = useMemo(
    () => roles.find((role) => role.id === selectedRoleId) || null,
    [roles, selectedRoleId]
  );

  const syncForm = (role) => {
    if (!role) {
      setFormData(EMPTY_FORM);
      return;
    }

    setFormData({
      id: role.id,
      name: role.name,
      description: role.description || '',
      permissions: role.permissions || []
    });
  };

  React.useEffect(() => {
    syncForm(selectedRole);
  }, [selectedRoleId, selectedRole]);

  const showNotification = (type, message) => {
    setNotification({ id: Date.now(), type, message });
  };

  const handleNewRole = () => {
    setSelectedRoleId('');
    setFormData(EMPTY_FORM);
  };

  const handleTogglePermission = (permissionId) => {
    setFormData((current) => ({
      ...current,
      permissions: current.permissions.includes(permissionId)
        ? current.permissions.filter((id) => id !== permissionId)
        : [...current.permissions, permissionId]
    }));
  };

  const handleSave = async () => {
    const nextId = selectedRole?.system ? formData.id : buildRoleId(formData.id || formData.name);
    if (!nextId || !formData.name.trim()) {
      showNotification('error', 'El rol necesita un nombre e identificador válido.');
      return;
    }

    if (nextId === 'admin' && !formData.permissions.includes('manage_roles')) {
      showNotification('error', 'El rol admin debe conservar acceso a Roles y permisos.');
      return;
    }

    setSaving(true);
    try {
      await saveRoleDefinition({
        id: nextId,
        name: formData.name,
        description: formData.description,
        permissions: formData.permissions,
        system: selectedRole?.system === true || nextId === 'admin' || nextId === 'manager' || nextId === 'cashier'
      });
      setSelectedRoleId(nextId);
      showNotification('success', 'Rol guardado correctamente.');
    } catch (error) {
      console.error(error);
      showNotification('error', error?.message || 'No se pudo guardar el rol.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRole || selectedRole.system) {
      showNotification('error', 'Los roles base del sistema no se pueden eliminar.');
      return;
    }

    if (!window.confirm(`¿Eliminar el rol ${selectedRole.name}?`)) return;

    setSaving(true);
    try {
      await deleteRoleDefinition(selectedRole.id);
      setSelectedRoleId('admin');
      showNotification('success', 'Rol eliminado.');
    } catch (error) {
      console.error(error);
      showNotification('error', 'No se pudo eliminar el rol.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {notification && (
        <Notification
          key={notification.id}
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      <div className="card p-6">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <ShieldCheck className="text-primary-600" size={26} />
            <div>
              <h2 className="text-xl font-bold text-gray-900">Roles y permisos</h2>
              <p className="text-sm text-gray-500">Crea roles y define a qué módulos del sistema pueden entrar.</p>
            </div>
          </div>

          <button type="button" onClick={handleNewRole} className="btn btn-primary flex items-center gap-2">
            <Plus size={18} />
            Nuevo rol
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px,1fr] gap-6">
          <div className="rounded-xl border border-gray-200 p-4">
            <p className="text-sm font-semibold text-gray-900 mb-3">Roles disponibles</p>
            <div className="space-y-2">
              {roles.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setSelectedRoleId(role.id)}
                  className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                    selectedRoleId === role.id
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-gray-900">{role.name}</span>
                    {role.system && (
                      <span className="badge badge-info">Base</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{role.permissions.length} permisos</p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-4">
              <KeyRound size={18} className="text-primary-600" />
              <p className="font-semibold text-gray-900">Configuración del rol</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Nombre del rol"
                value={formData.name}
                onChange={(e) => setFormData((current) => ({ ...current, name: e.target.value }))}
                placeholder="Ej: Supervisor"
              />
              <Input
                label="Identificador"
                value={selectedRole?.system ? formData.id : (formData.id || buildRoleId(formData.name))}
                onChange={(e) => setFormData((current) => ({ ...current, id: buildRoleId(e.target.value) }))}
                placeholder="Ej: supervisor"
                disabled={selectedRole?.system}
              />
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData((current) => ({ ...current, description: e.target.value }))}
                className="input w-full min-h-[96px]"
                placeholder="Describe el uso de este rol"
              />
            </div>

            <div className="mt-6">
              <p className="text-sm font-semibold text-gray-900 mb-3">Permisos por checkbox</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {MODULE_PERMISSION_OPTIONS.map((permission) => (
                  <label key={permission.id} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={formData.permissions.includes(permission.id)}
                      onChange={() => handleTogglePermission(permission.id)}
                    />
                    <span className="text-sm text-gray-800">{permission.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleSave}
                className="btn btn-primary flex items-center gap-2"
                disabled={saving}
              >
                <Save size={18} />
                Guardar rol
              </button>

              <button
                type="button"
                onClick={handleDelete}
                className="btn btn-secondary flex items-center gap-2"
                disabled={saving || !selectedRole || selectedRole.system}
              >
                <Trash2 size={18} />
                Eliminar rol
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RolesPermissions;
