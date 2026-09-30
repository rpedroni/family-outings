'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../activities.json'), 'utf8'));
// Browser shell only: all model functions below execute the real app.js.
function model() {
  const node = { addEventListener() {}, setAttribute() {}, replaceChildren() {}, append() {} };
  const context = vm.createContext({ URL, Intl, console, AbortController,
    document: { querySelector: () => ({ ...node }), createElement: () => ({ ...node }) },
    window: { addEventListener() {} }, location: { hash: '' },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: () => new Promise(() => {}), setTimeout: () => 0, clearTimeout() {} });
  vm.runInContext(source, context);
  return (expression, data) => { context.data = data; return vm.runInContext(expression, context); };
}
function record() {
  const place = structuredClone(catalog[0]);
  place.updatedAt = '2026-09-01';
  place.activities = [{ id: place.id+'--visit', title: 'Visita ao local', description: 'Test only', updatedAt: place.updatedAt,
    checkedAt: '2026-09-30', url: 'https://example.invalid/', kind: 'visit', startsAt: null, endsAt: null }];
  return place;
}
test('expiry includes the entire final day in America/Sao_Paulo, independently of UTC', () => {
  const run = model();
  const event = { kind: 'event', startsAt: '2026-09-29', endsAt: '2026-09-30' };
  for (const [now, expected] of [
    ['2026-09-30T23:59:59Z', false], ['2026-10-01T02:59:59.999Z', false],
    ['2026-10-01T03:00:00.000Z', true], ['2026-10-02T00:00:00Z', true],
  ]) assert.equal(run('expired(data.event, new Date(data.now))', { event, now }), expected, now);
  assert.equal(run('expired(data, new Date("2026-10-01T03:00:00Z"))', { ...event, endsAt: null, startsAt: '2026-09-30' }), true);
  assert.equal(run('expired(data, new Date("2099-01-01"))', { ...event, kind: 'visit' }), false);
  assert.equal(run('expired(data, new Date("2099-01-01"))', { kind: 'event', startsAt: null, endsAt: null }), false);
});

test('schema rejects invalid nested activities instead of rendering unsafe or ambiguous records', () => {
  const run = model();
  for (const change of [
    a => a.id = '', a => a.title = '', a => a.description = null,
    a => a.url = 'javascript:alert(1)', a => a.kind = 'other',
    a => a.updatedAt = '2026-02-30', a => a.checkedAt = 'yesterday',
    a => a.startsAt = '2026-02-30', a => { a.startsAt = '2027-01-02'; a.endsAt = '2027-01-01'; },
  ]) {
    const place = record(); change(place.activities[0]);
    assert.throws(() => run('validateRecords(data)', [place]));
  }
  const place = record(); place.activities.push({ ...place.activities[0] });
  assert.throws(() => run('validateRecords(data)', [place]));
  const second = record(); second.id = 'different-place';
  assert.throws(() => run('validateRecords(data)', [record(), second]));
  for (const value of [null, {}, 'wrong']) {
    const place = record(); place.activities = value;
    assert.throws(() => run('validateRecords(data)', [place]));
  }
  const badDate = record(); badDate.updatedAt = 'not-a-date';
  assert.throws(() => run('validateRecords(data)', [badDate]));
});
