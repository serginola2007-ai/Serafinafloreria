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
