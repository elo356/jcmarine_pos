import React, { useEffect, useMemo, useState } from 'react';
import { Users, Plus, Edit2, Trash2, Phone, Mail, Calendar, DollarSign, Clock, Search } from 'lucide-react';
import Modal from '../components/Modal';
import Input from '../components/Input';
import Select from '../components/Select';
import Notification from '../components/Notification';
import {
  createEmployeeWithAccount,
  deleteEmployee,
  listEmployees,
  subscribeEmployees,
  toggleEmployeeStatus,
  updateEmployee
} from '../services/employeesService';
import { formatDate } from '../data/demoData';
import { useAuth } from '../contexts/AuthContext';
import { useRoleDefinitions } from '../hooks/useRoleDefinitions';

const DEFAULT_FORM = {
  name: '',
  email: '',
  phone: '',
  role: 'cashier',
  hourlyRate: '',
  startDate: new Date().toISOString().split('T')[0],
  status: 'active',
  address: '',
  password: ''
};

const Employees = () => {
  const { profile, isAdmin } = useAuth();
  const { roles, hasPermission } = useRoleDefinitions();
  const canManageEmployees = isAdmin || hasPermission(profile?.role, 'manage_employees');
  const [employees, setEmployees] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [formData, setFormData] = useState(DEFAULT_FORM);
  const [notification, setNotification] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let unsub = null;

    const start = async () => {
      try {
        const initial = await listEmployees();
        setEmployees(initial);
      } catch (error) {
        console.error(error);
      }

      unsub = subscribeEmployees(
        (rows) => setEmployees(rows),
        (error) => {
          console.error(error);
          setNotification({ type: 'error', message: 'No se pudieron cargar empleados de Firebase.' });
        }
      );
    };

    start();

    return () => {
      if (unsub) unsub();
    };
  }, []);

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const normalizedRole = emp.role === 'inventory' ? 'manager' : emp.role;
      const search = searchTerm.toLowerCase();
      const matchesSearch =
        (emp.name || '').toLowerCase().includes(search) ||
        (emp.email || '').toLowerCase().includes(search) ||
        (emp.phone || '').includes(searchTerm);

      const matchesRole = filterRole === 'all' || normalizedRole === filterRole;
      const matchesStatus = filterStatus === 'all' || emp.status === filterStatus;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [employees, searchTerm, filterRole, filterStatus]);

  const openAddModal = () => {
    setEditingEmployee(null);
    setFormData(DEFAULT_FORM);
    setShowModal(true);
  };

  const openEditModal = (employee) => {
    setEditingEmployee(employee);
    setFormData({
      name: employee.name || '',
      email: employee.email || '',
      phone: employee.phone || '',
      role: (employee.role === 'inventory' ? 'manager' : employee.role) || 'cashier',
      hourlyRate: String(employee.hourlyRate ?? ''),
      startDate: employee.startDate ? employee.startDate.split('T')[0] : new Date().toISOString().split('T')[0],
      status: employee.status || 'active',
      address: employee.address || '',
      password: ''
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingEmployee(null);
    setFormData(DEFAULT_FORM);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.email || !formData.role) {
      setNotification({ type: 'error', message: 'Completa los campos requeridos.' });
      return;
    }

    if (!editingEmployee && !formData.password) {
      setNotification({ type: 'error', message: 'Debes definir una contraseña temporal para la cuenta.' });
      return;
    }

    setSaving(true);

    try {
      if (editingEmployee) {
        await updateEmployee(editingEmployee.id, formData);
        setNotification({ type: 'success', message: 'Empleado actualizado.' });
      } else {
        await createEmployeeWithAccount({
          ...formData,
          createdBy: profile?.uid || 'unknown'
        });
        setNotification({ type: 'success', message: 'Cuenta y empleado creados en Firebase.' });
      }

      closeModal();
    } catch (error) {
      console.error(error);
      setNotification({
        type: 'error',
        message: error?.message || 'Error guardando empleado en Firebase.'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (employeeId) => {
    if (!window.confirm('¿Eliminar este empleado? Nota: no elimina credenciales de Auth automáticamente.')) return;

    try {
      await deleteEmployee(employeeId);
      setNotification({ type: 'success', message: 'Empleado eliminado de Firestore.' });
    } catch (error) {
      console.error(error);
      setNotification({ type: 'error', message: 'No se pudo eliminar el empleado.' });
    }
  };

  const handleToggleStatus = async (employee) => {
    try {
      await toggleEmployeeStatus(employee);
      setNotification({ type: 'success', message: 'Estado de empleado actualizado.' });
    } catch (error) {
      console.error(error);
      setNotification({ type: 'error', message: 'No se pudo cambiar el estado.' });
    }
  };

  const getRoleBadge = (role) => {
    const roleColors = {
      admin: 'badge-red',
      manager: 'badge-purple',
      cashier: 'badge-blue'
    };
    const normalizedRole = role === 'inventory' ? 'manager' : role;
    return <span className={`badge ${roleColors[normalizedRole] || 'badge-gray'}`}>{normalizedRole}</span>;
  };

  const getStatusBadge = (status) => {
    if (status === 'active') {
      return <span className="badge badge-green">Active</span>;
    }
    return <span className="badge badge-gray">Inactive</span>;
  };

  const activeCount = employees.filter((e) => e.status === 'active').length;
  const totalPayroll = employees
    .filter((e) => e.status === 'active')
    .reduce((sum, e) => sum + (Number(e.hourlyRate) || 0), 0);

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Users className="text-primary-600" size={28} />
          <h1 className="page-title">Employee Management</h1>
        </div>

        {canManageEmployees && (
          <button onClick={openAddModal} className="btn-primary">
            <Plus size={16} />
            Add Employee
          </button>
        )}
      </div>

      {!canManageEmployees && (
        <div className="card p-4 border-l-4 border-yellow-400 bg-yellow-50">
          <p className="text-sm text-yellow-800">
            Modo solo lectura: solo administradores pueden crear/editar cuentas de empleados.
          </p>
        </div>
      )}

      <div className="stats-grid">
        <div className="card">
          <div className="stat-label">Total Employees</div>
          <div className="stat-value">{employees.length}</div>
          <div className="stat-trend">
            <Users size={16} className="text-blue-500" />
            <span className="text-blue-500">Registered</span>
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Active Employees</div>
          <div className="stat-value">{activeCount}</div>
          <div className="stat-trend">
            <Clock size={16} className="text-green-500" />
            <span className="text-green-500">Currently active</span>
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Managers</div>
          <div className="stat-value">{employees.filter((e) => e.role === 'manager').length}</div>
          <div className="stat-trend">
            <Users size={16} className="text-purple-500" />
            <span className="text-purple-500">Management</span>
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Total Hourly Payroll</div>
          <div className="stat-value">${totalPayroll.toLocaleString()}</div>
          <div className="stat-trend">
            <DollarSign size={16} className="text-green-500" />
            <span className="text-green-500">Suma por hora de empleados activos</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="filter-container">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Search by name, email, or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input pl-10"
            />
          </div>
          <Select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            options={[
              { value: 'all', label: 'All Roles' },
                      ...roles.map((role) => ({ value: role.id, label: role.name }))
            ]}
          />
          <Select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            options={[
              { value: 'all', label: 'All Status' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' }
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredEmployees.length === 0 ? (
          <div className="col-span-full card text-center py-8 text-gray-500">No employees found</div>
        ) : (
          filteredEmployees.map((employee) => (
            <div key={employee.id} className="card p-4">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                    <span className="text-primary-600 font-bold text-lg">{(employee.name || '?').charAt(0)}</span>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">{employee.name}</h3>
                    <div className="flex gap-2 mt-1">
                      {getRoleBadge(employee.role)}
                      {getStatusBadge(employee.status)}
                    </div>
                  </div>
                </div>

                {canManageEmployees && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEditModal(employee)}
                      className="p-2 text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(employee.id)}
                      className="p-2 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <Mail size={14} />
                  <span>{employee.email}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <Phone size={14} />
                  <span>{employee.phone || '-'}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <Calendar size={14} />
                  <span>Started: {employee.startDate ? formatDate(employee.startDate) : '-'}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <DollarSign size={14} />
                  <span>${Number(employee.hourlyRate || 0)}/hour</span>
                </div>
              </div>

              {canManageEmployees && (
                <div className="mt-4 pt-4 border-t">
                  <button
                    onClick={() => handleToggleStatus(employee)}
                    className={`w-full py-2 rounded text-sm ${
                      employee.status === 'active'
                        ? 'bg-red-50 text-red-600 hover:bg-red-100'
                        : 'bg-green-50 text-green-600 hover:bg-green-100'
                    }`}
                  >
                    {employee.status === 'active' ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {showModal && (
        <Modal
          isOpen={showModal}
          onClose={closeModal}
          title={editingEmployee ? 'Edit Employee' : 'Add Employee'}
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input label="Full Name *" name="name" value={formData.name} onChange={handleInputChange} required />
              <Input label="Email *" name="email" type="email" value={formData.email} onChange={handleInputChange} required />
              {!editingEmployee && (
                <Input
                  label="Temporary Password *"
                  name="password"
                  type="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="Contraseña temporal"
                  required
                />
              )}
              <Input label="Phone" name="phone" type="tel" value={formData.phone} onChange={handleInputChange} />
              <Select
                label="Role *"
                name="role"
                value={formData.role}
                onChange={handleInputChange}
                options={[
                  ...roles.map((role) => ({ value: role.id, label: role.name }))
                ]}
              />
              <Input
                label="Hourly Rate"
                name="hourlyRate"
                type="number"
                min="0"
                step="0.01"
                value={formData.hourlyRate}
                onChange={handleInputChange}
              />
              <Input
                label="Start Date"
                name="startDate"
                type="date"
                value={formData.startDate}
                onChange={handleInputChange}
              />
              <Select
                label="Status"
                name="status"
                value={formData.status}
                onChange={handleInputChange}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' }
                ]}
              />
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <textarea
                  name="address"
                  value={formData.address}
                  onChange={handleInputChange}
                  placeholder="Full address..."
                  className="input min-h-[80px] w-full"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <button onClick={closeModal} className="btn-secondary" disabled={saving}>
                Cancel
              </button>
              <button onClick={handleSubmit} className="btn-primary" disabled={saving}>
                {saving ? 'Saving...' : editingEmployee ? 'Update Employee' : 'Create Account'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {notification && (
        <Notification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}
    </div>
  );
};

export default Employees;
