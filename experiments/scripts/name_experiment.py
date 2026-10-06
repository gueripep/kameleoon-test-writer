# Asks Gemini for a short kebab-case name describing the current variation files, prefixed with the client.
# Uses curl for the request: the system python has no CA bundle configured.
import json, os, re, subprocess, sys

MODEL = 'gemini-3.8-flash'
LIMIT = 6000  # chars per file sent to the model

def slugify(s):
    s = re.sub(r'[^a-z0-9]+', '-', s.strip().lower())
    return re.sub(r'^-|-$', '', s)[:60]

def read(path):
    try:
        with open(path, encoding='utf-8') as f:
            return f.read()[:LIMIT]
    except OSError:
        return ''

def client_from_site(js):
    # Reads the `// Site: <hostname>` line variation.js starts with; www.shop.co.uk -> "shop".
    m = re.search(r'^\s*//\s*Site:\s*(\S+)', js, re.M | re.I)
    if not m:
        return ''
    host = re.sub(r'^[a-z]+://', '', m.group(1).lower()).split('/')[0].split(':')[0]
    labels = [l for l in host.split('.') if l and l != 'www']
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in ('co', 'com', 'org', 'net', 'gov', 'ac'):
        return slugify(labels[-3])
    return slugify(labels[-2] if len(labels) >= 2 else labels[0]) if labels else ''

def with_client(client, slug):
    if not client or slug == client or slug.startswith(f'{client}-'):
        return slug
    return slugify(f'{client}-{slug}') if slug != 'experiment' else client

def main():
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    js, css = read('variation.js'), read('variation.css')
    client = client_from_site(js)
    if not key or not (js.strip() or css.strip()):
        return with_client(client, 'experiment')

    if client:
        ask = ('Reply with ONLY a 2-4 word kebab-case slug naming what the test changes, e.g. '
               '"pdp-demand-badges" or "sticky-mobile-cta". Do not include the client or site name.')
    else:
        ask = ('Reply with ONLY a kebab-case slug that starts with the client/brand name (from the '
               'code, URLs or copy) followed by 2-4 words naming what the test changes, e.g. '
               '"acme-pdp-demand-badges". If the client cannot be identified, omit it.')
    prompt = (
        f'Below is a Kameleoon A/B test variation. {ask} No quotes, no explanation.\n\n'
        f'=== variation.js ===\n{js}\n\n=== variation.css ===\n{css}\n'
    )
    body = json.dumps({
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {'temperature': 0.2, 'maxOutputTokens': 500}
    })
    try:
        out = subprocess.run([
            'curl', '-sS', '--fail', '--max-time', '30',
            f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent',
            '-H', 'Content-Type: application/json',
            '-H', f'x-goog-api-key: {key}',
            '--data-binary', '@-',
        ], input=body, capture_output=True, text=True, check=True).stdout
        parts = json.loads(out)['candidates'][0]['content']['parts']
        text = ''.join(p.get('text', '') for p in parts)
    except (subprocess.CalledProcessError, json.JSONDecodeError, KeyError, IndexError) as e:
        print(f'name lookup failed ({e}); using fallback', file=sys.stderr)
        return with_client(client, 'experiment')
    return with_client(client, slugify(text) or 'experiment')

print(main())
