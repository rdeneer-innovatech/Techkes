# Prompt: check scraping against HierderTechje/MainItems.js.
# Reason: protect the selectable bread -> sauce hierarchy and valid JS output.
import contextlib
import io
import json
import unittest

from scrape_thuisbezorgd import (EVENT_PREFIX, build_js, build_tree,
                                  collect_urls, download_images, emit,
                                  parse_js)


class MenuOutputTests(unittest.TestCase):
    # Prompt: extras and Standaard must appear beneath every bread option.
    # Reason: check both default and customized paths through multiple extras,
    # including source groups arriving before bread choices.
    def test_every_bread_has_optional_extras_and_default(self):
        cdn = {
            'items': {'item': {'name': 'Lunch', 'variations': [{
                'modifierGroupsIds': ['sauce', 'bread', 'bacon']}]}},
            'modifierGroups': [
                {'id': 'bread', 'name': 'Keuze broodje', 'modifierSetsIds': ['petit', 'large']},
                {'id': 'sauce', 'name': 'Extra saus', 'modifierSetsIds': ['sauce']},
                {'id': 'bacon', 'name': 'Aanpassingen', 'minChoices': 0,
                 'modifierSetsIds': ['bacon']},
            ],
            'modifierSets': [
                {'id': mid, 'modifier': {'name': name}}
                for mid, name in [('petit', 'Petit pain wit'), ('large', 'Extra groot wit'),
                                  ('sauce', 'Extra saus'), ('bacon', 'Zonder spek')]
            ],
        }
        text, *_ = build_js(cdn, [{'name': 'Lunch', 'itemIds': ['item']}])
        result = json.loads(text.split('AllMainItems = ', 1)[1].rstrip(';\n'))
        lunch = result['Lunch'][0]['Lunch'][0]
        self.assertEqual(list(lunch), ['IMG', 'Petit pain wit', 'Extra groot wit'])
        for bread in ['Petit pain wit', 'Extra groot wit']:
            options = lunch[bread][0]
            self.assertEqual(list(options), ['IMG', 'Standaard', 'Extra saus'])
            # Prompt: the Standaard default carries its own image, not the bread's.
            # Reason: inheriting the parent's photo showed the bread on the default
            # tile and left the already-shipped ./img/standaard.jpg unreferenced.
            self.assertEqual(options['Standaard'][0]['IMG'], "'./img/standaard.jpg'")
            for sauce in ['Standaard', 'Extra saus']:
                bacon = options[sauce][0]
                self.assertEqual(list(bacon), ['IMG', 'Standaard', 'Zonder spek'])
                self.assertEqual(list(bacon['Standaard'][0]), ['IMG'])
                self.assertEqual(list(bacon['Zonder spek'][0]), ['IMG'])

        # Prompt: Standaard is for the default; reason: mandatory choices must
        # still be selected, even if their label happens to contain Extra.
        cdn['modifierGroups'][1]['minChoices'] = 1
        text, *_ = build_js(cdn, [{'name': 'Lunch', 'itemIds': ['item']}])
        result = json.loads(text.split('AllMainItems = ', 1)[1].rstrip(';\n'))
        self.assertEqual(list(result['Lunch'][0]['Lunch'][0]), ['IMG', 'Extra saus'])

    def test_choices_follow_the_reference_hierarchy(self):
        categories = [{'name': 'Broodjes', 'itemIds': ['sandwich']}]
        cdn = {
            'items': {'sandwich': {
                'name': 'Broodje Kiphaas Krokant',
                'variations': [{'modifierGroupsIds': ['bread', 'sauce']}],
            }},
            'modifierGroups': [
                {'id': 'bread', 'name': 'Keuze broodje', 'modifierSetsIds': ['white', 'brown']},
                {'id': 'sauce', 'name': 'Keuze saus', 'modifierSetsIds': ['mayo']},
            ],
            'modifierSets': [
                {'id': 'white', 'modifier': {'name': 'Wit zacht broodje'}},
                {'id': 'brown', 'modifier': {'name': 'Bruin zacht broodje'}},
                {'id': 'mayo', 'modifier': {'name': 'Mayonaise', 'imageSources': [
                    {'path': 'https://example.com/mayo.jpg'}]}},
            ],
        }
        text, *counts = build_js(cdn, categories)
        result = json.loads(text.split('AllMainItems = ', 1)[1].rstrip(';\n'))
        sandwich = result['Broodjes'][0]['Broodje Kiphaas Krokant'][0]
        self.assertEqual(list(sandwich), ['IMG', 'Wit zacht broodje', 'Bruin zacht broodje'])
        for bread in ['Wit zacht broodje', 'Bruin zacht broodje']:
            self.assertEqual(sandwich[bread][0]['Mayonaise'], [{'IMG': "'./img/mayonaise.jpg'"}])
        self.assertEqual(counts, [1, 1, 2])
        urls, _ = collect_urls(cdn, categories)
        self.assertEqual(urls['mayonaise'][0], 'https://example.com/mayo.jpg')

    def test_missing_items_empty_categories_and_escaped_names(self):
        name = 'Broodje "speciaal"\nvers'
        cdn = {'items': {'ok': {'name': name}}}
        text, *counts = build_js(cdn, [{'name': 'Lunch', 'itemIds': ['missing', 'ok']},
                                     {'name': 'Empty', 'itemIds': []}])
        result = json.loads(text.split('AllMainItems = ', 1)[1].rstrip(';\n'))
        self.assertIn(name, result['Lunch'][0])
        self.assertEqual(list(result['Empty'][0]), ['IMG'])
        self.assertEqual(counts, [2, 1, 0])

    # Prompt: accept groups that list their choices in modifiers instead of
    # modifierSetsIds. Reason: bufkes-plein-1992 carries only modifiers, and
    # reading one field name aborted the whole scan for those items.
    def test_group_choices_read_from_modifiers_field(self):
        cdn = {
            'items': {'item': {'name': 'Lunch', 'variations': [{'modifierGroupsIds': ['bread']}]}},
            'modifierGroups': [{'id': 'bread', 'name': 'Keuze broodje',
                                'minChoices': 1, 'maxChoices': 1, 'modifiers': ['1', '2']}],
            'modifierSets': [
                {'id': '1', 'modifier': {'id': 'a', 'name': 'Petit pain wit'}},
                {'id': '2', 'modifier': {'id': 'b', 'name': 'Petit pain bruin'}},
            ],
        }
        text, *counts = build_js(cdn, [{'name': 'Lunch', 'itemIds': ['item']}])
        result = json.loads(text.split('AllMainItems = ', 1)[1].rstrip(';\n'))
        self.assertEqual(list(result['Lunch'][0]['Lunch'][0]),
                         ['IMG', 'Petit pain wit', 'Petit pain bruin'])
        self.assertEqual(counts, [1, 1, 1])

    # Prompt: an empty group must still fail loudly.
    # Reason: neither field present means the page structure changed.
    def test_group_without_any_choice_ids_still_fails(self):
        cdn = {
            'items': {'item': {'name': 'Lunch', 'variations': [{'modifierGroupsIds': ['g']}]}},
            'modifierGroups': [{'id': 'g', 'name': 'Keuze broodje', 'modifierSetsIds': []}],
        }
        with self.assertRaisesRegex(SystemExit, 'no modifier choices found'):
            build_js(cdn, [{'name': 'Lunch', 'itemIds': ['item']}])

    def test_unresolved_choices_do_not_become_orderable_group_labels(self):
        cdn = {
            'items': {'item': {'name': 'Lunch', 'variations': [{'modifierGroupsIds': ['g']}]}},
            'modifierGroups': [{'id': 'g', 'name': 'Bread', 'modifierSetsIds': ['missing']}],
        }
        with self.assertRaisesRegex(SystemExit, 'modifier set missing'):
            build_js(cdn, [{'name': 'Lunch', 'itemIds': ['item']}])


