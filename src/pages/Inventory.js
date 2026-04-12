import React, { useMemo, useState, useEffect } from 'react';
import { Search, Plus, Minus, AlertTriangle, Package, TrendingUp } from 'lucide-react';
import { loadData, saveData, formatCurrency, formatQuantity, generateId, normalizeProductTaxConfig } from '../data/demoData';
import Modal from '../components/Modal';
import Input from '../components/Input';
import Select from '../components/Select';
import Notification from '../components/Notification';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  addInventoryLog,
  subscribeInventoryLogs,
  subscribeProducts,
  updateProductStock
} from '../services/inventoryService';

const Inventory = () => {
  const [products, setProducts] = useState([]);
  const [inventoryLogs, setInventoryLogs] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [adjustmentType, setAdjustmentType] = useState('add');
  const [adjustmentQty, setAdjustmentQty] = useState(1);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [notification, setNotification] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 80;
  const debouncedSearch = useDebouncedValue(searchTerm, 250);

  useEffect(() => {
    const localData = loadData();
    setProducts((localData.products || []).map(normalizeProductTaxConfig).filter((p) => p.active));
    setInventoryLogs(localData.inventoryLogs || []);

    const unsubProducts = subscribeProducts(
      (rows) => {
        if (rows.length > 0) {
          setProducts(rows.map(normalizeProductTaxConfig).filter((p) => p.active));
        }
      },
      (error) => {
        console.error('Error subscribing products in inventory:', error);
      }
    );

    const unsubLogs = subscribeInventoryLogs(
      (rows) => {
        if (rows.length > 0) {
          setInventoryLogs(rows);
        }
      },
      (error) => {
        console.error('Error subscribing inventory logs:', error);
      }
    );

    return () => {
      unsubProducts();
      unsubLogs();
    };
  }, []);

  const inventory = useMemo(() => {
    return products.map((product) => {
      const stockStatus = product.stock === 0
        ? 'out'
        : product.stock <= product.lowStockThreshold
          ? 'low'
          : 'normal';

      return {
        ...product,
        stockStatus,
        recentLogs: inventoryLogs
          .filter((log) => log.productId === product.id)
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .slice(0, 5)
      };
    });
  }, [products, inventoryLogs]);

  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
  };

  const handleFilterStatus = (e) => {
    setFilterStatus(e.target.value);
  };

  const handleFilterCategory = (e) => {
    setFilterCategory(e.target.value);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, filterStatus, filterCategory]);

  const buildAdjacencyMap = (items) => {
    const adjacency = new Map(items.map((p) => [p.id, new Set()]));

    items.forEach((product) => {
      (product.linkedProductIds || []).forEach((linkedId) => {
        if (!adjacency.has(linkedId) || linkedId === product.id) return;
        adjacency.get(product.id).add(linkedId);
        adjacency.get(linkedId).add(product.id);
      });
    });

    return adjacency;
  };

  const getFilteredInventory = () => {
    const query = debouncedSearch.trim().toLowerCase();
    let matchedIds;

    if (!query) {
      matchedIds = new Set(inventory.map((item) => item.id));
    } else {
      const directMatches = new Set(
        inventory
          .filter((item) =>
            (item.sku || '').toLowerCase().includes(query) ||
            item.name.toLowerCase().includes(query) ||
            item.barcode.includes(debouncedSearch) ||
            item.category.toLowerCase().includes(query) ||
            (item.description || '').toLowerCase().includes(query) ||
            (item.location || '').toLowerCase().includes(query)
          )
          .map((item) => item.id)
      );

      if (directMatches.size === 0) return [];

      const adjacency = buildAdjacencyMap(inventory);
      const queue = [...directMatches];
      matchedIds = new Set(directMatches);

      while (queue.length > 0) {
        const currentId = queue.shift();
        const neighbors = adjacency.get(currentId) || new Set();

        neighbors.forEach((neighborId) => {
          if (matchedIds.has(neighborId)) return;
          matchedIds.add(neighborId);
          queue.push(neighborId);
        });
      }
    }

    return inventory.filter(item => {
      const matchesSearch = matchedIds.has(item.id);
      
      const matchesStatus = 
        filterStatus === 'all' || 
        (filterStatus === 'low' && item.stockStatus === 'low') ||
        (filterStatus === 'out' && item.stockStatus === 'out') ||
        (filterStatus === 'normal' && item.stockStatus === 'normal');

      const matchesCategory =
        filterCategory === 'all' ||
        String(item.category || '').trim().toLowerCase() === filterCategory;

      return matchesSearch && matchesStatus && matchesCategory;
    });
  };

  const openAdjustModal = (product) => {
    setSelectedProduct(product);
    setAdjustmentType('add');
    setAdjustmentQty(product.unitType === 'feet' ? 1 : 1);
    setAdjustmentReason('');
    setShowAdjustModal(true);
  };

  const closeAdjustModal = () => {
    setShowAdjustModal(false);
    setSelectedProduct(null);
  };

  const handleAdjustment = async () => {
    if (!selectedProduct || adjustmentQty <= 0) return;

    const oldStock = selectedProduct.stock;
    const newStock = adjustmentType === 'add' 
      ? oldStock + adjustmentQty 
      : Math.max(0, oldStock - adjustmentQty);

    // Add inventory log
    const log = {
      id: generateId(),
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      type: adjustmentType === 'add' ? 'adjustment_in' : 'adjustment_out',
      quantity: adjustmentQty,
      oldStock,
      newStock,
      reason: adjustmentReason || 'Manual adjustment',
      date: new Date().toISOString(),
      userId: 'current_user'
    };

    const data = loadData();
    const localProductIndex = data.products.findIndex((p) => p.id === selectedProduct.id);
    if (localProductIndex !== -1) {
      data.products[localProductIndex].stock = newStock;
      data.inventoryLogs = [log, ...(data.inventoryLogs || [])];
      saveData(data); // fallback/local compatibility
    }

    let synced = true;
    try {
      await updateProductStock(selectedProduct.id, newStock);
      await addInventoryLog(log);
    } catch (error) {
      synced = false;
      console.error('Error persisting inventory adjustment to Firestore:', error);
    }

    setNotification({
      type: synced ? 'success' : 'warning',
      message: synced
        ? `Stock adjusted successfully: ${selectedProduct.name} (${oldStock} → ${newStock})`
        : `Ajuste aplicado localmente: ${selectedProduct.name} (${oldStock} → ${newStock}). Falló sincronización con Firestore.`
    });

    closeAdjustModal();
  };

  const getStockBadge = (item) => {
    if (item.stockStatus === 'out') {
      return <span className="badge badge-red">Out of Stock</span>;
    } else if (item.stockStatus === 'low') {
      return <span className="badge badge-yellow">Low Stock</span>;
    }
    return <span className="badge badge-green">In Stock</span>;
  };

  const filteredInventory = getFilteredInventory();
  const totalPages = Math.max(1, Math.ceil(filteredInventory.length / PAGE_SIZE));
  const visibleInventory = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredInventory.slice(start, start + PAGE_SIZE);
  }, [filteredInventory, currentPage]);
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);
  const lowStockCount = inventory.filter(i => i.stockStatus === 'low').length;
  const outOfStockCount = inventory.filter(i => i.stockStatus === 'out').length;
  const totalStock = inventory.reduce((sum, item) => sum + item.stock, 0);
  const totalCostValue = inventory.reduce((sum, item) => sum + (item.stock * item.cost), 0);
  const totalSaleValue = inventory.reduce((sum, item) => sum + (item.stock * item.price), 0);
  const categoryOptions = useMemo(() => {
    const unique = [...new Set(inventory.map((item) => String(item.category || '').trim()).filter(Boolean))];
    unique.sort((a, b) => a.localeCompare(b, 'es'));
    return [{ value: 'all', label: 'All Categories' }, ...unique.map((name) => ({ value: name.toLowerCase(), label: name }))];
  }, [inventory]);

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Package className="text-primary-600" size={28} />
          <h1 className="page-title">Inventory Management</h1>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="card">
          <div className="stat-label">Total Items</div>
          <div className="stat-value">{inventory.length}</div>
          <div className="stat-trend">
            <TrendingUp size={16} className="text-green-500" />
            <span className="text-green-500">Products</span>
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Total Stock</div>
          <div className="stat-value">{totalStock}</div>
          <div className="stat-trend">
            <Package size={16} className="text-blue-500" />
            <span className="text-blue-500">Unidades / pies</span>
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Cost Value</div>
          <div className="stat-value">{formatCurrency(totalCostValue)}</div>
          <div className="stat-trend">
            <TrendingUp size={16} className="text-green-500" />
            <span className="text-green-500">Cost value</span>
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Sale Value</div>
          <div className="stat-value">{formatCurrency(totalSaleValue)}</div>
          <div className="stat-trend">
            <TrendingUp size={16} className="text-blue-500" />
            <span className="text-blue-500">Sale value</span>
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Needs Attention</div>
          <div className="stat-value text-red-600">{lowStockCount + outOfStockCount}</div>
          <div className="stat-trend">
            <AlertTriangle size={16} className="text-red-500" />
            <span className="text-red-500">Low/Out of stock</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="filter-container">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Search by name, SKU, barcode, or category..."
              value={searchTerm}
              onChange={handleSearch}
              className="input pl-10"
            />
          </div>
          <Select
            value={filterStatus}
            onChange={handleFilterStatus}
            options={[
              { value: 'all', label: 'All Status' },
              { value: 'normal', label: 'In Stock' },
              { value: 'low', label: 'Low Stock' },
              { value: 'out', label: 'Out of Stock' }
            ]}
          />
          <Select
            value={filterCategory}
            onChange={handleFilterCategory}
            options={categoryOptions}
          />
        </div>
      </div>

      {/* Inventory Table */}
      <div className="card overflow-hidden">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Stock</th>
                <th>Ubicación</th>
                <th>Cost</th>
                <th>Value</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInventory.length === 0 ? (
                <tr>
                  <td colSpan="8" className="text-center py-8 text-gray-500">
                    No inventory found
                  </td>
                </tr>
              ) : (
                visibleInventory.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td>
                      <div>
                        <div className="font-medium text-gray-900">{item.name}</div>
                        <div className="text-sm text-gray-500">{item.barcode}</div>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-blue">{item.category}</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{formatQuantity(item.stock, item.unitType)}</span>
                        {item.stockStatus === 'low' && (
                          <AlertTriangle size={16} className="text-yellow-500" />
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="text-sm text-gray-700">{item.location || '-'}</span>
                    </td>
                    <td>{formatCurrency(item.cost)}</td>
                    <td>{formatCurrency(item.stock * item.cost)}</td>
                    <td>{getStockBadge(item)}</td>
                    <td>
                      <button
                        onClick={() => openAdjustModal(item)}
                        className="btn-primary btn-sm"
                      >
                        Adjust
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {filteredInventory.length > 0 && (
        <div className="flex items-center justify-between px-2">
          <p className="text-sm text-gray-600">
            Mostrando {(currentPage - 1) * PAGE_SIZE + 1} - {Math.min(currentPage * PAGE_SIZE, filteredInventory.length)} de {filteredInventory.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Anterior
            </button>
            <span className="text-sm text-gray-600">{currentPage}/{totalPages}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {showAdjustModal && selectedProduct && (
        <Modal
          isOpen={showAdjustModal}
          onClose={closeAdjustModal}
          title="Adjust Stock"
          size="md"
        >
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="font-medium">{selectedProduct.name}</div>
              <div className="text-sm text-gray-500">
                Stock actual: {formatQuantity(selectedProduct.stock, selectedProduct.unitType)}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setAdjustmentType('add')}
                className={`flex-1 py-2 px-4 rounded-lg ${
                  adjustmentType === 'add'
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <Plus size={16} />
                  Add Stock
                </div>
              </button>
              <button
                onClick={() => setAdjustmentType('remove')}
                className={`flex-1 py-2 px-4 rounded-lg ${
                  adjustmentType === 'remove'
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <Minus size={16} />
                  Remove Stock
                </div>
              </button>
            </div>

            <Input
              label={selectedProduct.unitType === 'feet' ? 'Cantidad en pies' : 'Cantidad'}
              type="number"
              min={selectedProduct.unitType === 'feet' ? '0.01' : '1'}
              step={selectedProduct.unitType === 'feet' ? '0.01' : '1'}
              value={adjustmentQty}
              onChange={(e) => setAdjustmentQty(Number(e.target.value) || 0)}
              placeholder="Enter quantity"
              required
            />

            <Input
              label="Reason (optional)"
              value={adjustmentReason}
              onChange={(e) => setAdjustmentReason(e.target.value)}
              placeholder="e.g., Restock, Damaged goods, Returns"
            />

            <div className="flex justify-end gap-2 pt-4">
              <button onClick={closeAdjustModal} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleAdjustment} className="btn-primary">
                Confirm Adjustment
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Notification */}
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

export default Inventory;
