#!/usr/bin/env python3
"""Builds the "How it was built" page from an export of the Linear board.

Reads issues.json and milestones.json from EXPORT_DIR (kept outside this repository), merges
scripts/how-it-was-built.json (one sentence per ticket, reworded titles, pull requests the board
never attached), refuses any banned string, and rewrites the generated blocks of
apps/web/public/how-it-was-built/index.html. Only tickets with a summary are published; links to
any other ticket are dropped. No description or comment text is read into the output.

Data rules: a title loses its task-number prefix ("1.7 ", "5.0b "; an epic keeps its E-number) and
any date in it; a blocking link is shown only when the blocker closed no later than the ticket it
blocks (to the minute), or the blocked ticket is still open.

    python3 scripts/how-it-was-built.py EXPORT_DIR    # rebuild the page
    python3 scripts/how-it-was-built.py --check-page  # banned-string check of the committed page

The page is generated output (Prettier skips it), so a rebuild of an unchanged export reproduces it
byte for byte. Besides the generic technical patterns below, private patterns are read, when the
file exists, from $BANNED_PATTERNS_FILE or ~/.config/collaborative-gis/banned-patterns.txt: one
regular expression per line, `#` starts a comment, kept outside the repository. A hit names the
ticket and field or the page line, never the pattern or the matched text, so a CI log stays clean.
Standard library only.
"""

from __future__ import annotations

import argparse
import html
import json
import math
import os
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'scripts' / 'how-it-was-built.json'
PAGE = ROOT / 'apps' / 'web' / 'public' / 'how-it-was-built' / 'index.html'
PRIVATE_PATTERNS = Path.home() / '.config' / 'collaborative-gis' / 'banned-patterns.txt'

# What never reaches the public page, matched case-insensitively; \s+ also spans a wrapped line.
BANNED = [
    ('a URL', r'https?://|\bwww\.'),
    (
        'a hostname',
        r'\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|cloud|co|il|me|ai|xyz|info|page|site|tech|sh|run)\b',
    ),
    ('an email address', r'[\w.+-]+@[\w-]+\.[a-z]{2,}'),
    ('a password-manager reference', r'1password|\bop://|\bvaults?\b'),
    ('a home path', r'~/|/home/|/users/|/root/|\b[a-z]:\\'),
    ('a Linear workspace reference', r'linear\.app|linear\s+workspace'),
    ('a commit hash', r'\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b'),
]

STATES = {'completed': 'done', 'canceled': 'canceled'}  # anything else is open
STATE_LABEL = {'done': 'Done', 'canceled': 'Canceled', 'open': 'Open'}
MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()
# Map geometry in SVG user units: ticket box, gap, cell padding, epic column, header band.
BOX_W, BOX_H, GAP, PAD, LABEL_W, HEAD_H = 40, 24, 6, 10, 196, 48


def patterns() -> list[tuple[str, re.Pattern[str]]]:
    """The generic patterns, then the private file's, compiled."""
    found = [(name, re.compile(rx, re.I)) for name, rx in BANNED]
    path = Path(os.environ.get('BANNED_PATTERNS_FILE') or PRIVATE_PATTERNS)
    if not path.exists():
        return found
    lines = path.read_text(encoding='utf-8').splitlines()
    for n, line in enumerate(lines, 1):
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        try:
            found.append((f'private pattern {n}', re.compile(line.strip(), re.I)))
        except re.error:
            sys.exit(f'private pattern {n} is not a valid regular expression')
    return found


def number(ticket_id: str) -> int:
    return int(ticket_id.rsplit('-', 1)[1])


def minute(ts: str | None) -> str | None:
    """2026-10-12T13:18:01.812Z -> 2026-10-12T13:18Z (UTC, to the minute)."""
    return ts[:16] + 'Z' if ts else None


def clean_title(title: str) -> str:
    """'1.7 Seed (ruling 2026-10-13)' -> 'Seed (ruling)'; 'E0 Foundation' stays."""
    title = re.sub(r'^\d+(?:\.\d+)*[a-z]?\s+', '', title)
    return re.sub(r',?\s*\b\d{4}-\d\d-\d\d\b', '', title)


def closed_at(issue: dict) -> str | None:
    return minute(issue['completedAt'] or issue['canceledAt'])


