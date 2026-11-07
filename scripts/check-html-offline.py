#!/usr/bin/env python3
"""Open a relocated exported HTML file in an offline ARM Chrome context."""

import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("html", type=Path)
    args = parser.parse_args()
    source = args.html.resolve(strict=True)
    chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    architectures = subprocess.check_output(['lipo', '-archs', str(chrome)], text=True)
    if 'arm64' not in architectures.split():
        raise RuntimeError('Chrome lacks arm64')

    with tempfile.TemporaryDirectory(prefix='mino-html-offline-') as temporary:
        moved = Path(temporary) / 'relocated-export.html'
        shutil.copyfile(source, moved)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel='chrome', headless=True)
            context = browser.new_context()
            context.set_offline(True)
            page = context.new_page()
            requests = []
            page.on('request', lambda request: requests.append(request.url))
            page.goto(moved.as_uri())
            page.locator('article h1').get_by_text('尚未保存的正文').wait_for()
            image = page.locator('article img')
            image.wait_for()
            if not image.evaluate('(img) => img.complete && img.naturalWidth === 2 && img.naturalHeight === 2'):
                raise AssertionError('Embedded image did not decode offline')
            if page.evaluate('window.__unsafe === true'):
                raise AssertionError('Raw Markdown script executed')
            if page.locator('.app-shell').count():
                raise AssertionError('Application UI leaked into export')
            remote = [url for url in requests if not url.startswith('file:') and not url.startswith('data:')]
            if remote:
                raise AssertionError(f'Unexpected network requests: {remote}')
            print(f'PASS offline relocated HTML: heading, 2x2 image, no script, no network requests ({moved.name})')
            browser.close()


if __name__ == '__main__':
    main()
