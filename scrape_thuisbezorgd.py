#!/usr/bin/env python3
"""Scrape a thuisbezorgd.nl restaurant menu page into MainItems.js + img/.

Usage:
    py scrape_thuisbezorgd.py <menu-url> [--out DIR] [--no-images]

Stdlib only. Writes <out>/MainItems.js and (unless --no-images) <out>/img/.
"""
import argparse
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8'}
TRANSFORM = 'c_fill,w_1200,h_1200,q_auto'
LOGO_TRANSFORM = 'c_fill,w_400,h_400,q_auto'


# Prompt: report scan progress as structured events the desktop app can draw.
# Reason: a multi-minute scan looked frozen because the only output was a few
# plain lines; the launcher needs phase progress and the parsed menu tree.
EVENT_PREFIX = '@@TECHKES@@ '


def emit(event, **fields):
    """Emit one JSON progress event on stdout, prefixed with a sentinel.

    The prefix keeps the line readable for a human running the scraper by hand
    and for the GitHub Action log, while still being trivial to parse. Never
    raise: progress reporting must not be able to break a scan.
    """
    fields['event'] = event
    try:
        print(EVENT_PREFIX + json.dumps(fields, ensure_ascii=False), flush=True)
    except Exception:
        pass


def fail(msg):
    emit('error', message=msg)
    sys.exit('Error: ' + msg)


def norm_name(n):
    """Filename normalization: lowercase, / -> -, strip apostrophes/dquotes."""
    return n.replace('/', '-').replace("'", '').replace('"', '').lower()


def js_str(n):
    """Escape a name for use as a double-quoted JS string key."""
    return '"' + n.replace('\\', '\\\\').replace('"', '\\"') + '"'


def img_path(name):
    return './img/' + norm_name(name) + '.jpg'


def fetch(url):
    """Fetch page HTML. urllib first; some CDN bot-protection fingerprints the
    Python TLS stack and 403s it, so fall back to curl (subprocess, stdlib)
    with the same browser headers."""
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        if e.code != 403:
            fail('could not fetch page (HTTP %s) from %s' % (e.code, url))
    except urllib.error.URLError as e:
        fail('could not fetch page: %s' % e.reason)
    try:
        out = subprocess.run(
            ['curl', '-sS', '-L', '--max-time', '60',
             '-A', UA['User-Agent'], '-H', 'Accept: ' + UA['Accept'],
             '-H', 'Accept-Language: ' + UA['Accept-Language'], url],
            capture_output=True, timeout=90)
    except FileNotFoundError:
        fail('page fetch was blocked (HTTP 403) and curl is not available '
             'as a fallback; save the page HTML manually and adapt.')
    if out.returncode != 0 or not out.stdout:
        fail('could not fetch page (curl exit %s): %s'
             % (out.returncode, out.stderr.decode('utf-8', 'replace').strip()))
    return out.stdout.decode('utf-8', errors='replace')


def extract_state(page_html):
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
                  page_html, re.S)
    if not m:
        fail('no <script id="__NEXT_DATA__"> tag found; is this a thuisbezorgd.nl menu page?')
    try:
        data = json.loads(html.unescape(m.group(1)))
    except json.JSONDecodeError as e:
        fail('could not parse embedded JSON: %s' % e)
    try:
        return data['props']['appProps']['preloadedState']['menu']['restaurant']['cdn']
    except KeyError:
        fail('preloadedState.menu.restaurant.cdn not found in page JSON; '
             'the page structure may have changed.')


def best_menu(cdn):
    """Pick the menu (delivery/pickup) with the most item references."""
    menus = cdn['restaurant']['menus']
    if not menus:
        fail('no menus found in restaurant data')
    best = max(menus, key=lambda m: sum(len(c.get('itemIds', [])) for c in m['categories']))
    names0 = [c['name'] for c in best['categories']]
    for m in menus[1:]:
        if [c['name'] for c in m['categories']] != names0:
            print('Note: menu entries differ (delivery/pickup); used the one '
                  'with most items.', file=sys.stderr)
            emit('warning', message='Menu entries differ (delivery/pickup); '
                                    'used the one with most items.')
            break
    return best