def holds(blocker: dict, blocked: dict) -> bool:
    """A blocking link is shown unless the blocker closed after the ticket it blocks."""
    done = closed_at(blocked)
    return done is None or (closed_at(blocker) or '9999') <= done


def build(issues: list[dict], milestones: list[dict], data: dict) -> dict:
    """The public shape: milestones, the longest blocking chain, and one record per ticket."""
    summaries, titles, extra_prs = data['summaries'], data.get('titles', {}), data.get('prs', {})
    by_id = {i['identifier']: i for i in issues}
    for key, ids in (('summaries', summaries), ('titles', titles), ('prs', extra_prs)):
        unknown = sorted(set(ids) - set(by_id), key=number)
        if unknown:
            sys.exit(f'{key}: not in the export: {", ".join(unknown)}')
    orphans = sorted((set(titles) | set(extra_prs)) - set(summaries), key=number)
    if orphans:
        sys.exit(f'a title or PRs without a summary (so never published): {", ".join(orphans)}')
    for tid, text in summaries.items():
        if not re.fullmatch(r'[^\n]+[.!?]', text) or re.search(r'[.!?]\s', text):
            sys.exit(f'{tid}: the summary must be one sentence')

    keep = sorted(summaries, key=number)
    parents = {by_id[t]['parentId'] for t in keep}

    def epic(issue: dict) -> str | None:
        top = issue
        while top['parentId'] in summaries:
            top = by_id[top['parentId']]
        return top['identifier'] if top['identifier'] in parents else None

    def links(issue: dict, key: str) -> list[str]:
        ids = (t for t in issue[key] if t in summaries)
        if key == 'blockedBy':
            ids = (t for t in ids if holds(by_id[t], issue))
        elif key == 'blocks':
            ids = (t for t in ids if holds(issue, by_id[t]))
        return sorted(ids, key=number)

    tickets = []
    for tid in keep:
        i = by_id[tid]
        milestone = (i['projectMilestone'] or {}).get('name')
        prs = {int(n) for a in i['attachments'] for n in re.findall(r'/pull/(\d+)', a['url'])}
        tickets.append(
            {
                'id': tid,
                'title': clean_title(titles.get(tid, i['title'])),
                'epic': epic(i),
                'milestone': milestone.split()[0] if milestone else None,
                'lane': next((l.split(':', 1)[1] for l in i['labels'] if l.startswith('lane:')), None),
                'state': STATES.get(i['statusType'], 'open'),
                'created': minute(i['createdAt']),
                'started': minute(i['startedAt']),
                'closed': closed_at(i),
                'blockedBy': links(i, 'blockedBy'),
                'blocks': links(i, 'blocks'),
                'related': links(i, 'related'),
                'prs': sorted(prs | set(extra_prs.get(tid, []))),
                'summary': summaries[tid],
            }
        )
    return {
        'milestones': [
            {'id': m['name'].split()[0], 'name': m['name'].partition(' ')[2]}
            for m in sorted(milestones, key=lambda m: m['name'])
        ],
        'chain': longest_chain(tickets),
        'tickets': tickets,
    }


def chains(tickets: list[dict]) -> dict[str, list[str]]:
    """For each ticket, the longest blocking chain that ends at it (ties: lower numbers first)."""
    by_id = {t['id']: t for t in tickets}
    memo: dict[str, list[str] | None] = {}

    def walk(tid: str) -> list[str]:
        if tid in memo:
            if memo[tid] is None:
                sys.exit(f'blocking cycle through {tid}')
            return memo[tid]
        memo[tid] = None
        memo[tid] = max((walk(b) for b in by_id[tid]['blockedBy']), key=len, default=[]) + [tid]
        return memo[tid]

    return {t['id']: walk(t['id']) for t in tickets}


def longest_chain(tickets: list[dict]) -> list[str]:
    return max(chains(tickets).values(), key=len, default=[])


def hits_in_data(public: dict, found: list) -> list[str]:
    """`TOM-18 title: a hostname` for every banned pattern in a published value."""
    rows = [(t['id'], key, value) for t in public['tickets'] for key, value in t.items()]
    rows += [(m['id'], 'milestone name', m['name']) for m in public['milestones']]
    return [
        f'{where} {key}: {name}'
        for where, key, value in rows
        for name, rx in found
        if rx.search(json.dumps(value, ensure_ascii=False))
    ]


