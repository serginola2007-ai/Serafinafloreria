'use strict';
/**
 * Adaptadores de integraciones externas. Las credenciales SOLO se leen de variables de entorno del servidor.
 * Hoy NINGUNA está implementada: el sistema reporta honestamente "no configurada" / "no implementada" y jamás
 * devuelve datos de ejemplo. Cada adaptador real (fases 7) implementa fetchMetrics() con la API oficial.
 */
const { AppError } = require('../../lib/errors');

const PROVIDERS = [
  { id: 'ga4', label: 'Google Analytics 4', group: 'google', env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GA4_PROPERTY_ID'] },
  { id: 'search_console', label: 'Google Search Console', group: 'google', env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GSC_SITE_URL'] },
  { id: 'business_profile', label: 'Google Business Profile', group: 'google', env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GBP_ACCOUNT_ID'] },
  { id: 'facebook', label: 'Facebook (Meta)', group: 'meta', env: ['META_APP_ID', 'META_APP_SECRET', 'META_PAGE_ID'] },
  { id: 'instagram', label: 'Instagram (Meta)', group: 'meta', env: ['META_APP_ID', 'META_APP_SECRET', 'IG_BUSINESS_ID'] },
  { id: 'whatsapp', label: 'WhatsApp Business', group: 'meta', env: ['WHATSAPP_PHONE_ID', 'WHATSAPP_TOKEN', 'WHATSAPP_VERIFY_TOKEN'] },
];

class IntegrationAdapter {
  constructor(def, env) { this.def = def; this.env = env; }
  get missingEnv() { return this.def.env.filter((k) => !this.env[k]); }
  get status() { return this.missingEnv.length ? 'not_configured' : 'credentials_present'; }
  /** Las implementaciones reales sobreescriben este método. */
  async fetchMetrics() {
    if (this.missingEnv.length) throw new AppError(409, 'INTEGRATION_NOT_CONFIGURED', `${this.def.label} no está configurada`, { missingEnv: this.missingEnv });
    throw new AppError(501, 'INTEGRATION_NOT_IMPLEMENTED', `El adaptador de ${this.def.label} todavía no está implementado`);
  }
  describe() {
    return { id: this.def.id, label: this.def.label, group: this.def.group, status: this.status, implemented: false, missingEnv: this.missingEnv };
  }
}

const createRegistry = (env = process.env) => new Map(PROVIDERS.map((p) => [p.id, new IntegrationAdapter(p, env)]));
module.exports = { createRegistry, PROVIDERS, IntegrationAdapter };
