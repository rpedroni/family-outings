'use strict';

const STORAGE_KEY = 'out-and-together.shortlist.v1';
const labels = {
  category: { park: 'Park', museum: 'Museum', farm: 'Farm', zoo: 'Zoo', show: 'Show' },
  area: { curitiba: 'In Curitiba', nearby: 'Nearby' },
  setting: { outdoor: 'Outdoors', indoor: 'Indoors', mixed: 'Indoor & outdoor' },
  cost: { free: 'Free entry', paid: 'Paid entry', unknown: 'Check pricing' }
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
let persistent = true;

function normalize(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function storageWarning() {
  persistent = false;
  document.querySelector('#storage-note').textContent = 'Device storage is unavailable. Your shortlist will last only while this page is open.';
}
try {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (!Array.isArray(raw) || !raw.every(id => typeof id === 'string')) throw new Error('Invalid shortlist');
  saved = new Set(raw);
} catch (_) {
  storageWarning();
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function validateRecords(data) {
  if (!Array.isArray(data)) throw new Error('The catalog must be a JSON array.');
  const ids = new Set();
  const textFields = ['id', 'name', 'city', 'description', 'url', 'checkedAt', 'crowdNote', 'logisticsNote'];
  data.forEach((item, index) => {
    if (!item || textFields.some(key => typeof item[key] !== 'string' || !item[key].trim())) {
      throw new Error(`Activity ${index + 1} has a missing or invalid text field.`);
    }
    if (ids.has(item.id)) throw new Error(`Duplicate activity ID: ${item.id}`);
    ids.add(item.id);
    for (const key of fieldNames) {
      if (!Object.hasOwn(labels[key], item[key])) throw new Error(`Activity ${index + 1} has an invalid ${key}.`);
    }
    const url = new URL(item.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Source links must use HTTP or HTTPS.');
    const date = new Date(`${item.checkedAt}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.checkedAt) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== item.checkedAt) {
      throw new Error(`Activity ${index + 1} has an invalid checked date.`);
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
  button.setAttribute('aria-label', `${isSaved ? 'Remove' : 'Save'} ${item.name}${isSaved ? ' from' : ' to'} shortlist`);
  button.querySelector('span').textContent = isSaved ? 'Saved' : 'Save';
}
function card(item) {
  const article = element('article', 'activity-card');
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
    document.querySelector('#announcement').textContent = `${item.name} ${saved.has(item.id) ? 'added to' : 'removed from'} shortlist.`;
    if (document.querySelector('#saved-only').checked) {
      render();
      document.querySelector('#saved-only').focus();
    } else updateSaveButton(button, item);
  });
  top.append(button);
  article.append(top, element('h3', '', item.name), element('p', 'city', `${item.city} · ${labels.area[item.area]}`));
  const tags = element('div', 'tags');
  tags.append(element('span', 'tag', labels.setting[item.setting]), element('span', 'tag', labels.cost[item.cost]));
  article.append(tags, element('p', 'description', item.description));
  const details = element('dl', 'details');
  details.append(element('dt', '', 'Crowds & timing'), element('dd', '', item.crowdNote), element('dt', '', 'Plan the practicalities'), element('dd', '', item.logisticsNote));
  article.append(details);
  const bottom = element('div', 'card-bottom');
  const link = element('a', 'source-link', 'Visit source ↗');
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `Visit source for ${item.name} (opens in a new tab)`);
  const checked = element('span', 'checked', 'Source checked');
  const time = element('time', '', new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${item.checkedAt}T12:00:00Z`)));
  time.dateTime = item.checkedAt;
  checked.append(time);
  bottom.append(link, checked);
  article.append(bottom);
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
  const visible = activities.filter(item => matches(item, filters));
  grid.replaceChildren(...visible.map(card));
  count.textContent = `${visible.length} ${visible.length === 1 ? 'place' : 'places'}${filters.savedOnly ? ' in your shortlist' : ` of ${activities.length}`}`;
  state.hidden = visible.length > 0;
  if (!visible.length) {
    if (!activities.length) showState('A BLANK PAGE, FOR NOW', 'The guide is waiting for places.', 'Add verified activity records to activities.json, then reload the guide.', 'Reload guide', load);
    else if (filters.savedOnly && !activities.some(item => saved.has(item.id))) showState('YOUR OWN LITTLE COLLECTION', 'Your shortlist starts here.', 'Save places from the guide and find them here whenever you need an idea.', 'Explore all places', reset);
    else showState('TRY A DIFFERENT DIRECTION', 'No places match just yet.', 'Try a broader search, a different setting, or reset the filters to see the whole guide.', 'Reset filters', reset);
  }
  updateSavedCount();
}
async function load() {
  loaded = false;
  results.setAttribute('aria-busy', 'true');
  grid.replaceChildren();
  count.textContent = 'Loading the guide…';
  showState('GETTING READY', 'Opening the field guide…', 'Loading local activity records.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('activities.json', { cache: 'no-cache', signal: controller.signal });
    if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
    activities = validateRecords(await response.json());
    loaded = true;
    render();
  } catch (error) {
    console.error('Could not load the activity guide:', error);
    count.textContent = 'Guide unavailable';
    showState('A SMALL DETOUR', 'We couldn’t open the guide.', 'Make sure activities.json is available and follows the documented format. Open this folder through a local web server, rather than double-clicking the HTML file.', 'Try again', load);
  } finally {
    clearTimeout(timer);
    results.setAttribute('aria-busy', 'false');
  }
}
form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', render);
document.querySelector('#reset').addEventListener('click', reset);
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  if (!persistent) return;
  try {
    const value = JSON.parse(event.newValue || '[]');
    if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) return;
    saved = new Set(value);
    render();
    updateSavedCount();
  } catch (_) { /* Ignore malformed data from another tab. */ }
});
updateSavedCount();
load();
