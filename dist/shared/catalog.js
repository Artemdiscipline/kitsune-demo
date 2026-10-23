// Public catalogue only. Sources and verification notes live in /catalog-audit.json.
export const catalog = [
  ['14501338', 'Накрутка', 'Накрутки', 1500],
  ['14501335', 'Накрутка', 'Накрутки', 2200],
  ['14501329', 'Накрутка', 'Накрутки', 1600],
  ['14495089', 'Кластер', 'Кластеры', 2500],
  ['14495080', 'Кластер', 'Кластеры', 3000],
  ['14495073', 'Кластер', 'Кластеры', 3000],
  ['14495040', 'Кликер', 'Кликеры', 4000],
  ['14488779', 'Кликер с турмалином', 'Кликеры', 4000],
].map(([id, name, type, price]) => ({
  id, sku: id, name, type, price, currency: 'RUB',
  material: 'Титан ASTM F-136',
  size: null, thread: null, kit: null, variants: [],
  images: [`./assets/${id}.jpg`],
}));
