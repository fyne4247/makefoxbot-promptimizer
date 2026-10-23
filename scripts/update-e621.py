#!/usr/bin/env python3
"""Refresh MakeFox's e621 vocabulary from official public DB exports.

Sources: tags, tag_aliases, and tag_implications. No wiki or post data is imported.
Raw archives are downloaded to a reusable cache and SHA-256 checked against
https://e621.net/db_exports.json. All output JSON is generated offline from
those archives, atomically replaced after successful validation.

This does not download posts, images, post histories, or account information.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

EXPORTS_URL = 'https://e621.net/db_exports.json'
CORE = ('tags', 'tag_aliases', 'tag_implications')
DEFAULT_CATEGORIES = {0, 1, 3, 4, 5, 8}
MAX_ARCHIVE_BYTES = {'tags': 150_000_000, 'tag_aliases': 30_000_000,
                     'tag_implications': 30_000_000}
HEADERS = {'Accept': 'application/json'}


def fetch_bytes(url: str, user_agent: str, max_bytes: int) -> bytes:
    if urllib.parse.urlparse(url).scheme != 'https':
        raise ValueError('Only HTTPS downloads are supported')
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={**HEADERS, 'User-Agent': user_agent})
            with urllib.request.urlopen(req, timeout=75) as response:
                data = response.read(max_bytes + 1)
            if len(data) > max_bytes:
                raise ValueError(f'Download exceeded {max_bytes} bytes: {url}')
            return data
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            if attempt == 2 or (isinstance(exc, urllib.error.HTTPError) and exc.code not in (429, 500, 502, 503, 504)):
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError('Unreachable')


def archive_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def ensure_headers(reader: csv.DictReader, required: set[str], dataset: str):
    actual = set(reader.fieldnames or [])
    if not required <= actual:
        raise ValueError(f'{dataset} CSV is missing columns: {sorted(required - actual)}')


def records(path: Path, required: set[str], dataset: str):
    with gzip.open(path, 'rt', encoding='utf-8-sig', newline='', errors='replace') as f:
        reader = csv.DictReader(f)
        ensure_headers(reader, required, dataset)
        yield from reader


def transform_tags(path: Path, categories: set[int], min_count: int):
    tags = {}
    seen = 0
    for rec in records(path, {'name', 'category', 'post_count'}, 'tags'):
        seen += 1
        name = rec['name'].strip()
        try:
            cat = int(rec['category'])
            count = int(rec['post_count'])
        except (TypeError, ValueError):
            continue
        if name and cat in categories and count >= min_count:
            old = tags.get(name)
            if old is None or count > old[2]:
                tags[name] = [name, cat, count]
    if not tags:
        raise ValueError('No usable tags found; refusing to overwrite existing data')
    return [tags[k] for k in sorted(tags)], {'source_rows': seen, 'retained': len(tags)}


def transform_aliases(path: Path):
    aliases = {}
    seen = active = 0
    for rec in records(path, {'antecedent_name', 'consequent_name', 'status'}, 'tag_aliases'):
        seen += 1
        if rec['status'].strip().lower() != 'active':
            continue
        active += 1
        before = rec['antecedent_name'].strip()
        after = rec['consequent_name'].strip()
        if before and after and before != after:
            aliases[before] = after
    return dict(sorted(aliases.items())), {'source_rows': seen, 'active_rows': active, 'retained': len(aliases)}


def transform_implications(path: Path):
    implications = {}
    seen = active = 0
    for rec in records(path, {'antecedent_name', 'consequent_name', 'status'}, 'tag_implications'):
        seen += 1
        if rec['status'].strip().lower() != 'active':
            continue
        active += 1
        before = rec['antecedent_name'].strip()
        after = rec['consequent_name'].strip()
        if before and after and before != after:
            implications.setdefault(before, set()).add(after)
    clean = {k: sorted(v) for k, v in sorted(implications.items())}
    return clean, {'source_rows': seen, 'active_rows': active,
                   'antecedent_tags': len(clean), 'relations': sum(map(len, clean.values()))}


def write_json(path: Path, obj):
    with path.open('w', encoding='utf-8') as out:
        json.dump(obj, out, ensure_ascii=False, separators=(',', ':'))
        out.write('\n')


def run(args):
    names = CORE
    categories = set(int(v) for v in args.categories.split(','))
    allowed_categories = set(range(9))
    if not categories or not categories <= allowed_categories:
        raise ValueError('Categories must be comma-separated integers from 0 through 8')
    if args.min_count < 0:
        raise ValueError('min-count must be >= 0')

    out_dir = Path(args.out_dir).resolve()
    cache_dir = Path(args.cache_dir).resolve()
    if args.source_dir:
        source_dir = Path(args.source_dir).resolve()
        if not source_dir.is_dir():
            raise FileNotFoundError(f'Source directory not found: {source_dir}')
    else:
        source_dir = None

    if args.manifest:
        manifest = json.loads(Path(args.manifest).read_text(encoding='utf-8'))
    elif source_dir:
        manifest = []  # Offline CSV archives can be used without a manifest.
    else:
        manifest = json.loads(fetch_bytes(EXPORTS_URL, args.user_agent, 2_000_000))
    if not isinstance(manifest, list):
        raise ValueError('e621 export index must be a JSON array')
    index = {item['name']: item for item in manifest if isinstance(item, dict) and 'name' in item}
    downloaded = {}
    provenance = {}
    for name in names:
        entry = index.get(name, {})
        filename = entry.get('file_name', f'{name}.csv.gz')
        if filename != f'{name}.csv.gz':
            raise ValueError(f'Unexpected filename for {name}: {filename}')
        if source_dir:
            archive = source_dir / filename
            if not archive.is_file():
                raise FileNotFoundError(archive)
        else:
            cache_dir.mkdir(parents=True, exist_ok=True)
            archive = cache_dir / filename
            expected_checksum = entry.get('checksum')
            expected_size = entry.get('file_size')
            cache_valid = (archive.exists() and not args.force and
                           (not expected_checksum or archive_hash(archive).lower() == expected_checksum.lower()) and
                           (not expected_size or archive.stat().st_size == int(expected_size)))
            if not cache_valid:
                if not entry.get('url'):
                    raise ValueError(f'Export index lacks a download URL for {name}')
                print(f'Downloading {name}...', file=sys.stderr)
                payload = fetch_bytes(entry['url'], args.user_agent, MAX_ARCHIVE_BYTES[name])
                with tempfile.NamedTemporaryFile(dir=cache_dir, prefix=name+'-', suffix='.part', delete=False) as f:
                    f.write(payload)
                    temp_path = Path(f.name)
                try:
                    if expected_checksum and archive_hash(temp_path).lower() != expected_checksum.lower():
                        raise ValueError(f'SHA-256 mismatch for {name}')
                    if expected_size and temp_path.stat().st_size != int(expected_size):
                        raise ValueError(f'Size mismatch for {name}')
                    os.replace(temp_path, archive)
                finally:
                    temp_path.unlink(missing_ok=True)
        # Check offline files too when given a manifest.
        if entry.get('checksum') and archive_hash(archive).lower() != entry['checksum'].lower():
            raise ValueError(f'SHA-256 mismatch for {archive}')
        if entry.get('file_size') and archive.stat().st_size != int(entry['file_size']):
            raise ValueError(f'Size mismatch for {archive}')
        downloaded[name] = archive
        provenance[name] = {'file_name': filename, 'sha256': archive_hash(archive),
                            'updated_at': entry.get('updated_at'),
                            'download_url': entry.get('url'), 'compressed_bytes': archive.stat().st_size}

    tags, tags_stats = transform_tags(downloaded['tags'], categories, args.min_count)
    aliases, aliases_stats = transform_aliases(downloaded['tag_aliases'])
    implications, implications_stats = transform_implications(downloaded['tag_implications'])
    stats = {'tags': tags_stats, 'tag_aliases': aliases_stats, 'tag_implications': implications_stats}
    output = {'tags.json': tags, 'aliases.json': aliases, 'implications.json': implications}
    meta = {'source': 'https://e621.net/db_exports.json',
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'categories': sorted(categories), 'min_post_count': args.min_count,
            'datasets': provenance, 'stats': stats}
    output['e621-source.json'] = meta

    # Write to staging and move only when *all* CSV parsing and validation succeed.
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='e621-build-', dir=out_dir) as temp:
        temp_dir = Path(temp)
        for filename, data in output.items():
            write_json(temp_dir / filename, data)
        for filename in output:
            os.replace(temp_dir / filename, out_dir / filename)
    print(json.dumps({'ok': True, 'output_dir': str(out_dir), 'stats': stats,
                      'source_files': list(downloaded)}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source-dir', help='Read local tags.csv.gz, tag_aliases.csv.gz, tag_implications.csv.gz (offline mode)')
    parser.add_argument('--manifest', help='Optional local saved db_exports.json manifest (hash verification/offline testing)')
    parser.add_argument('--out-dir', default=str(Path(__file__).resolve().parent.parent / 'references'))
    parser.add_argument('--cache-dir', default=str(Path(__file__).resolve().parent.parent / '.cache' / 'e621'))
    parser.add_argument('--categories', default='0,1,3,4,5,8', help='e621 categories (default: general, artist, copyright, character, species, lore)')
    parser.add_argument('--min-count', type=int, default=1, help='Keep tags with at least this many posts; 0 includes rare zero-post tags')
    parser.add_argument('--user-agent', default=os.environ.get('E621_USER_AGENT', 'MakeFoxPromptFormatter/2.0 (community vocabulary refresh)'), help='Use a descriptive User-Agent; ideally include your public project/contact URL')
    parser.add_argument('--force', action='store_true', help='Download again even when cached files match the manifest')
    try:
        run(parser.parse_args())
    except (ValueError, FileNotFoundError, urllib.error.URLError, EOFError, OSError, csv.Error, json.JSONDecodeError) as exc:
        print(f'e621 refresh failed: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
