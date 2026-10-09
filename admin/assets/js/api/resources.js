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

export const customersApi = {
  list: (q) => get('/customers', q), get: (id) => get(`/customers/${id}`), create: (b) => post('/customers', b), update: (id, b) => patch(`/customers/${id}`, b), archive: (id) => del(`/customers/${id}`),
  addAddress: (id, b) => post(`/customers/${id}/addresses`, b), updateAddress: (aid, b) => patch(`/customer-addresses/${aid}`, b), removeAddress: (aid) => del(`/customer-addresses/${aid}`),
  addDate: (id, b) => post(`/customers/${id}/dates`, b), removeDate: (did) => del(`/customer-dates/${did}`), upcoming: (days = 30) => get('/customers/upcoming-dates', { days }),
};
export const recipientsApi = { list: (q) => get('/recipients', q), create: (b) => post('/recipients', b), update: (id, b) => patch(`/recipients/${id}`, b), archive: (id) => del(`/recipients/${id}`) };
export const recipesApi = {
  get: (variantId) => get(`/variants/${variantId}/recipe`), save: (variantId, b) => put(`/variants/${variantId}/recipe`, b),
  copyFrom: (variantId, sourceVariantId, factor = 1) => post(`/variants/${variantId}/recipe/copy-from`, { sourceVariantId, factor }), costing: (productId) => get(`/products/${productId}/costing`),
};
export const cashApi = {
  current: () => get('/cash/current'), open: (openingAmountPyg) => post('/cash/open', { openingAmountPyg }), close: (b) => post('/cash/close', b),
  move: (b) => post('/cash/movements', b), sessions: (q) => get('/cash/sessions', q), session: (id) => get(`/cash/sessions/${id}`),
};
export const salesApi = {
  catalog: (q) => get('/pos/catalog', q), create: (b) => post('/sales', b), list: (q) => get('/sales', q), get: (id) => get(`/sales/${id}`),
  void: (id, reason) => post(`/sales/${id}/void`, { reason }), pay: (id, b) => post(`/sales/${id}/payments`, b), receivables: (q) => get('/receivables', q),
};

export const ordersApi = {
  list: (q) => get('/orders', q), get: (id) => get(`/orders/${id}`), create: (b) => post('/orders', b), update: (id, b) => put(`/orders/${id}`, b),
  confirm: (id) => post(`/orders/${id}/confirm`), transition: (id, to, note) => post(`/orders/${id}/transition`, { to, note }), pay: (id, b) => post(`/orders/${id}/payments`, b),
  cancel: (id, b) => post(`/orders/${id}/cancel`, b), complete: (id, b) => post(`/orders/${id}/complete`, b ?? {}), demand: () => get('/orders/demand'),
  zones: () => get('/delivery-zones'), createZone: (b) => post('/delivery-zones', b), updateZone: (id, b) => patch(`/delivery-zones/${id}`, b),
};
export const productionApi = {
  list: (q) => get('/production', q), get: (id) => get(`/production/${id}`), start: (id) => post(`/production/${id}/start`), quality: (id) => post(`/production/${id}/quality`),
  approve: (id) => post(`/production/${id}/approve`), reject: (id, note) => post(`/production/${id}/reject`, { note }), checklist: (id, code, done) => put(`/production/${id}/checklist/${code}`, { done }),
  assign: (id, userId) => put(`/production/${id}/assignee`, { userId }),
};
export const deliveryApi = {
  list: (q) => get('/deliveries', q), get: (id) => get(`/deliveries/${id}`), assign: (id, courierId) => post(`/deliveries/${id}/assign`, { courierId }), start: (id) => post(`/deliveries/${id}/start`),
  deliver: (id, b) => post(`/deliveries/${id}/deliver`, b ?? {}), fail: (id, reason) => post(`/deliveries/${id}/fail`, { reason }), reschedule: (id, b) => post(`/deliveries/${id}/reschedule`, b),
  couriers: () => get('/delivery-couriers'), uploadProof: (id, file) => { const f = new FormData(); f.append('file', file); return post(`/deliveries/${id}/proof`, undefined, { form: f }); }, proofUrl: (id) => get(`/deliveries/${id}/proof`), routes: (q) => get('/delivery-routes', q), createRoute: (b) => post('/delivery-routes', b),
};
