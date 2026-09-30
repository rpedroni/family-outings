"""Browser regressions for the four confirmed UI review findings."""
import functools
import http.server
import json
from pathlib import Path
import threading
import unittest
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class ReviewRegressions(unittest.TestCase):
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
        self.context = self.browser.new_context(timezone_id='America/Sao_Paulo')
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(self.url) else route.abort())
        self.place = json.loads((ROOT / 'activities.json').read_text())[0]
        self.place['activities'] = [dict(id='review-visit', title='Visita de teste', description='Descrição de teste', updatedAt='2026-09-30', checkedAt='2026-09-30', url='https://example.invalid/', kind='visit', startsAt=None, endsAt=None)]
        self.page.route('**/activities.json', lambda route: route.fulfill(json=[self.place]))

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def open(self, fragment=''):
        self.page.goto(self.url + fragment)
        expect(self.page.locator('#results')).to_have_attribute('aria-busy', 'false')

    def test_place_checked_timestamp_loads_and_renders_in_card_and_detail(self):
        self.place['checkedAt'] = '2026-09-30T23:30:00-03:00'
        self.open()
        card = self.page.locator('#activity-grid article')
        expect(card).to_have_count(1)
        expected = self.page.evaluate("formatDate('2026-10-01')")
        expect(card.locator('time')).to_have_text(expected)
        expect(card.locator('time')).to_have_attribute('datetime', self.place['checkedAt'])
        card.locator('.place-link').click()
        expect(self.page.locator('#place-detail time')).to_have_text(expected)

    def test_nested_activity_title_and_description_are_searchable(self):
        self.place['activities'][0].update(title='Observação sideralúnica', description='Oficina paleontológicaexclusiva')
        self.open()
        for term in ['SIDERALUNICA', 'paleontologicaexclusiva', 'sideralunica paleontologicaexclusiva']:
            with self.subTest(term=term):
                self.page.locator('#search').fill(term)
                expect(self.page.locator('#activity-grid article')).to_have_count(1)
        self.page.locator('#activity-grid .visited-button').click()
        expect(self.page.locator('#visited-list')).to_contain_text('sideralúnica')
        self.page.locator('#search').fill('not-present-anywhere')
        expect(self.page.locator('#visited-list li')).to_have_count(0)

    def test_publisher_microsecond_timestamps_and_strict_calendar_validation(self):
        stamp = '2026-09-30T23:30:00.123456-03:00'
        self.place.update(checkedAt=stamp, updatedAt=stamp)
        self.place['activities'][0].update(checkedAt=stamp, updatedAt=stamp)
        self.open('#place=' + self.place['id'])
        expect(self.page.locator('#place-detail time')).to_have_count(1)
        expected = self.page.evaluate("formatDate('2026-10-01')")
        expect(self.page.locator('#place-detail time')).to_have_text(expected)
        expect(self.page.locator('#place-detail .activity-row .checked')).to_have_text(f'Consultada em {expected} · Atualizada em {expected}')
        valid = ['2024-02-29', '0001-01-01', '2026-09-30T12:00:00Z', '2026-09-30T12:00:00.1+05:30', '2026-09-30T12:00:00.123456Z']
        invalid = ['2026-02-29', '2026-02-30T12:00:00.123456Z', '2026-04-31', '0000-01-01', '2026-09-30T24:00:00Z', '2026-09-30T12:60:00Z', '2026-09-30T12:00:60Z', '2026-09-30T12:00:00', '2026-09-30T12:00:00.1234567Z', '2026-09-30T12:00:00+24:00', '2026-09-30T12:00:00+03:60']
        for value in valid + invalid:
            with self.subTest(value=value):
                self.assertEqual(self.page.evaluate('(value) => validDate(value)', value), value in valid)
        self.assertFalse(self.page.evaluate('(value) => validDate(value, true)', stamp))

    def test_detail_skip_preserves_route_and_listing_skip_still_works(self):
        self.open()
        skip = self.page.locator('.skip-link')
        skip.focus()
        self.page.keyboard.press('Enter')
        expect(self.page).to_have_url(self.url + '#results')
        expect(self.page.locator('#results')).to_be_focused()
        for place_id in [self.place['id'], 'missing-place']:
            self.page.evaluate('(id) => location.hash = "#place=" + encodeURIComponent(id)', place_id)
            expect(self.page.locator('#place-detail h2')).to_be_visible()
            route = self.page.url
            skip.focus()
            self.page.keyboard.press('Enter')
            expect(self.page).to_have_url(route)
            expect(self.page.locator('#place-detail')).to_be_visible()
            expect(self.page.locator('#place-detail h2')).to_be_focused()


if __name__ == '__main__':
    unittest.main()