def hits_in_page(text: str, found: list, label: str) -> list[str]:
    return [
        f'{label} line {text.count(chr(10), 0, m.start()) + 1}: {name}'
        for name, rx in found
        for m in rx.finditer(text)
    ]


# ---- rendering: static markup, so the page reads fully without JavaScript ----


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def when(ts: str | None) -> str:
    return f'{int(ts[8:10])} {MONTHS[int(ts[5:7]) - 1]} {ts[11:16]}' if ts else '—'


def short(title: str) -> str:
    """An epic's row label: its title before any parenthesis."""
    return title.split(' (')[0]


def render(public: dict) -> dict[str, str]:
    tickets = public['tickets']
    by_id = {t['id']: t for t in tickets}
    epics = sorted((t for t in tickets if t['epic'] == t['id']), key=lambda t: t['title'])
    loose = [t for t in tickets if t['epic'] is None]
    payload = json.dumps(public, ensure_ascii=False, indent=2).replace('</', '<\\/')
    return {
        'tiles': tiles(public, epics),
        'map': svg_map(public, epics, by_id),
        'lanes': lanes(tickets),
        'epics': '\n'.join(
            [details(e['title'], e, children(tickets, e['id'])) for e in epics]
            + ([details('Outside the epics', None, loose)] if loose else [])
        ),
        'data': f'<script type="application/json" id="build-map">\n{payload}\n</script>',
    }


def children(tickets: list[dict], epic_id: str) -> list[dict]:
    return [t for t in tickets if t['epic'] == epic_id and t['id'] != epic_id]


def counts(tickets: list[dict]) -> str:
    states = [s for s in STATE_LABEL if any(t['state'] == s for t in tickets)]
    return ', '.join(f'{sum(t["state"] == s for t in tickets)} {s}' for s in states)


def tile(key: str, label: str, value: str, src: str) -> str:
    return (
        f'<div class="tile" data-tile="{key}"><div class="label">{label}</div>'
        f'<div class="value">{value}</div><div class="src">{src}</div></div>'
    )


def tiles(public: dict, epics: list[dict]) -> str:
    tickets, chain, ms = public['tickets'], public['chain'], public['milestones']
    first = min(t['created'] for t in tickets)
    last = max(t['closed'] for t in tickets if t['closed'])
    span = datetime.strptime(last, '%Y-%m-%dT%H:%MZ') - datetime.strptime(first, '%Y-%m-%dT%H:%MZ')
    prs = {p for t in tickets for p in t['prs']}
    return '\n'.join(
        [
            tile(
                'tickets',
                'Tickets',
                str(len(tickets)),
                f'{len(epics)} epics and {len(tickets) - len(epics)} tasks: {counts(tickets)}.',
            ),
            tile('milestones', 'Milestones', str(len(ms)), f'{ms[0]["id"]} to {ms[-1]["id"]}.' if ms else ''),
            tile(
                'hours',
                'First ticket to last close',
                f'{round(span.total_seconds() / 3600)}<small>h</small>',
                f'{when(first)} to {when(last)} UTC.',
            ),
            tile('prs', 'Pull requests on the tickets', str(len(prs)), 'Numbers only, printed as text.'),
            tile(
                'chain',
                'Longest blocking chain',
                f'{len(chain)}<small>tickets</small>',
                f'{chain[0]} to {chain[-1]}, the accent line on the map.' if chain else '',
            ),
        ]
    )