# Prompt: match the scraping output to HierderTechje/MainItems.js.
# Reason: the UI needs actual choices in sequence (bread -> sauce), while
# group labels as leaves prematurely finish an order and discard the choices.
def build_js(cdn, categories):
    items = cdn['items']
    groups = {g['id']: g for g in cdn.get('modifierGroups', [])}
    mods = {m['id']: m['modifier']['name'] for m in cdn.get('modifierSets', [])}

    def node(name):
        return {'IMG': "'" + img_path(name) + "'"}

    # Prompt: put extras such as Extra saus/Zonder spek beneath every bread
    # option, with Standaard for the default. Reason: extras must be skippable
    # and available regardless of which bread or size the customer selects.
    def is_optional(group, choices):
        minimum = group.get('minChoices')
        if minimum is not None:
            return int(minimum) == 0
        # Prompt: retain petit pain wit/extra groot wit as main options.
        # Reason: the word extra in a size name does not make it an add-on.
        if re.search(r'\b(brood\w*|formaat|grootte|size)\b', group['name'], re.I):
            return False
        return any(re.search(r'\b(extra\w*\b(?!\s+(?:groot|klein)\b)|zonder\b)', name, re.I)
                   for name in [group['name']] + choices)

    def add_choices(parent, option_groups):
        if not option_groups:
            return
        choices, optional = option_groups[0]
        if optional and not any(name.casefold() == 'standaard' for name in choices):
            choices = ['Standaard'] + choices
        for name in choices:
            # Prompt: give the Standaard default its own image like every other
            # choice. Reason: it inherited the parent's photo, so the default tile
            # showed the bread the option belonged to instead of the option
            # itself, and ./img/standaard.jpg — already shipped in img/ — was
            # never referenced. Only a choice whose image genuinely cannot be
            # resolved should fall back, which index.html now handles at render
            # time rather than by baking the parent's picture into the data.
            child = node(name)
            add_choices(child, option_groups[1:])
            parent[name] = [child]

    ncat = nitems = ngroups = 0
    result = {'IMG': './img/logo.png'}
    for cat in categories:
        ncat += 1
        category = node(cat['name'])
        result[cat['name']] = [category]
        for iid in cat['itemIds']:
            it = items.get(iid)
            if it is None:
                print('Warning: item id %s not found in items; skipped' % iid,
                      file=sys.stderr)
                emit('warning', message='Item id %s not found in items; skipped' % iid)
                continue
            nitems += 1
            entry = node(it['name'])
            option_groups = []
            gids = (it['variations'][0].get('modifierGroupsIds') or []) if it.get('variations') else []
            for gid in dict.fromkeys(gids):
                g = groups.get(gid)
                if not g:
                    print('Warning: modifier group %s missing' % gid, file=sys.stderr)
                    emit('warning', message='Modifier group %s missing' % gid)
                    continue
                ngroups += 1
                choices = []
                # Prompt: read the group's choice ids from whichever field the
                # page uses. Reason: some menus carry modifierSetsIds, others
                # only a `modifiers` list of the same modifierSets ids, and
                # reading just one fails every item in the group.
                mids = g.get('modifierSetsIds') or g.get('modifiers') or []
                for mid in mids:
                    if mid not in mods:
                        fail('modifier set %s missing for group %s' % (mid, g['name']))
                    choices.append(mods[mid])
                if not choices:
                    fail('no modifier choices found for group %s; check the menu data structure'
                         % g['name'])
                # Prompt: every bread/size gets extras plus Standaard.
                # Reason: place optional changes after the main choices even
                # when the source lists the extra groups first.
                option_groups.append((list(dict.fromkeys(choices)), is_optional(g, choices)))
            option_groups.sort(key=lambda group: group[1])
            add_choices(entry, option_groups)
            category[it['name']] = [entry]
    # Prompt: match MainItems.js; reason: serialize nested arrays and escape all
    # strings correctly, including empty categories and names with line breaks.
    # Prompt: add extras below every option with Standaard as the default.
    # Reason: document the generated menu's default and extra-choice branches.
    header = ('// Prompt: match HierderTechje/MainItems.js, with extras and Standaard beneath each option.\n'
              '// Reason: expose actual choices and allow optional changes to be skipped.\n')
    return (header + 'AllMainItems = ' + json.dumps(result, ensure_ascii=False, indent='\t')
            + ';\n', ncat, nitems, ngroups)


