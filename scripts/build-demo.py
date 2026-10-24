#!/usr/bin/env python3
"""Stage the browser demo with the actual self-hosted UI, without changing it."""
import shutil
import sys
from pathlib import Path


def build(source: Path, output: Path) -> None:
    if output.resolve() in (source.resolve(), source.parent.resolve()) or source.resolve() in output.resolve().parents:
        raise ValueError('Stage outside the source tree; never overwrite the native UI')
    output.mkdir(parents=True, exist_ok=True)
    html = (source / 'index.html').read_text()
    for original, replacement in [('/styles.css', './styles.css'), ('/workboard.js', './demo-board.mjs')]:
        if html.count('"' + original + '"') != 1:
            raise ValueError(f'Native UI entry changed: expected one {original}')
        html = html.replace('"' + original + '"', '"' + replacement + '"')
    (output / 'workboard.html').write_text(html)
    shutil.copyfile(source / 'demo.html', output / 'index.html')
    for path in [source / name for name in ('styles.css', 'workboard.js', 'workboard-model.js', 'demo.css')] + list(source.glob('demo*.mjs')):
        shutil.copyfile(path, output / path.name)


if __name__ == '__main__':
    build(Path(__file__).resolve().parents[1] / 'public', Path(sys.argv[1] if len(sys.argv) > 1 else '_site'))