def svg_map(public: dict, epics: list[dict], by_id: dict) -> str:
    tickets = public['tickets']
    depth = {tid: len(c) for tid, c in chains(tickets).items()}
    rows = [e['id'] for e in epics] + ([None] if any(t['epic'] is None for t in tickets) else [])
    boxed = [t for t in tickets if t['epic'] != t['id']]
    cols = [m['id'] for m in public['milestones']] + ([None] if any(t['milestone'] is None for t in boxed) else [])
    cells: dict[tuple, list[dict]] = {}
    for t in boxed:
        cells.setdefault((t['epic'], t['milestone']), []).append(t)
    for cell in cells.values():
        cell.sort(key=lambda t: (depth[t['id']], number(t['id'])))
    # Box columns per milestone: about square for its fullest cell, at least two.
    per = {c: max(2, math.ceil(math.sqrt(max((len(v) for k, v in cells.items() if k[1] == c), default=1)))) for c in cols}
    col_x, x = {}, LABEL_W
    for c in cols:
        col_x[c] = x
        x += 2 * PAD + per[c] * BOX_W + (per[c] - 1) * GAP
    width, row_y, y = x, {}, HEAD_H
    for r in rows:
        lines = max([math.ceil(len(cells.get((r, c), [])) / per[c]) for c in cols] + [1])
        row_y[r] = (y, lines * BOX_H + (lines - 1) * GAP)
        y += 2 * PAD + row_y[r][1]
    height = y

    pos = {e['id']: (8, row_y[e['id']][0] + PAD, LABEL_W - 20, row_y[e['id']][1]) for e in epics}
    for (r, c), cell in cells.items():
        for k, t in enumerate(cell):
            pos[t['id']] = (
                col_x[c] + PAD + (k % per[c]) * (BOX_W + GAP),
                row_y[r][0] + PAD + (k // per[c]) * (BOX_H + GAP),
                BOX_W,
                BOX_H,
            )

    def center(tid: str) -> str:
        bx, by, w, h = pos[tid]
        return f'{bx + w / 2:g},{by + h / 2:g}'

    names = {m['id']: m['name'] for m in public['milestones']}
    out = [
        f'<svg id="map" viewBox="0 0 {width} {height}" role="group" aria-label="Ticket map: milestones '
        'left to right, epics top to bottom, one box per ticket. Each box is a link; focusing it shows '
        'its links below the map. The lists further down carry the same tickets as text.">'
    ]
    out.append('<text class="mh" x="16" y="18">Epic</text>')
    for c in cols:
        cx = col_x[c] + PAD
        out.append(f'<text class="mh" x="{cx}" y="18">{esc(c or "Other")}</text>')
        out.append(f'<text class="s" x="{cx}" y="35">{esc(names.get(c, "No milestone"))}</text>')
        out.append(f'<path class="grid" d="M{col_x[c]},{HEAD_H - 8} V{height}" />')
    for r in rows:
        out.append(f'<path class="grid" d="M0,{row_y[r][0]} H{width}" />')
        if r is None:
            ty = row_y[r][0] + PAD + row_y[r][1] / 2 + 4
            out.append(f'<text class="s" x="16" y="{ty:g}">Outside the epics</text>')
    chain = public['chain']
    if len(chain) > 1:
        out.append(f'<polyline class="chain" points="{" ".join(center(t) for t in chain)}" />')
    out.append('<g id="links" aria-hidden="true"></g>')
    on_chain = set(chain)
    for t in epics + boxed:
        bx, by, w, h = pos[t['id']]
        is_epic = t['epic'] == t['id']
        label = short(t['title']) if is_epic else str(number(t['id']))
        cls = f'tk {t["state"]}' + (' epic' if is_epic else '') + (' on-chain' if t['id'] in on_chain else '')
        tx, anchor = (bx + 10, 'start') if is_epic else (bx + w / 2, 'middle')
        out.append(
            f'<a class="{cls}" href="#{t["id"]}"><title>{esc(t["id"])} · {esc(t["title"])} · '
            f'{STATE_LABEL[t["state"]]}</title><rect x="{bx}" y="{by}" width="{w}" height="{h}" rx="5" />'
            f'<text x="{tx:g}" y="{by + h / 2 + 4:g}" text-anchor="{anchor}">{esc(label)}</text></a>'
        )
    out.append('</svg>')
    present = [s for s in STATE_LABEL if any(t['state'] == s for t in tickets)]
    legend = ''.join(f'<span><i class="sw {s}"></i>{STATE_LABEL[s]}</span>' for s in present)
    legend += (
        '<span><i class="ln chain"></i>Longest chain</span><span><i class="ln in"></i>Blocked by</span>'
        '<span><i class="ln out"></i>Blocks</span><span><i class="ln rel"></i>Related</span>'
    )
    return f'<p class="legend">{legend}</p>\n<div class="arch">{"".join(out)}</div>'


def lanes(tickets: list[dict]) -> str:
    groups: dict[str | None, list[dict]] = {}
    for t in tickets:
        groups.setdefault(t['lane'], []).append(t)
    order = sorted(groups, key=lambda lane: (lane is None, number(groups[lane][0]['id'])))
    rows = ''.join(
        f'<tr><td>{esc(lane or "no lane label")}</td><td class="n">{len(groups[lane])}</td>'
        f'<td>{counts(groups[lane])}</td></tr>'
        for lane in order
    )
    return f'<table class="lanes"><thead><tr><th>Lane</th><th class="n">Tickets</th><th>State</th></tr></thead><tbody>{rows}</tbody></table>'


def ref_list(ids: list[str]) -> str:
    return ', '.join(f'<a href="#{t}">{t}</a>' for t in ids)


def meta(t: dict) -> str:
    """One line of fields: lane, milestone, dates, PR numbers as text, links within the page."""
    parts = [
        f'lane {esc(t["lane"])}' if t['lane'] else 'no lane label',
        t['milestone'] or 'no milestone',
        f'created {when(t["created"])}',
        f'started {when(t["started"])}',
        f'closed {when(t["closed"])}',
    ]
    if t['prs']:
        parts.append(('PRs ' if len(t['prs']) > 1 else 'PR ') + ', '.join(f'#{p}' for p in t['prs']))
    for key, label in (('blockedBy', 'blocked by'), ('blocks', 'blocks'), ('related', 'related to')):
        if t[key]:
            parts.append(f'{label} {ref_list(t[key])}')
    return f'<p class="meta">{" · ".join(parts)}</p>'


def details(title: str, epic: dict | None, items: list[dict]) -> str:
    """One block per epic: the epic is the heading (its own sentence and fields), its tasks the list."""
    count = f'{len(items)} task' + ('' if len(items) == 1 else 's')
    if epic:
        count = f'{epic["id"]} · {count}'
    head = f'<summary><span class="t">{esc(short(title))}</span> <span class="n">{count}</span></summary>'
    if epic:
        head += (
            f'<div class="ep" id="{epic["id"]}"><p><span class="st {epic["state"]}">'
            f'{STATE_LABEL[epic["state"]]}</span> {esc(epic["summary"])}</p>{meta(epic)}</div>'
        )
    entries = []
    for t in items:
        entries.append(
            f'<li id="{t["id"]}"><p class="h"><code>{t["id"]}</code> <span>{esc(t["title"])}</span> '
            f'<span class="st {t["state"]}">{STATE_LABEL[t["state"]]}</span></p>'
            f'<p>{esc(t["summary"])}</p>{meta(t)}</li>'
        )
    # Open by default: a map box links to its entry, which must land on visible text without JS.
    return f'<details class="epic" open>{head}<ol class="tickets">{"".join(entries)}</ol></details>'


def write_blocks(text: str, blocks: dict[str, str], label: str) -> str:
    for name, body in blocks.items():
        rx = re.compile(rf'(<!-- gen:{name} -->).*?(<!-- /gen:{name} -->)', re.S)
        if not rx.search(text):
            sys.exit(f'{label}: no <!-- gen:{name} --> block')
        text = rx.sub(lambda m: f'{m.group(1)}\n{body}\n{m.group(2)}', text, count=1)
    return text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Build or check the "How it was built" page.')
    parser.add_argument('export', nargs='?', type=Path, help='folder with issues.json and milestones.json')
    parser.add_argument('--data', type=Path, default=DATA, help='summaries, titles and PRs (JSON)')
    parser.add_argument('--page', type=Path, default=PAGE, help='the page to rewrite or check')
    parser.add_argument('--check-page', action='store_true', help='only check the page; write nothing')
    args = parser.parse_args(argv)
    found = patterns()

    if args.check_page:
        hits = hits_in_page(args.page.read_text(encoding='utf-8'), found, args.page.name)
    else:
        if args.export is None:
            parser.error('EXPORT_DIR is required unless --check-page is given')
        read = lambda path: json.loads(path.read_text(encoding='utf-8'))  # noqa: E731
        issues, milestones = read(args.export / 'issues.json'), read(args.export / 'milestones.json')
        public = build(issues, milestones, read(args.data))
        hits = hits_in_data(public, found)
        if not hits:
            text = write_blocks(args.page.read_text(encoding='utf-8'), render(public), args.page.name)
            hits = hits_in_page(text, found, args.page.name)
        if not hits:
            args.page.write_text(text, encoding='utf-8')
            published = len(public['tickets'])
            print(f'{published} tickets written to {args.page}; {len(issues) - published} in the export not published')
    for hit in hits:
        print(f'banned: {hit}', file=sys.stderr)
    return 1 if hits else 0


if __name__ == '__main__':
    sys.exit(main())