class ProgressEventTests(unittest.TestCase):
    # Prompt: the app parses stdout lines by this prefix.
    # Reason: an unparseable event line would silently stall the progress bars.
    def test_emit_writes_one_parseable_json_event_per_line(self):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            emit('phase_start', phase='fetch', label='Fetching')
        line = buffer.getvalue()
        self.assertTrue(line.startswith(EVENT_PREFIX))
        self.assertTrue(line.endswith('\n'))
        self.assertEqual(json.loads(line[len(EVENT_PREFIX):]),
                         {'phase': 'fetch', 'label': 'Fetching', 'event': 'phase_start'})

    # Prompt: a broken event must never abort a scan.
    # Reason: progress reporting is diagnostics, not the actual work.
    def test_emit_never_raises_on_unserializable_payload(self):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            emit('tree', categories=object())
        self.assertEqual(buffer.getvalue(), '')

    # Prompt: the preview must describe the file that was actually written.
    # Reason: a drifting preview would let an operator order off wrong data.
    def test_tree_matches_the_written_menu(self):
        cdn = {
            'items': {'item': {'name': 'Lunch', 'variations': [{'modifierGroupsIds': ['g']}]}},
            'modifierGroups': [{'id': 'g', 'name': 'Keuze broodje',
                                'modifierSetsIds': ['a']}],
            'modifierSets': [{'id': 'a', 'modifier': {'name': 'Petit pain wit'}}],
        }
        categories = [{'name': 'Lunch', 'itemIds': ['item']}]
        js_text, *_ = build_js(cdn, categories)
        tree = build_tree(categories, parse_js(js_text))
        self.assertEqual(tree, [{'name': 'Lunch', 'itemCount': 1, 'items': [
            {'name': 'Lunch', 'optionGroups': ['Petit pain wit']}]}])

    # Prompt: the image phase drives a per-image progress bar.
    # Reason: a 100-image download must report movement, not sit at zero.
    def test_download_images_reports_progress_and_keeps_its_contract(self):
        import scrape_thuisbezorgd as scraper
        original = scraper.download
        scraper.download = lambda url, dest: None
        try:
            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                refs, downloaded, no_url, failed = download_images(
                    '.', "A = {'IMG': './img/a.jpg'};",
                    {'a': ('https://example.com/a.jpg', 'A')}, None)
        finally:
            scraper.download = original
        self.assertEqual((refs, downloaded, no_url, failed), (['a.jpg'], ['a.jpg'], [], []))
        events = [json.loads(l[len(EVENT_PREFIX):]) for l in buffer.getvalue().splitlines()]
        self.assertEqual(events, [{'event': 'progress', 'phase': 'images',
                                    'done': 1, 'total': 1, 'detail': 'a.jpg'}])


if __name__ == '__main__':
    unittest.main()
