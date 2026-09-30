"""Local-only browser regression tests; synthetic events never enter the catalog."""
import functools
import http.server
import json
from pathlib import Path
import threading
import unittest
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
LEGACY = 'out-and-together.visited.v1'
COMPLETED = 'out-and-together.completed.v2'
SHORTLIST = 'out-and-together.shortlist.v1'

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

class UITest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/'
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context()
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        # All tests are deterministic/offline, no third-party requests or screenshots.
        self.page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(self.url) else route.abort())
        self.data = json.loads((ROOT / 'activities.json').read_text())
        for place in self.data:
            place.setdefault('updatedAt', place['checkedAt'])
            place.setdefault('activities', [dict(id=place['id']+'--visit', title='Visita ao local', description=place['description'], updatedAt=place['updatedAt'], checkedAt=place['checkedAt'], url=place['url'], kind='visit', startsAt=None, endsAt=None)])
        self.barigui = next(p for p in self.data if p['id'] == 'parque-barigui')
        self.page.route('**/activities.json', lambda route: route.fulfill(json=self.data))

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def seed(self, values):
        self.page.add_init_script('if (!sessionStorage.seeded) { for (const [k,v] of Object.entries('+json.dumps(values)+')) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.seeded="1"; }')

    def open(self, fragment=''):
        self.page.goto(self.url + fragment)
        expect(self.page.locator('#results')).to_have_attribute('aria-busy', 'false')

    def event(self, **overrides):
        return dict(dict(id='synthetic-test-event', title='Evento sintético de teste', description='Somente teste automatizado; não é um evento real.', updatedAt='2099-01-01', checkedAt='2099-01-01', url='https://example.invalid/test', kind='event', startsAt='2099-02-01', endsAt='2099-02-02'), **overrides)

    def test_storage_denied_keeps_activity_and_favorites_usable(self):
        self.page.add_init_script("Object.defineProperty(window, 'localStorage', {get() {throw new DOMException('Denied', 'SecurityError')}})")
        self.open()
        expect(self.page.locator('#storage-note')).to_contain_text('atividades')
        expect(self.page.locator('#storage-note')).to_contain_text('enquanto esta página estiver aberta')
        history = self.page.locator('#visited-list [data-activity-id="parque-barigui--visit"] button')
        history.focus()
        self.page.keyboard.press('Enter')
        card = self.page.locator('#activity-grid [data-id="parque-barigui"]')
        expect(card).to_be_visible()
        card.locator('.save-button').focus()
        self.page.keyboard.press('Space')
        expect(card.locator('.save-button')).to_have_attribute('aria-pressed', 'true')
        card.locator('.visited-button').focus()
        self.page.keyboard.press('Enter')
        expect(history).to_be_focused()
        self.page.keyboard.press('Space')
        expect(card.locator('.visited-button')).to_be_focused()

    def test_storage_write_denied_preserves_explicit_empty_and_session_changes(self):
        self.seed({COMPLETED: [], LEGACY: ['parque-barigui']})
        self.open()
        self.page.evaluate("() => { Storage.prototype.setItem = function() { throw new DOMException('Full', 'QuotaExceededError'); }; }")
        card = self.page.locator('#activity-grid [data-id="parque-barigui"]')
        expect(card).to_be_visible()
        card.locator('.visited-button').click()
        expect(self.page.locator('#storage-note')).to_contain_text('indisponível')
        history = self.page.locator('#visited-list [data-activity-id="parque-barigui--visit"] button')
        expect(history).to_be_focused()
        history.press('Enter')
        expect(card).to_be_visible()
        card.locator('.save-button').click()
        expect(card.locator('.save-button')).to_have_attribute('aria-pressed', 'true')
        self.assertEqual(self.page.evaluate('(key) => localStorage.getItem(key)', COMPLETED), '[]')

    def test_expiry_boundary_in_sao_paulo_browser(self):
        self.barigui['activities'].append(self.event(startsAt='2026-09-30', endsAt='2026-09-30'))
        self.page.clock.set_fixed_time('2026-10-01T02:59:59.999Z')
        self.open()
        event = self.page.locator('#activity-grid [data-activity-id="synthetic-test-event"]')
        expect(event).to_be_visible()
        self.page.clock.set_fixed_time('2026-10-01T03:00:00.000Z')
        self.page.locator('#search').fill('Barigui')
        expect(event).to_have_count(0)
        expect(self.page.locator('#archive-list')).to_contain_text(self.barigui['name'])

    def test_responsive_activity_detail_style_and_keyboard(self):
        self.barigui['activities'].append(self.event(title='Atividade com um título longo para testar a leitura em telas pequenas'))
        self.open()
        expect(self.page.locator('#visited-heading')).to_contain_text('Já fizemos')
        expect(self.page.locator('#storage-note')).to_contain_text('atividade')
        for width in [320, 390, 1280]:
            with self.subTest(width=width):
                self.page.set_viewport_size(dict(width=width, height=900))
                self.open()
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), width)
                if width == 320:
                    self.assertGreaterEqual(self.page.locator('#category').bounding_box()['width'], 220)
                self.open('#place=parque-barigui')
                detail = self.page.locator('#place-detail')
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), width)
                row = detail.locator('[data-activity-id="synthetic-test-event"]')
                self.assertEqual(row.evaluate('(n) => getComputedStyle(n.parentElement).listStyleType'), 'none')
                self.assertGreaterEqual(row.locator('button').bounding_box()['height'], 44)
                self.assertLessEqual(detail.locator('article').bounding_box()['width'], 820)
                source = row.locator('.source-link')
                source.focus()
                expect(source).to_be_focused()
                expect(source).to_have_attribute('aria-label', 'Consultar fonte da atividade: Atividade com um título longo para testar a leitura em telas pequenas (abre em uma nova aba)')
                self.page.keyboard.press('Tab')
                expect(row.locator('button')).to_be_focused()
                self.page.keyboard.press('Enter')
                expect(row).to_contain_text('Feita')
                expect(row.locator('button')).to_be_focused()
                self.page.keyboard.press('Space')
                expect(row.locator('button')).to_have_text('Já fizemos')
                detail.locator('.back-link').focus()
                self.page.keyboard.press('Enter')
                expect(detail).to_be_hidden()

    def test_completed_place_reappears_for_new_activity(self):
        self.seed({LEGACY: ['parque-barigui'], SHORTLIST: ['parque-barigui']})
        self.open()
        expect(self.page.locator('#activity-grid [data-id="parque-barigui"]')).to_have_count(0)
        expect(self.page.locator('#visited-list [data-activity-id="parque-barigui--visit"]')).to_have_count(1)
        self.barigui['activities'].append(self.event())
        self.page.reload()
        card = self.page.locator('#activity-grid [data-id="parque-barigui"]')
        expect(card).to_be_visible()
        expect(card.locator('[data-activity-id="synthetic-test-event"]')).to_be_visible()
        expect(card.locator('.save-button')).to_have_attribute('aria-pressed', 'true')
        expect(self.page.locator('#visited-list [data-activity-id="parque-barigui--visit"]')).to_have_count(1)
        card.get_by_role('button', name='Marcar como feita: Evento sintético de teste').click()
        expect(card).to_have_count(0)
        history = self.page.locator('#visited-list [data-activity-id="synthetic-test-event"]')
        expect(history).to_be_visible()
        expect(history.get_by_role('button')).to_be_focused()
        history.get_by_role('button').click()
        expect(card).to_be_visible()
        expect(card.get_by_role('button', name='Marcar como feita: Evento sintético de teste')).to_be_focused()
        self.page.reload()
        expect(card).to_be_visible()
        expect(self.page.locator('#visited-list [data-activity-id="parque-barigui--visit"]')).to_have_count(1)

    def test_legacy_undo_old_catalog_and_cross_tab_completion(self):
        self.seed({LEGACY: []})
        for place in self.data:
            place.pop('activities')
            place.pop('updatedAt')
        self.open()
        card = self.page.locator('#activity-grid [data-id="parque-barigui"]')
        expect(card).to_be_visible()
        card.get_by_role('button', name='Marcar como feita: Visita ao local').click()
        self.page.reload()
        expect(card).to_have_count(0)
        self.page.locator('#visited-list [data-activity-id="parque-barigui--visit"] button').click()
        self.page.reload()
        expect(card).to_be_visible()
        other = self.context.new_page()
        other.goto(self.url)
        other.evaluate('(key) => localStorage.setItem(key, JSON.stringify(["parque-barigui--visit"]))', COMPLETED)
        expect(card).to_have_count(0)
        other.evaluate('(key) => localStorage.setItem(key, "[]")', COMPLETED)
        expect(card).to_be_visible()
        other.close()

    def test_place_deep_link_refresh_back_and_full_details(self):
        self.barigui['id'] = 'synthetic / lugar ç'
        self.seed({LEGACY: []})
        self.barigui['activities'].append(self.event())
        self.open()
        link = self.page.locator('#activity-grid').get_by_role('link', name='Ver lugar: '+self.barigui['name'])
        expect(link).to_be_visible()
        link.focus()
        self.page.keyboard.press('Enter')
        expect(self.page).to_have_url(self.url+'#place=synthetic%20%2F%20lugar%20%C3%A7')
        detail = self.page.locator('#place-detail')
        expect(detail).to_be_visible()
        expect(detail.locator('h2')).to_be_focused()
        expect(self.page.locator('#activity-grid')).to_be_hidden()
        for key in ['description', 'crowdNote', 'logisticsNote']:
            expect(detail).to_contain_text(self.barigui[key])
        expect(detail.locator('[data-activity-id]')).to_have_count(2)
        expect(detail).to_contain_text(self.event()['description'])
        expect(detail.locator('a[href="https://example.invalid/test"]')).to_be_visible()
        self.page.reload()
        expect(detail).to_be_visible()
        detail.get_by_role('button', name='Marcar como feita: Evento sintético de teste').click()
        expect(detail.locator('[data-activity-id="synthetic-test-event"]')).to_contain_text('Feita')
        expect(detail.locator('[data-activity-id="synthetic-test-event"] button')).to_be_focused()
        self.page.go_back()
        expect(detail).to_be_hidden()
        expect(link).to_be_focused()
        self.page.go_forward()
        expect(detail).to_be_visible()
        detail.get_by_role('link', name='Voltar aos lugares').click()
        expect(detail).to_be_hidden()
        self.open('#place=missing')
        expect(detail).to_contain_text('Lugar não encontrado')
        detail.get_by_role('link', name='Voltar aos lugares').click()
        expect(self.page.locator('#activity-grid')).to_be_visible()

    def test_material_update_sorting_ignores_rechecks(self):
        self.seed({LEGACY: []})
        self.data = self.data[:3]
        for index, place in enumerate(self.data):
            place['updatedAt'] = ['2030-01-01', '2030-02-01', '2030-01-31T23:00:00Z'][index]
            place['activities'][0]['updatedAt'] = place['updatedAt']
        self.data[0]['checkedAt'] = '2099-01-01'
        self.open()
        ids = lambda: self.page.locator('#activity-grid > article').evaluate_all('(nodes) => nodes.map(n => n.dataset.id)')
        self.assertEqual(ids(), [self.data[1]['id'], self.data[2]['id'], self.data[0]['id']])
        self.data[0]['activities'].append(self.event())
        self.page.reload()
        self.assertEqual(ids(), [self.data[0]['id'], self.data[1]['id'], self.data[2]['id']])

    def test_expired_events_are_archived_not_suggested(self):
        self.seed({LEGACY: ['parque-barigui']})
        self.barigui['activities'].append(self.event(startsAt='2000-01-01', endsAt='2000-01-02'))
        self.open()
        expect(self.page.locator('#activity-grid [data-id="parque-barigui"]')).to_have_count(0)
        expect(self.page.locator('#archive-list')).to_contain_text(self.barigui['name'])
        self.open('#place=parque-barigui')
        row = self.page.locator('#place-detail [data-activity-id="synthetic-test-event"]')
        expect(row).to_contain_text('Encerrada')
        expect(row).to_contain_text('2000')
        expect(row.get_by_role('button', name='Registrar que fizemos: Evento sintético de teste')).to_be_visible()
        row.get_by_role('button').click()
        expect(row).to_contain_text('Feita')
        self.page.locator('#place-detail .back-link').click()
        history = self.page.locator('#visited-list [data-activity-id="synthetic-test-event"]')
        expect(history).to_contain_text('Encerrada')
        history.get_by_role('button').click()
        expect(self.page.locator('#activity-grid [data-id="parque-barigui"]')).to_have_count(0)
        expect(self.page.locator('#archive-list a')).to_be_focused()
        self.barigui['activities'].append(self.event(id='synthetic-future-event'))
        self.page.reload()
        expect(self.page.locator('#activity-grid [data-id="parque-barigui"]')).to_be_visible()
        expect(self.page.locator('#activity-grid [data-activity-id="synthetic-test-event"]')).to_have_count(0)

if __name__ == '__main__':
    unittest.main()
