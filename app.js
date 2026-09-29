'use strict';

const STORAGE_KEY = 'out-and-together.shortlist.v1';
const VISITED_KEY = 'out-and-together.visited.v1';
const labels = {
  category: { park: 'Parque', museum: 'Museu', farm: 'Fazenda', zoo: 'Zoológico', show: 'Espetáculo' },
  area: { curitiba: 'Em Curitiba', nearby: 'Na região' },
  setting: { outdoor: 'Ao ar livre', indoor: 'Em local fechado', mixed: 'Áreas internas e externas' },
  cost: { free: 'Entrada gratuita', paid: 'Entrada paga', unknown: 'Consultar valores' }
};
const fieldNames = ['category', 'area', 'setting', 'cost'];
const form = document.querySelector('#filters');
const grid = document.querySelector('#activity-grid');
const state = document.querySelector('#state');
const count = document.querySelector('#result-count');
const results = document.querySelector('#results');
let activities = [];
let loaded = false;
let saved = new Set();
let visited = new Set(['parque-barigui']);
let persistent = true;

function normalize(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function storageWarning() {
  persistent = false;
  document.querySelector('#storage-note').textContent = 'O armazenamento deste dispositivo está indisponível. Sua lista e os lugares visitados só serão mantidos enquanto esta página estiver aberta.';
}
try {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (!Array.isArray(raw) || !raw.every(id => typeof id === 'string')) throw new Error('Lista de lugares inválida');
  saved = new Set(raw);
} catch (_) {
  storageWarning();
}
try {
  const stored = localStorage.getItem(VISITED_KEY);
  if (stored !== null) {
    const value = JSON.parse(stored);
    if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) throw new Error('Lista de visitas inválida');
    visited = new Set(value);
  } else {
    localStorage.setItem(VISITED_KEY, JSON.stringify([...visited]));
  }
} catch (_) { storageWarning(); }
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function validateRecords(data) {
  if (!Array.isArray(data)) throw new Error('O catálogo deve ser uma lista JSON.');
  const ids = new Set();
  const textFields = ['id', 'name', 'city', 'description', 'url', 'checkedAt', 'crowdNote', 'logisticsNote'];
  data.forEach((item, index) => {
    if (!item || textFields.some(key => typeof item[key] !== 'string' || !item[key].trim())) {
      throw new Error(`O passeio ${index + 1} tem um campo de texto ausente ou inválido.`);
    }
    if (ids.has(item.id)) throw new Error(`Identificador de passeio duplicado: ${item.id}`);
    ids.add(item.id);
    for (const key of fieldNames) {
      if (!Object.hasOwn(labels[key], item[key])) throw new Error(`O passeio ${index + 1} tem um valor inválido no campo ${key}.`);
    }
    const url = new URL(item.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Os links das fontes devem usar HTTP ou HTTPS.');
    const date = new Date(`${item.checkedAt}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.checkedAt) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== item.checkedAt) {
      throw new Error(`O passeio ${index + 1} tem uma data de consulta inválida.`);
    }
  });
  return data;
}
function readFilters() {
  return {
    search: normalize(document.querySelector('#search').value),
    savedOnly: document.querySelector('#saved-only').checked,
    ...Object.fromEntries(fieldNames.map(key => [key, document.getElementById(key).value]))
  };
}
function matches(item, filters) {
  const haystack = normalize([item.name, item.city, item.description, item.crowdNote, item.logisticsNote, labels.category[item.category]].join(' '));
  return (!filters.search || filters.search.split(/\s+/).every(term => haystack.includes(term))) &&
    (!filters.savedOnly || saved.has(item.id)) &&
    fieldNames.every(key => filters[key] === 'all' || item[key] === filters[key]);
}
function updateSavedCount() {
  const total = loaded ? activities.filter(item => saved.has(item.id)).length : saved.size;
  document.querySelector('#saved-count').textContent = `(${total})`;
}
function updateSaveButton(button, item) {
  const isSaved = saved.has(item.id);
  button.setAttribute('aria-pressed', String(isSaved));
  button.setAttribute('aria-label', `${isSaved ? 'Remover' : 'Salvar'} ${item.name} ${isSaved ? 'da' : 'na'} sua lista`);
  button.querySelector('span').textContent = isSaved ? 'Salvo' : 'Salvar';
}
function card(item) {
  const article = element('article', 'activity-card');
  article.dataset.id = item.id;
  article.classList.toggle('is-visited', visited.has(item.id));
  const top = element('div', 'card-top');
  top.append(element('span', 'category-label', labels.category[item.category]));
  const button = element('button', 'save-button');
  button.type = 'button';
  // Static icon only; catalog text always enters the DOM through textContent.
  button.innerHTML = '<svg viewBox="0 0 18 22" aria-hidden="true"><path d="M3 2h12v18l-6-4-6 4z"/></svg><span></span>';
  updateSaveButton(button, item);
  button.addEventListener('click', () => {
    if (saved.has(item.id)) saved.delete(item.id); else saved.add(item.id);
    if (persistent) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...saved])); } catch (_) { storageWarning(); }
    }
    updateSavedCount();
    document.querySelector('#announcement').textContent = `${saved.has(item.id) ? 'Adicionado à sua lista' : 'Removido da sua lista'}: ${item.name}.`;
    if (document.querySelector('#saved-only').checked) {
      render();
      document.querySelector('#saved-only').focus();
    } else updateSaveButton(button, item);
  });
  top.append(button);
  article.append(top, element('h3', '', item.name), element('p', 'city', `${item.city} · ${labels.area[item.area]}`));
  const visitButton = element('button', 'visited-button', visited.has(item.id) ? 'Já fomos · Desfazer' : 'Já fomos');
  visitButton.type = 'button';
  visitButton.setAttribute('aria-pressed', String(visited.has(item.id)));
  visitButton.setAttribute('aria-label', `${visited.has(item.id) ? 'Marcar como não visitado' : 'Marcar como visitado'}: ${item.name}`);
  visitButton.addEventListener('click', () => {
    if (visited.has(item.id)) visited.delete(item.id); else visited.add(item.id);
    if (persistent) {
      try { localStorage.setItem(VISITED_KEY, JSON.stringify([...visited])); } catch (_) { storageWarning(); }
    }
    document.querySelector('#announcement').textContent = `${item.name}: ${visited.has(item.id) ? 'marcado como visitado. Agora aparece depois dos lugares ainda não visitados' : 'marcado como não visitado'}.`;
    render();
    [...grid.children].find(node => node.dataset.id === item.id)?.querySelector('.visited-button').focus({ preventScroll: true });
  });
  article.append(visitButton);
  const body = element(visited.has(item.id) ? 'details' : 'div', 'card-body');
  if (visited.has(item.id)) body.append(element('summary', '', 'Ver detalhes do passeio'));
  if (item.photo && typeof item.photo.url === 'string' && item.photo.url.startsWith('https://')) {
    const figure = element('figure', 'venue-photo');
    const image = element('img');
    image.alt = item.photo.alt || item.name;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => figure.remove(), { once: true });
    image.src = item.photo.url;
    const caption = element('figcaption');
    const credit = element('a', 'photo-credit', `Foto: ${item.photo.credit || item.name} ↗`);
    credit.href = item.url;
    credit.target = '_blank';
    credit.rel = 'noopener noreferrer';
    credit.setAttribute('aria-label', `Fonte da foto: ${item.photo.credit || item.name} (abre em uma nova aba)`);
    caption.append(credit);
    figure.append(image, caption);
    body.append(figure);
  }
  const tags = element('div', 'tags');
  tags.append(element('span', 'tag', labels.setting[item.setting]), element('span', 'tag', labels.cost[item.cost]));
  body.append(tags, element('p', 'description', item.description));
  const details = element('dl', 'details');
  details.append(element('dt', '', 'Movimento e horários'), element('dd', '', item.crowdNote), element('dt', '', 'Informações práticas'), element('dd', '', item.logisticsNote));
  body.append(details);
  const bottom = element('div', 'card-bottom');
  const link = element('a', 'source-link', 'Consultar fonte ↗');
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `Consultar fonte sobre ${item.name} (abre em uma nova aba)`);
  const checked = element('span', 'checked', 'Fonte consultada em');
  const time = element('time', '', new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${item.checkedAt}T12:00:00Z`)));
  time.dateTime = item.checkedAt;
  checked.append(time);
  bottom.append(link, checked);
  body.append(bottom);
  article.append(body);
  return article;
}
function showState(kicker, title, message, buttonText, action) {
  state.replaceChildren(element('p', 'eyebrow', kicker), element('h3', '', title), element('p', '', message));
  if (buttonText) {
    const button = element('button', '', buttonText);
    button.type = 'button';
    button.addEventListener('click', action);
    state.append(button);
  }
  state.hidden = false;
}
function reset() {
  form.reset();
  if (loaded) render();
  document.querySelector('#search').focus();
}
function render() {
  if (!loaded) return;
  const filters = readFilters();
  const visible = activities.filter(item => matches(item, filters)).sort((a, b) => Number(visited.has(a.id)) - Number(visited.has(b.id)));
  grid.replaceChildren(...visible.map(card));
  count.textContent = `${visible.length} ${visible.length === 1 ? 'lugar' : 'lugares'}${filters.savedOnly ? ' na sua lista' : ` de ${activities.length}`}`;
  state.hidden = visible.length > 0;
  if (!visible.length) {
    if (!activities.length) showState('UMA PÁGINA EM BRANCO, POR ENQUANTO', 'O guia está esperando novos lugares.', 'Adicione passeios com informações verificadas ao arquivo activities.json e recarregue o guia.', 'Recarregar guia', load);
    else if (filters.savedOnly && !activities.some(item => saved.has(item.id))) showState('SEUS LUGARES FAVORITOS', 'Sua lista começa aqui.', 'Salve lugares do guia e encontre todos aqui quando precisar de uma ideia.', 'Explorar todos os lugares', reset);
    else showState('QUE TAL OUTRO CAMINHO?', 'Nenhum lugar encontrado.', 'Tente uma busca mais ampla, escolha outro ambiente ou limpe os filtros para ver o guia completo.', 'Limpar filtros', reset);
  }
  updateSavedCount();
}
async function load() {
  loaded = false;
  results.setAttribute('aria-busy', 'true');
  grid.replaceChildren();
  count.textContent = 'Carregando o guia…';
  showState('QUASE TUDO PRONTO', 'Abrindo o guia de passeios…', 'Carregando os passeios do arquivo local.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('activities.json', { cache: 'no-cache', signal: controller.signal });
    if (!response.ok) throw new Error(`Falha ao buscar o catálogo (${response.status}).`);
    activities = validateRecords(await response.json());
    loaded = true;
    render();
  } catch (error) {
    console.error('Não foi possível carregar o guia de passeios:', error);
    count.textContent = 'Guia indisponível';
    showState('UM PEQUENO DESVIO', 'Não foi possível abrir o guia.', 'Confira se o arquivo activities.json está disponível e segue o formato documentado. Para usar o guia no computador, abra esta pasta por meio de um servidor web local, em vez de clicar duas vezes no arquivo HTML.', 'Tentar novamente', load);
  } finally {
    clearTimeout(timer);
    results.setAttribute('aria-busy', 'false');
  }
}
form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', render);
document.querySelector('#reset').addEventListener('click', reset);
window.addEventListener('storage', event => {
  if (![STORAGE_KEY, VISITED_KEY, null].includes(event.key)) return;
  if (!persistent) return;
  try {
    for (const key of event.key === null ? [STORAGE_KEY, VISITED_KEY] : [event.key]) {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) continue;
      if (key === STORAGE_KEY) saved = new Set(value); else visited = new Set(value);
    }
    render();
    updateSavedCount();
  } catch (_) { /* Ignore malformed data from another tab. */ }
});
updateSavedCount();
load();
