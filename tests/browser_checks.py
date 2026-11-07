"""Run with a Python environment containing playwright. No production dependencies.

Starts a loopback server, runs checks in Chromium, and always stops both.
"""
import functools
import http.server
import json
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def run():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={'width': 1440, 'height': 1100}, device_scale_factor=1)
            errors, requests = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append(request.url))
            base = f'http://127.0.0.1:{server.server_port}'
            page.goto(base)
            page.wait_for_function('Boolean(window.DiffLens)')
            results = page.evaluate(r'''() => {
              const D = DiffLens, results = [];
              function check(name, actual, expected) {
                if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(name + ': ' + JSON.stringify(actual));
                results.push(name);
              }
              function kinds(a, b, mode=false) { return D.diff(a,b,mode).map(c => [c.kind,c.path]); }
              function rejects(text, phrase) { try { D.parse(text); return false; } catch(e) { return e.message.includes(phrase); } }
              check('key order ignored', kinds({a:1,b:{x:true,y:null}}, {b:{y:null,x:true},a:1}), []);
              check('nested change', kinds({a:{b:1}}, {a:{b:2}}), [['changed','/a/b']]);
              check('addition vs null', kinds({}, {a:null}), [['added','/a']]);
              check('removal vs null', kinds({a:null}, {}), [['removed','/a']]);
              check('type trap', kinds({a:42}, {a:'42'}), [['type','/a']]);
              check('null to object', kinds(null, {}), [['type','']]);
              check('root scalar', kinds(1, 2), [['changed','']]);
              check('root array to object', kinds([], {}), [['type','']]);
              check('array append', kinds([1], [1,2]), [['added','/1']]);
              check('array remove', kinds([1,2], [1]), [['removed','/1']]);
              check('array position documented', kinds([1,2], [2,1]), [['changed','/0'],['changed','/1']]);
              check('pointer escaping', kinds({'a/b':{'~x':1}}, {'a/b':{'~x':2}}), [['changed','/a~1b/~0x']]);
              check('empty key', kinds({'':false}, {'':true}), [['changed','/']]);
              check('prototype key is data', kinds(JSON.parse('{"__proto__":1}'), JSON.parse('{"__proto__":2}')), [['changed','/__proto__']]);
              check('structure ignores values', kinds({n:1,ok:true,s:'a'}, {n:2,ok:false,s:'b'}, true), []);
              check('structure retains fields and types', kinds({a:1,b:2}, {a:'1',c:3}, true), [['type','/a'],['removed','/b'],['added','/c']]);
              check('empty containers distinguished', kinds({a:[]}, {a:{}}), [['type','/a']]);
              check('invalid syntax', rejects('{', 'invalid JSON'), true);
              check('empty input', rejects('', 'invalid JSON'), true);
              check('unsafe integer rejected', rejects('9007199254740993','safe range'), true);
              check('infinity rejected', rejects('1e400','finite'), true);
              check('oversize rejected', rejects('"'+'x'.repeat(D.MAX_BYTES)+'"','1 MiB'), true);
              check('depth rejected', rejects('['.repeat(102)+'0'+']'.repeat(102),'100 level'), true);
              check('node limit rejected', rejects(JSON.stringify(Array(50001).fill(0)),'50,000'), true);
              check('markdown escaped', D.markdown(D.diff({}, {'<img onerror=x>': '`x`\n<script>'}),false).includes('<img'), false);
              check('markdown includes values', D.markdown(D.diff({a:1},{a:2}),false).includes('After (number): 2'), true);
              check('no diff report', D.markdown([],true).includes('No differences'), true);
              return results;
            }''')
            ui = []
            assert page.locator('#result-title').inner_text() == '5 changes, in focus.'
            ui.append('default demo: five actual changes')
            page.locator('#filter').fill('/user')
            assert page.locator('.change').count() == 2
            ui.append('path filter')
            with page.expect_download() as download:
                page.locator('#export').click()
            text = Path(download.value.path()).read_text()
            assert '5 change(s)' in text and '/region' in text
            ui.append('Markdown download contains all changes despite filter')
            page.locator('#before').fill('{')
            assert page.locator('#export').is_disabled()
            assert page.locator('.change').count() == 0
            page.locator('#compare').click()
            assert 'Before: invalid JSON' in page.locator('#error').inner_text()
            ui.append('edited inputs invalidate stale output; malformed JSON shown')
            page.locator('[data-example="types"]').click()
            assert page.locator('.change.type').count() == 4
            page.locator('#structure').check()
            assert page.locator('.change.type').count() == 4
            ui.append('type trap survives structure mode')
            page.locator('[data-example="api"]').click()
            page.locator('#structure').check()
            assert page.locator('#result-title').inner_text() == '3 changes, in focus.'
            ui.append('structure mode ignores scalar value changes')
            page.locator('[data-example="order"]').click()
            assert page.locator('.change').count() == 0
            ui.append('key shuffle is semantically unchanged')
            page.locator('#before-file').set_input_files({'name':'before.json','mimeType':'application/json','buffer':b'{"x":1}'})
            page.locator('#after-file').set_input_files({'name':'after.json','mimeType':'application/json','buffer':b'{"x":2}'})
            page.wait_for_function('document.getElementById("after").value === \'{"x":2}\'')
            page.locator('#compare').click()
            assert page.locator('.change').count() == 1
            page.locator('#swap').click()
            assert json.loads(page.locator('#before').input_value()) == {'x':2}
            ui.append('file import, compare, swap')
            page.locator('#before-file').set_input_files({'name':'large.json','mimeType':'application/json','buffer':b' ' * (1024*1024+1)})
            assert '1 MiB' in page.locator('#error').inner_text()
            assert page.locator('#export').is_disabled()
            ui.append('oversized file rejected')
            page.locator('#before').fill('{}')
            page.locator('#after').fill('{"<img src=x onerror=alert(1)>":"<script>alert(1)</script>"}')
            page.locator('#compare').click()
            assert page.locator('#changes img, #changes script').count() == 0
            assert '<img' in page.locator('.path').inner_text()
            ui.append('untrusted content displayed as text')
            page.locator('#before').fill('{}')
            page.locator('#after').fill(json.dumps({str(i):i for i in range(305)}))
            page.locator('#compare').click()
            assert page.locator('.change').count() == 300
            assert 'first 300' in page.locator('#changes').inner_text()
            page.locator('#filter').fill('/304')
            assert page.locator('.change').count() == 1
            ui.append('large report render bounded; filtering reaches later changes')
            page.locator('#clear').click()
            assert page.locator('#before').input_value() == '' and page.locator('#after').input_value() == ''
            ui.append('clear')
            page.locator('[data-example="api"]').click()
            (ROOT / 'assets').mkdir(exist_ok=True)
            page.screenshot(path=str(ROOT / 'assets' / 'demo.png'), full_page=True)
            for width in [390, 320]:
                page.set_viewport_size({'width':width,'height':844})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Horizontal overflow at {width}px'
                assert page.locator('#compare').is_visible()
            page.screenshot(path=str(ROOT / 'assets' / 'mobile.png'), full_page=True)
            ui.append('390px and 320px responsive layout without horizontal overflow')
            assert not errors, errors
            assert all(url.startswith(base) for url in requests), requests
            assert page.evaluate('localStorage.length === 0 && sessionStorage.length === 0')
            ui.append('no page errors, external requests, or web storage writes')
            # Verify the documented double-click/offline path independently.
            offline = browser.new_context(offline=True)
            local = offline.new_page()
            local.goto((ROOT / 'index.html').as_uri())
            assert local.locator('#result-title').inner_text() == '5 changes, in focus.'
            ui.append('file:// works with network disabled')
            offline.close()
            browser.close()
            print(json.dumps({'engine_checks':len(results), 'browser_checks':len(ui), 'engine':results,'browser':ui}, ensure_ascii=False, indent=2))
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    run()