# Prompt: preview the parsed menu in the launcher before the operator orders.
# Reason: 103 items cannot be eyeballed in a log, so report categories, their
# items, and each item's option-group names for a collapsible tree view.
def parse_js(js_text):
    """Recover the menu dict from generated MainItems.js source.

    Reading it back guarantees the preview describes the file that was actually
    written, rather than a parallel in-memory copy that could drift from it.
    """
    return json.loads(js_text.split('AllMainItems = ', 1)[1].rstrip(';\n'))


def build_tree(categories, result):
    tree = []
    for cat in categories:
        node_list = result.get(cat['name'])
        if not node_list:
            continue
        items = []
        for item_name, entry in node_list[0].items():
            if item_name == 'IMG':
                continue
            groups = [k for k in entry[0] if k != 'IMG'] if entry else []
            items.append({'name': item_name, 'optionGroups': groups})
        tree.append({'name': cat['name'], 'itemCount': len(items), 'items': items})
    return tree


def collect_urls(cdn, categories):
    """Map normalized filename stem -> (url, display name) for everything named."""
    urlmap = {}

    def add(name, sources):
        if not sources:
            return
        p = sources[0].get('path')
        if not p:
            return
        if '{transformations}' in p:
            p = p.replace('{transformations}', TRANSFORM)
        urlmap[norm_name(name)] = (p, name)

    for cat in categories:
        add(cat['name'], cat.get('imageSources'))
        for iid in cat['itemIds']:
            it = cdn['items'].get(iid)
            if it:
                add(it['name'], it.get('imageSources'))
    for g in cdn.get('modifierGroups') or []:
        add(g['name'], g.get('imageSources'))
    for m in cdn.get('modifierSets') or []:
        add(m['modifier']['name'], m['modifier'].get('imageSources'))

    logo = None
    try:
        logo = cdn['restaurant']['restaurantInfo'].get('logoUrl')
    except KeyError:
        pass
    if logo and '{transformations}' in logo:
        logo = logo.replace('{transformations}', LOGO_TRANSFORM)
    return urlmap, logo


def download(url, dest):
    """Download a binary file; urllib first, curl fallback."""
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r, open(dest, 'wb') as f:
            f.write(r.read())
        return
    except Exception:
        pass
    out = subprocess.run(['curl', '-sS', '-L', '--max-time', '60',
                          '-A', UA['User-Agent'], '-o', dest, url],
                         capture_output=True, timeout=90)
    if out.returncode != 0 or not os.path.exists(dest) or os.path.getsize(dest) == 0:
        raise RuntimeError(out.stderr.decode('utf-8', 'replace').strip() or 'curl failed')


def download_images(outdir, js_text, urlmap, logo):
    imgdir = os.path.join(outdir, 'img')
    os.makedirs(imgdir, exist_ok=True)
    refs = list(dict.fromkeys(re.findall(r"\./img/([^\"']+\.(?:jpg|png))", js_text)))
    downloaded, no_url, failed = [], [], []
    total = len(refs)
    for index, fn in enumerate(refs, 1):
        emit('progress', phase='images', done=index, total=total, detail=fn)
        if fn == 'logo.png':
            if logo:
                try:
                    download(logo, os.path.join(imgdir, fn))
                    downloaded.append(fn)
                except Exception as e:
                    failed.append((fn, str(e)))
            # no logoUrl -> simply not present (top-level IMG is a fixed default)
            continue
        entry = urlmap.get(fn.rsplit('.', 1)[0])
        if not entry:
            no_url.append(fn)
            continue
        url, _ = entry
        try:
            download(url, os.path.join(imgdir, fn))
            downloaded.append(fn)
        except Exception as e:
            failed.append((fn, str(e)))
    return refs, downloaded, no_url, failed


