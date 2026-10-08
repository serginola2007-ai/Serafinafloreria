import { get, post, put, patch, del } from './client.js';

export const authApi = {
  login: (email, password) => post('/auth/login', { email, password }),
  logout: () => post('/auth/logout'),
  me: () => get('/auth/me'),
  changePassword: (currentPassword, newPassword) => post('/auth/change-password', { currentPassword, newPassword }),
};
export const usersApi = {
  list: (q) => get('/users', q), get: (id) => get(`/users/${id}`),
  create: (b) => post('/users', b), update: (id, b) => patch(`/users/${id}`, b), deactivate: (id) => del(`/users/${id}`),
  resetPassword: (id, password) => post(`/users/${id}/reset-password`, { password }),
  setPermissions: (id, allow, deny) => put(`/users/${id}/permissions`, { allow, deny }),
};
export const rolesApi = {
  list: () => get('/roles'), options: () => get('/roles/options'), permissions: () => get('/permissions'),
  setPermissions: (code, permissions) => put(`/roles/${code}/permissions`, { permissions }),
};
export const auditApi = { list: (q) => get('/audit-logs', q) };
export const dashboardApi = { summary: () => get('/dashboard/summary') };
export const integrationsApi = { list: () => get('/integrations') };

export const productsApi = {
  list: (q) => get('/products', q), get: (id) => get(`/products/${id}`),
  create: (b) => post('/products', b), update: (id, b) => patch(`/products/${id}`, b),
  archive: (id) => del(`/products/${id}`), restore: (id) => post(`/products/${id}/restore`),
  addVariant: (id, b) => post(`/products/${id}/variants`, b), updateVariant: (vid, b) => patch(`/variants/${vid}`, b),
  priceHistory: (vid) => get(`/variants/${vid}/price-history`),
  setMedia: (id, mediaIds) => put(`/products/${id}/media`, { mediaIds }),
};
export const categoriesApi = {
  list: () => get('/categories'), create: (b) => post('/categories', b), update: (id, b) => patch(`/categories/${id}`, b), archive: (id) => del(`/categories/${id}`),
};
export const mediaApi = {
  list: (q) => get('/media', q),
  upload: (file, altText) => { const f = new FormData(); if (altText) f.append('altText', altText); f.append('isPublic', 'true'); f.append('file', file); return post('/media', undefined, { form: f }); },
};

export const inventoryApi = {
  items: (q) => get('/inventory/items', q), item: (id) => get(`/inventory/items/${id}`),
  enroll: (b) => post('/inventory/items', b), settings: (id, b) => put(`/inventory/items/${id}/settings`, b),
  movements: (q) => get('/inventory/movements', q), adjust: (b) => post('/inventory/adjustments', b),
  waste: (b) => post('/inventory/waste', b), wasteReport: (q) => get('/inventory/waste', q),
  wasteReasons: () => get('/waste-reasons'), createWasteReason: (name) => post('/waste-reasons', { name }), updateWasteReason: (id, b) => patch(`/waste-reasons/${id}`, b),
  alerts: () => get('/inventory/alerts'),
};
export const suppliersApi = {
  list: (q) => get('/suppliers', q), get: (id) => get(`/suppliers/${id}`), create: (b) => post('/suppliers', b), update: (id, b) => patch(`/suppliers/${id}`, b), archive: (id) => del(`/suppliers/${id}`),
  link: (id, pid, supplierSku) => put(`/suppliers/${id}/products/${pid}`, { supplierSku: supplierSku || null }), unlink: (id, pid) => del(`/suppliers/${id}/products/${pid}`),
  priceHistory: (id, productId) => get(`/suppliers/${id}/price-history`, { productId }),
};
export const purchasingApi = {
  list: (q) => get('/purchase-orders', q), get: (id) => get(`/purchase-orders/${id}`), create: (b) => post('/purchase-orders', b), update: (id, b) => put(`/purchase-orders/${id}`, b),
  send: (id) => post(`/purchase-orders/${id}/send`), cancel: (id, reason) => post(`/purchase-orders/${id}/cancel`, { reason }), close: (id) => post(`/purchase-orders/${id}/close`),
  receive: (id, b) => post(`/purchase-orders/${id}/receive`, b),
  payables: (q) => get('/payables', q), payable: (id) => get(`/payables/${id}`), pay: (id, b) => post(`/payables/${id}/payments`, b), methods: () => get('/payment-methods'),
};
