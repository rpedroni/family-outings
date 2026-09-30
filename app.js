'use strict';

const STORAGE_KEY = 'out-and-together.shortlist.v1';
const VISITED_KEY = 'out-and-together.visited.v1';
const COMPLETED_KEY = 'out-and-together.completed.v2';
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
let completed = new Set(['parque-barigui--visit']);
let persistent = true;

function normalize(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function storageWarning() {
  persistent = false;
  document.querySelector('#storage-note').textContent = 'O armazenamento deste dispositivo está indisponível. Nossa lista e as atividades feitas só serão mantidas enquanto esta página estiver aberta.';
}
try {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (!Array.isArray(raw) || !raw.every(id => typeof id === 'string')) throw new Error('Lista de lugares inválida');
  saved = new Set(raw);
} catch (_) {
  storageWarning();
}
try {
  const stored = localStorage.getItem(COMPLETED_KEY);
  const legacy = localStorage.getItem(VISITED_KEY);
  const value = JSON.parse(stored ?? legacy ?? '["parque-barigui"]');
  if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) throw new Error('Lista de atividades inválida');
  // An explicit [] is a deliberate undo. Migrate only generic visits, never events.
  completed = new Set(stored !== null ? value : value.map(id => `${id}--visit`));
  if (stored === null) localStorage.setItem(COMPLETED_KEY, JSON.stringify([...completed]));
} catch (_) { storageWarning(); }
function persistCompleted() {
  if (!persistent) return;
  try { localStorage.setItem(COMPLETED_KEY, JSON.stringify([...completed])); } catch (_) { storageWarning(); }
}
function placeActivities(item) {
  return item.activities ?? [{ id: `${item.id}--visit`, title: 'Visita ao local', description: item.description,
    updatedAt: item.updatedAt || item.checkedAt, checkedAt: item.checkedAt, url: item.url,
    kind: 'visit', startsAt: null, endsAt: null }];
}
function focusActivity(id) {
  const target = [...document.querySelectorAll('[data-activity-id]')].find(node => node.dataset.activityId === id && !node.closest('[hidden]'));
  const place = activities.find(item => placeActivities(item).some(activity => activity.id === id));
  const archive = [...document.querySelectorAll('#archive-list a')].find(link => link.hash === `#place=${encodeURIComponent(place?.id)}`);
  (target?.querySelector('button') || archive || document.querySelector('#results')).focus({ preventScroll: true });
}
function expired(activity, now = new Date()) {
  if (activity.kind !== 'event') return false;
  const end = activity.endsAt || activity.startsAt;
  if (!end) return false;
  // Date-only events run through the named day in Curitiba, not UTC midnight.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return end < today;
}
function pendingActivity(activity) {
  return !completed.has(activity.id) && !expired(activity);
}
function toggleActivity(activity) {
  if (completed.has(activity.id)) completed.delete(activity.id); else completed.add(activity.id);
  persistCompleted();
  document.querySelector('#announcement').textContent = `${activity.title}: ${completed.has(activity.id) ? 'marcada como feita' : 'conclusão desfeita'}.`;
  render();
  focusActivity(activity.id);
}
function activityRow(activity, detail = false) {
  const row = element('li', 'activity-row');
  row.dataset.activityId = activity.id;
  const info = element('div', 'activity-info');
  info.append(element('strong', '', activity.title));
  if (completed.has(activity.id)) info.append(element('span', 'tag', 'Feita'));
  if (activity.kind === 'event') {
    const dates = [activity.startsAt, activity.endsAt].filter(Boolean).map(formatDate).join(' — ');
    info.append(element('p', 'activity-dates', `${expired(activity) ? 'Encerrada' : dates ? 'Período' : 'Data a confirmar'}${dates ? ': ' + dates : ''}`));
  }
  if (detail) {
    info.append(element('p', 'description', activity.description));
    const source = element('a', 'source-link', 'Consultar fonte da atividade ↗');
    source.href = activity.url;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.setAttribute('aria-label', `Consultar fonte da atividade: ${activity.title} (abre em uma nova aba)`);
    info.append(source, element('p', 'checked', `Consultada em ${formatDate(activity.checkedAt)} · Atualizada em ${formatDate(activity.updatedAt)}`));
  }
  row.append(info);
  const button = element('button', 'visited-button', completed.has(activity.id) ? 'Desfazer' : expired(activity) ? 'Registrar no histórico' : 'Já fizemos');
  button.type = 'button';
  button.setAttribute('aria-label', `${completed.has(activity.id) ? 'Desfazer atividade' : expired(activity) ? 'Registrar que fizemos' : 'Marcar como feita'}: ${activity.title}`);
  button.addEventListener('click', () => toggleActivity(activity));
  row.append(button);
  return row;
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function validDate(value, dateOnly = false) {
  if (typeof value !== 'string') return false;
  const pattern = dateOnly ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/;
  if (!pattern.test(value) || value.startsWith('0000-') || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10);
  return new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day;
}
function validateRecords(data) {
  if (!Array.isArray(data)) throw new Error('O catálogo deve ser uma lista JSON.');
  const ids = new Set();
  const activityIds = new Set();
  const textFields = ['id', 'name', 'city', 'description', 'url', 'checkedAt', 'crowdNote', 'logisticsNote'];
  data.forEach((item, index) => {
    if (!item || textFields.some(key => typeof item[key] !== 'string' || !item[key].trim())) {
      throw new Error(`O passeio ${index + 1} tem um campo de texto ausente ou inválido.`);
    }
    if (ids.has(item.id)) throw new Error(`Identificador de passeio duplicado: ${item.id}`);
    ids.add(item.id);
    if (item.updatedAt !== undefined && !validDate(item.updatedAt)) throw new Error('Data de atualização do lugar inválida.');
    if (item.activities !== undefined && !Array.isArray(item.activities)) throw new Error('As atividades devem ser uma lista.');
    for (const activity of placeActivities(item)) {
      if (!activity || ['id', 'title', 'description', 'url'].some(key => typeof activity[key] !== 'string' || !activity[key].trim())) throw new Error('Atividade com campos de texto inválidos.');
      if (activityIds.has(activity.id)) throw new Error(`Identificador de atividade duplicado: ${activity.id}`);
      activityIds.add(activity.id);
      if (!['http:', 'https:'].includes(new URL(activity.url).protocol)) throw new Error('Fonte da atividade inválida.');
      if (!['visit', 'event'].includes(activity.kind)) throw new Error('Tipo de atividade inválido.');
      if (!validDate(activity.updatedAt) || !validDate(activity.checkedAt)) throw new Error('Data da atividade inválida.');
      for (const key of ['startsAt', 'endsAt']) {
        if (activity[key] !== null && !validDate(activity[key], true)) throw new Error('Período da atividade inválido.');
      }
      if (activity.startsAt && activity.endsAt && activity.endsAt < activity.startsAt) throw new Error('O fim da atividade antecede o início.');
    }
    for (const key of fieldNames) {
      if (!Object.hasOwn(labels[key], item[key])) throw new Error(`O passeio ${index + 1} tem um valor inválido no campo ${key}.`);
    }
    const url = new URL(item.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Os links das fontes devem usar HTTP ou HTTPS.');
    if (!validDate(item.checkedAt)) {
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
  const haystack = normalize([item.name, item.city, item.description, item.crowdNote, item.logisticsNote, labels.category[item.category],
    ...placeActivities(item).flatMap(activity => [activity.title, activity.description])].join(' '));
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
  button.setAttribute('aria-label', `${isSaved ? 'Remover' : 'Salvar'} ${item.name} ${isSaved ? 'da' : 'na'} nossa lista`);
  button.querySelector('span').textContent = isSaved ? 'Salvo' : 'Salvar';
}
// Static icons only; catalog text always enters the DOM through textContent.
const icons = {
  park: '<path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z"/><path d="M12 22v-3"/>',
  museum: '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M12 2 20 7H4z"/>',
  farm: '<path d="M3 21V9l9-6 9 6v12z"/><path d="M9 21v-6h6v6"/><path d="M9 11h6"/>',
  zoo: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
  show: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
  pin: '<path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>'
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
}
function cover(item) {
  const figure = element('figure', 'card-cover');
  figure.dataset.category = item.category;
  const art = element('div', 'cover-art');
  art.innerHTML = icon(item.category);
  figure.append(art);
  if (item.photo && typeof item.photo.url === 'string' && item.photo.url.startsWith('https://')) {
    const image = element('img');
    image.alt = item.photo.alt || item.name;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    const caption = element('figcaption');
    image.addEventListener('error', () => { image.remove(); caption.remove(); }, { once: true });
    image.src = item.photo.url;
    const source = typeof item.photo.sourceUrl === 'string' && /^https?:\/\//.test(item.photo.sourceUrl) ? item.photo.sourceUrl : item.url;
    const credit = element('a', 'photo-credit', `Foto: ${item.photo.credit || item.name} ↗`);
    credit.href = source;
    credit.target = '_blank';
    credit.rel = 'noopener noreferrer';
    credit.setAttribute('aria-label', `Fonte da foto: ${item.photo.credit || item.name} (abre em uma nova aba)`);
    caption.append(credit);
    figure.append(image, caption);
  }
  return figure;
}
function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}
function materialUpdate(item) {
  // checkedAt is only a fallback for old, unmigrated catalogs.
  return Math.max(Date.parse(item.updatedAt || item.checkedAt), ...placeActivities(item).map(activity => Date.parse(activity.updatedAt)));
}
function placeLink(item, text = item.name) {
  const link = element('a', 'place-link', text);
  link.href = `#place=${encodeURIComponent(item.id)}`;
  link.setAttribute('aria-label', `Ver lugar: ${item.name}`);
  return link;
}
function selectedPlaceId() {
  if (!location.hash.startsWith('#place=')) return null;
  try { return decodeURIComponent(location.hash.slice(7)); } catch (_) { return ''; }
}
let lastPlaceId = selectedPlaceId();
function renderDetail() {
  const id = selectedPlaceId();
  const detail = document.querySelector('#place-detail');
  detail.hidden = id === null;
  results.hidden = id !== null;
  document.querySelector('.browse').hidden = id !== null;
  document.querySelector('.skip-link').href = id === null ? '#results' : '#place-detail';
  detail.replaceChildren();
  document.title = 'Passeios · Família Alcantara Pedroni';
  if (id === null) return;
  const back = element('a', 'back-link', 'Voltar aos lugares');
  back.href = '#results';
  detail.append(back);
  const item = activities.find(place => place.id === id);
  if (item) {
    detail.append(card(item, true));
    document.title = `${item.name} · Nossos passeios`;
  } else {
    const heading = element('h2', '', 'Lugar não encontrado');
    heading.tabIndex = -1;
    detail.append(heading, element('p', '', 'O link pode estar desatualizado. Volte ao guia para encontrar outro lugar.'));
  }
}
function card(item, detail = false) {
  const article = element('article', 'activity-card');
  article.dataset.id = item.id;
  const top = element('div', 'card-top');
  top.append(element('span', 'category-label', labels.category[item.category]));
  const button = element('button', 'save-button');
  button.type = 'button';
  button.innerHTML = '<svg viewBox="0 0 18 22" aria-hidden="true"><path d="M3 2h12v18l-6-4-6 4z"/></svg><span></span>';
  updateSaveButton(button, item);
  button.addEventListener('click', () => {
    if (saved.has(item.id)) saved.delete(item.id); else saved.add(item.id);
    if (persistent) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...saved])); } catch (_) { storageWarning(); }
    }
    updateSavedCount();
    document.querySelector('#announcement').textContent = `${saved.has(item.id) ? 'Adicionado à nossa lista' : 'Removido da nossa lista'}: ${item.name}.`;
    if (document.querySelector('#saved-only').checked) {
      render();
      document.querySelector('#saved-only').focus();
    } else updateSaveButton(button, item);
  });
  top.append(button);
  const city = element('p', 'city');
  city.innerHTML = icon('pin');
  city.append(element('span', '', `${item.city} · ${labels.area[item.area]}`));
  const body = element('div', 'card-body');
  const tags = element('div', 'tags');
  tags.append(element('span', 'tag', labels.setting[item.setting]), element('span', 'tag', labels.cost[item.cost]));
  const heading = element(detail ? 'h2' : 'h3');
  if (detail) { heading.textContent = item.name; heading.tabIndex = -1; }
  else heading.append(placeLink(item));
  body.append(heading, city, tags, element('p', 'description', item.description));
  const more = element('details', 'more');
  more.open = detail;
  const dl = element('dl', 'details');
  dl.append(element('dt', '', 'Movimento e horários'), element('dd', '', item.crowdNote), element('dt', '', 'Informações práticas'), element('dd', '', item.logisticsNote));
  more.append(element('summary', '', 'Horários, preços e movimento'), dl);
  body.append(more);
  const bottom = element('div', 'card-bottom');
  const source = element('div', 'source');
  const link = element('a', 'source-link', 'Consultar fonte ↗');
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `Consultar fonte sobre ${item.name} (abre em uma nova aba)`);
  const checked = element('span', 'checked', 'Consultada em ');
  const time = element('time', '', formatDate(item.checkedAt));
  time.dateTime = item.checkedAt;
  checked.append(time);
  source.append(link, checked);
  bottom.append(source);
  const list = element('ul', 'place-activities');
  list.append(...placeActivities(item).filter(activity => detail || pendingActivity(activity)).map(activity => activityRow(activity, detail)));
  if (detail) body.append(element('h3', 'activities-heading', 'Atividades neste lugar'));
  body.append(bottom, list);
  article.append(cover(item), top, body);
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
function visitedRow(item, activity) {
  const row = element('li', 'visited-row');
  row.dataset.id = item.id;
  row.dataset.activityId = activity.id;
  const info = element('div', 'visited-info');
  const name = placeLink(item);
  name.classList.add('visited-name');
  info.append(name, element('span', 'visited-city', activity.title));
  if (expired(activity)) info.append(element('span', 'checked', 'Encerrada'));
  const undo = element('button', 'visited-button', 'Desfazer');
  undo.type = 'button';
  undo.setAttribute('aria-label', `Desfazer atividade: ${activity.title} — ${item.name}`);
  undo.addEventListener('click', () => toggleActivity(activity));
  row.append(info, undo);
  return row;
}
function render() {
  if (!loaded) return;
  const filters = readFilters();
  const visible = activities.filter(item => matches(item, filters)).sort((a, b) => materialUpdate(b) - materialUpdate(a));
  const active = visible.filter(item => placeActivities(item).some(pendingActivity));
  grid.replaceChildren(...active.map(item => card(item)));
  const archived = visible.filter(item => !active.includes(item) && (!placeActivities(item).length || placeActivities(item).some(activity => !completed.has(activity.id))));
  document.querySelector('#archive-list').replaceChildren(...archived.map(item => {
    const row = element('li');
    row.append(placeLink(item));
    return row;
  }));
  document.querySelector('#archive-section').hidden = archived.length === 0;
  const done = visible.flatMap(item => placeActivities(item).filter(activity => completed.has(activity.id)).map(activity => visitedRow(item, activity)));
  document.querySelector('#visited-list').replaceChildren(...done);
  document.querySelector('#visited-section').hidden = done.length === 0;
  document.querySelector('#visited-count').textContent = String(done.length);
  count.textContent = `${visible.length} ${visible.length === 1 ? 'lugar' : 'lugares'}${filters.savedOnly ? ' na nossa lista' : ` de ${activities.length}`}`;
  state.hidden = visible.length > 0;
  if (!visible.length) {
    if (!activities.length) showState('UMA PÁGINA EM BRANCO, POR ENQUANTO', 'O guia está esperando novos lugares.', 'Adicione passeios com informações verificadas ao arquivo activities.json e recarregue o guia.', 'Recarregar guia', load);
    else if (filters.savedOnly && !activities.some(item => saved.has(item.id))) showState('NOSSOS FAVORITOS', 'Nossa lista começa aqui.', 'Salvem lugares do guia e encontrem todos aqui quando precisarem de uma ideia.', 'Explorar todos os lugares', reset);
    else showState('QUE TAL OUTRO CAMINHO?', 'Nenhum lugar encontrado.', 'Tente uma busca mais ampla, escolha outro ambiente ou limpe os filtros para ver o guia completo.', 'Limpar filtros', reset);
  }
  updateSavedCount();
  renderDetail();
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
window.addEventListener('hashchange', () => {
  if (!loaded) return;
  render();
  const id = selectedPlaceId();
  if (id !== null) document.querySelector('#place-detail h2')?.focus();
  else {
    const link = [...document.querySelectorAll('.place-link')].find(node => node.hash === `#place=${encodeURIComponent(lastPlaceId)}`);
    (link || results).focus({ preventScroll: true });
  }
  lastPlaceId = id;
});
document.querySelector('.skip-link').addEventListener('click', event => {
  if (selectedPlaceId() === null) return;
  event.preventDefault();
  document.querySelector('#place-detail h2')?.focus();
});
form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', render);
document.querySelector('#reset').addEventListener('click', reset);
window.addEventListener('storage', event => {
  if (![STORAGE_KEY, COMPLETED_KEY, null].includes(event.key)) return;
  if (!persistent) return;
  try {
    for (const key of event.key === null ? [STORAGE_KEY, COMPLETED_KEY] : [event.key]) {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) continue;
      if (key === STORAGE_KEY) saved = new Set(value); else completed = new Set(value);
    }
    render();
    updateSavedCount();
  } catch (_) { /* Ignore malformed data from another tab. */ }
});
updateSavedCount();
load();