def main():
    # Prompt: keep menu names such as Hawaï readable on any console.
    # Reason: a cp1252 console would otherwise raise on non-ASCII names, or
    # mangle them, when the scraper runs outside the app (which sets
    # PYTHONIOENCODING=utf-8 itself).
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass


    ap = argparse.ArgumentParser(description='Scrape a thuisbezorgd.nl menu into MainItems.js + img/.')
    ap.add_argument('url', help='thuisbezorgd.nl menu URL, e.g. https://www.thuisbezorgd.nl/menu/...')
    ap.add_argument('--out', default='.', help='output directory (default: current directory)')
    ap.add_argument('--no-images', action='store_true', help='only write MainItems.js, skip image downloads')
    args = ap.parse_args()

    if 'thuisbezorgd.nl' not in args.url:
        fail('not a thuisbezorgd.nl URL: %s' % args.url)

    # Prompt: time each phase so the launcher can show how far a scan has run.
    # Reason: elapsed time per phase tells an operator whether a scan is working
    # or stalled, which a single final line cannot.
    started = time.time()
    marks = {}

    def step(phase, label):
        marks[phase] = time.time()
        emit('phase_start', phase=phase, label=label)

    def done(phase, **extra):
        emit('phase_done', phase=phase,
             elapsed=round(time.time() - marks.get(phase, time.time()), 2), **extra)

    step('fetch', 'Fetching %s' % args.url)
    print('Fetching %s ...' % args.url)
    page = fetch(args.url)
    done('fetch', bytes=len(page))

    step('parse', 'Reading menu data')
    cdn = extract_state(page)
    done('parse')

    step('menu', 'Choosing delivery or pickup menu')
    menu = best_menu(cdn)
    categories = menu['categories']
    done('menu', categories=len(categories))

    step('build', 'Building menu tree')
    js_text, ncat, nitems, ngroups = build_js(cdn, categories)
    done('build', categories=ncat, items=nitems, groups=ngroups)

    step('write', 'Writing MainItems.js')
    os.makedirs(args.out, exist_ok=True)
    js_path = os.path.join(args.out, 'MainItems.js')
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write(js_text)
    print('Wrote %s (%d categories, %d items, %d option groups)' %
          (js_path, ncat, nitems, ngroups))
    done('write', path=js_path)

    emit('tree', categories=build_tree(categories, parse_js(js_text)))

    if args.no_images:
        emit('summary', categories=ncat, items=nitems, groups=ngroups,
             elapsed=round(time.time() - started, 2), images='skipped')
        return

    step('images', 'Downloading images')
    urlmap, logo = collect_urls(cdn, categories)
    refs, downloaded, no_url, failed = download_images(args.out, js_text, urlmap, logo)
    print('Images referenced: %d, downloaded: %d' % (len(refs), len(downloaded)))
    done('images', referenced=len(refs), downloaded=len(downloaded),
         skipped=len(no_url), failed=len(failed))
    if no_url:
        print('No image URL in menu data (%d):' % len(no_url))
        for fn in no_url:
            print('  - %s' % fn)
    if failed:
        print('Download failures (%d, non-fatal):' % len(failed))
        for fn, err in failed:
            print('  - %s: %s' % (fn, err))

    emit('summary', categories=ncat, items=nitems, groups=ngroups,
         elapsed=round(time.time() - started, 2),
         images=len(downloaded), imageFailures=len(failed))


if __name__ == '__main__':
    main()
