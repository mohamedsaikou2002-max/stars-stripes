#!/usr/bin/env python3
"""Turn a full-text book you are licensed to use into reviewed JSONL passages for the retrieval store.

  python scripts/ingest_book.py --file us_history.pdf --id openstax-ushistory \
      --title "U.S. History (OpenStax)" --author "OpenStax" --url https://openstax.org/details/books/us-history \
      --license "CC BY 4.0 - attribution required" --category history --jurisdiction historical
  python scripts/import_civic_corpus.py corpus/openstax-ushistory.jsonl --upload

Accepts .txt .md .html .epub .pdf (PDF needs `pdftotext` from poppler, or the `pypdf` package).
Only ingest books that are public domain or whose license permits copying into your own product.
"""
import argparse, datetime, hashlib, html, json, re, subprocess, sys, zipfile
from html.parser import HTMLParser
from pathlib import Path

CHUNK, OVERLAP, MIN_BREAK = 2400, 150, 1200
HEADING = re.compile(r'^\s*((?:CHAPTER|Chapter|BOOK|Book|PART|Part|SECTION|Section|ARTICLE|Article|No\.|NUMBER|Number)\s+[\w.\-]+[^\n]{0,80})\s*$')


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.out = []; self.skip = 0
    def handle_starttag(self, t, a):
        if t in ('script', 'style', 'nav'): self.skip += 1
        if t in ('p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'section', 'tr'): self.out.append('\n')
    def handle_endtag(self, t):
        if t in ('script', 'style', 'nav'): self.skip = max(0, self.skip - 1)
        if t in ('p', 'h1', 'h2', 'h3', 'h4', 'li'): self.out.append('\n')
    def handle_data(self, d):
        if not self.skip: self.out.append(d)


def from_html(raw: str) -> str:
    p = _Text(); p.feed(raw); return html.unescape(''.join(p.out))


def read_text(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in ('.txt', '.md'):
        return path.read_text(encoding='utf-8', errors='replace')
    if ext in ('.html', '.htm', '.xhtml'):
        return from_html(path.read_text(encoding='utf-8', errors='replace'))
    if ext == '.epub':
        with zipfile.ZipFile(path) as z:
            names = sorted(n for n in z.namelist() if n.lower().endswith(('.xhtml', '.html', '.htm')))
            return '\n'.join(from_html(z.read(n).decode('utf-8', 'replace')) for n in names)
    if ext == '.pdf':
        try:
            return subprocess.run(['pdftotext', '-layout', str(path), '-'], check=True, capture_output=True, text=True).stdout
        except (FileNotFoundError, subprocess.CalledProcessError):
            try:
                from pypdf import PdfReader
            except ImportError:
                sys.exit('PDF support needs `pdftotext` (poppler-utils) or `pip install pypdf`.')
            return '\n'.join((pg.extract_text() or '') for pg in PdfReader(str(path)).pages)
    sys.exit(f'Unsupported file type: {ext}')


def clean(text: str) -> str:
    text = text.replace('\r\n', '\n').lstrip('\ufeff')
    a = re.search(r'\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\n', text, re.I)
    b = re.search(r'\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK', text, re.I)
    if a: text = text[a.end(): b.start() if b else len(text)]
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'-\n(?=[a-z])', '', text)          # re-join hyphenated line breaks (PDF)
    text = re.sub(r'(?<![.!?:\n])\n(?!\n)', ' ', text)  # unwrap hard-wrapped lines inside paragraphs
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def chunks(text: str):
    heading, off = '', 0
    while off < len(text):
        end = min(off + CHUNK, len(text))
        if end < len(text):
            cut = text.rfind('\n\n', off + MIN_BREAK, end)
            if cut < 0: cut = text.rfind('. ', off + MIN_BREAK, end) + 1
            if cut > off: end = cut
        piece = text[off:end].strip()
        for line in piece.split('\n'):
            m = HEADING.match(line)
            if m: heading = m.group(1).strip()
        if piece: yield heading, piece
        if end >= len(text): break
        off = max(end - OVERLAP, off + 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--file', required=True, type=Path)
    ap.add_argument('--id', required=True, help='short slug, e.g. openstax-ushistory (becomes the passage id prefix)')
    ap.add_argument('--title', required=True); ap.add_argument('--author', default='')
    ap.add_argument('--url', required=True, help='https URL of the canonical source (shown as the citation)')
    ap.add_argument('--license', required=True, help='e.g. "Public domain (United States)" or "CC BY 4.0"')
    ap.add_argument('--category', default='history'); ap.add_argument('--jurisdiction', default='historical')
    ap.add_argument('--out', type=Path)
    a = ap.parse_args()
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,40}', a.id): sys.exit('--id must be lowercase letters, digits, hyphens')
    if not a.url.startswith('https://'): sys.exit('--url must be https')
    text = clean(read_text(a.file))
    if len(text) < 2000: sys.exit('Extracted text is suspiciously short; is the file scanned images (needs OCR)?')
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    rows = []
    for i, (h, piece) in enumerate(chunks(text), 1):
        title = (a.title + (f': {h}' if h else ''))[:300]
        row = dict(id=f'{a.id}-{i}', title=title, url=a.url, jurisdiction=a.jurisdiction, category=a.category,
                   retrieved_at=now, text=piece, license=a.license)
        if a.author: row['author'] = a.author
        rows.append(row)
    out = a.out or Path(__file__).resolve().parents[1] / 'corpus' / f'{a.id}.jsonl'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows), encoding='utf-8')
    print(f'{len(rows)} passages, {len(text):,} characters, sha256 {hashlib.sha256(text.encode()).hexdigest()[:16]} -> {out}')


if __name__ == '__main__':
    main()
