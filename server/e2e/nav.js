'use strict';
/** Navega por el menú superior: abre el grupo desplegable si el enlace está oculto (en móvil el panel ya lo muestra). */
async function clickNav(page, label) {
  const link = page.locator(`a.nav-link:has-text("${label}"), a.nav-top:has-text("${label}")`).first();
  if (!(await link.isVisible())) await link.locator('xpath=ancestor::div[contains(@class,"nav-group")]').locator('.nav-group-btn').click();
  await link.click();
}
module.exports = { clickNav };
