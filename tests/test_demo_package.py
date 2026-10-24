"""Packaging contract fixtures; no browser/model is involved."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('build_demo', Path(__file__).parents[1] / 'scripts' / 'build-demo.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DemoPackaging(unittest.TestCase):
    def make_source(self, directory):
        source = Path(directory) / 'public'
        source.mkdir()
        (source / 'index.html').write_text('<link href="/styles.css"><script src="/workboard.js" type="module"></script><main>Native board</main>')
        for name in ['styles.css', 'workboard.js', 'workboard-model.js', 'demo.html', 'demo.css', 'demo.mjs', 'demo-board.mjs', 'demo-store.mjs']:
            (source / name).write_text('fixture: ' + name)
        (source / 'not-for-publication.txt').write_text('Excluded fixture')
        return source

    def test_shared_assets_remain_identical_and_only_loader_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.make_source(directory)
            output = Path(directory) / 'site'
            original = (source / 'index.html').read_bytes()
            module.build(source, output)
            self.assertEqual((source / 'index.html').read_bytes(), original)
            for name in ['styles.css', 'workboard.js', 'workboard-model.js']:
                self.assertEqual((source / name).read_bytes(), (output / name).read_bytes())
            self.assertIn('src="./demo-board.mjs"', (output / 'workboard.html').read_text())
            self.assertNotIn('"/styles.css"', (output / 'workboard.html').read_text())
            self.assertEqual((output / 'index.html').read_bytes(), (source / 'demo.html').read_bytes())
            self.assertFalse((output / 'not-for-publication.txt').exists())

    def test_fail_closed_when_native_entry_contract_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.make_source(directory)
            (source / 'index.html').write_text('<script src="/new-entry.js"></script>')
            with self.assertRaises(ValueError):
                module.build(source, Path(directory) / 'site')

    def test_never_overwrite_native_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.make_source(directory)
            for output in [source, source.parent, source / 'nested']:
                with self.assertRaises(ValueError):
                    module.build(source, output)


if __name__ == '__main__':
    unittest.main()
