/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

// The static page public/how-it-was-built/index.html and its generator
// scripts/how-it-was-built.py (Python, standard library; CI runners carry python3).
const script = join(import.meta.dirname, '../../../scripts/how-it-was-built.py');
const page = join(import.meta.dirname, '../public/how-it-was-built/index.html');
const guide = join(import.meta.dirname, '../public/guide/index.html');

// The public shape, strict: a field the transform should never publish (description, url) fails.
const Ticket = z.strictObject({
  id: z.string().regex(/^TOM-\d+$/),
  title: z.string().min(1),
  epic: z.string().nullable(),
  milestone: z.string().nullable(),
  lane: z.string().nullable(),
  state: z.enum(['done', 'canceled', 'open']),
  created: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/),
  started: z.string().nullable(),
  closed: z.string().nullable(),
  blockedBy: z.array(z.string()),
  blocks: z.array(z.string()),
  related: z.array(z.string()),
  prs: z.array(z.number().int().positive()),
  summary: z.string().min(1),
});
const BuildMap = z.strictObject({
  milestones: z.array(z.strictObject({ id: z.string(), name: z.string() })),
  chain: z.array(z.string()),
  tickets: z.array(Ticket),
});

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const buildMap = (doc: Document) =>
  BuildMap.parse(JSON.parse(doc.getElementById('build-map')?.textContent ?? 'null'));

const work = mkdtempSync(join(tmpdir(), 'how-it-was-built-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** The script on `args`; without a private patterns file unless `patterns` names one. */
function run(args: string[], patterns = join(work, 'no-patterns.txt')) {
  return spawnSync('python3', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, BANNED_PATTERNS_FILE: patterns },
  });
}

describe('how-it-was-built/index.html as committed', () => {
  const doc = parse(readFileSync(page, 'utf8'));
  const data = buildMap(doc);
  const byId = new Map(data.tickets.map((t) => [t.id, t]));

  it('publishes 93 unique tickets whose links all resolve, blocks mirroring blockedBy', () => {
    expect(data.tickets).toHaveLength(93);
    expect(byId.size).toBe(93);
    for (const t of data.tickets) {
      for (const id of [...t.blockedBy, ...t.blocks, ...t.related])
        expect(byId.has(id), id).toBe(true);
      for (const id of t.blockedBy)
        expect(byId.get(id)?.blocks, `${id} blocks ${t.id}`).toContain(t.id);
      for (const id of t.related) expect(byId.get(id)?.related, `${id} ~ ${t.id}`).toContain(t.id);
    }
  });

  it('draws the longest chain as consecutive blocking links', () => {
    expect(data.chain.length).toBeGreaterThan(1);
    data.chain
      .slice(1)
      .forEach((id, k) => expect(byId.get(id)?.blockedBy).toContain(data.chain[k]));
  });

  it('gives every ticket one box in the map and one entry in the lists', () => {
    const boxes = [...doc.querySelectorAll('#map a.tk')].map((a) => a.getAttribute('href'));
    expect(boxes.toSorted()).toEqual(data.tickets.map((t) => `#${t.id}`).toSorted());
    for (const t of data.tickets) {
      expect(doc.querySelector(`details.epic [id="${t.id}"]`), t.id).not.toBeNull();
    }
    // Open blocks: a box's link lands on visible text even without JavaScript.
    expect(doc.querySelectorAll('details.epic:not([open])')).toHaveLength(0);
  });

  it('counts in each block exactly the tasks it lists, the epic being the heading', () => {
    const tasks = data.tickets.filter((t) => t.epic !== t.id);
    expect(doc.querySelectorAll('details.epic li')).toHaveLength(tasks.length);
    for (const block of doc.querySelectorAll('details.epic')) {
      const listed = block.querySelectorAll('li').length;
      const label = block.querySelector('summary .n')?.textContent ?? '';
      expect(label.endsWith(`${listed} task${listed === 1 ? '' : 's'}`), label).toBe(true);
    }
  });

  it('drops task numbers and dates from titles and links to blockers that closed later', () => {
    for (const t of data.tickets) {
      expect(t.title, t.id).not.toMatch(/^\d|\d{4}-\d\d-\d\d/);
      for (const id of t.blockedBy) {
        const closed = byId.get(id)?.closed;
        if (t.closed) expect(closed && closed <= t.closed, `${id} → ${t.id}`).toBe(true);
      }
    }
  });

  it('states the tiles from the data', () => {
    const tile = (key: string) => doc.querySelector(`[data-tile="${key}"] .value`)?.textContent;
    expect(tile('tickets')).toBe(String(data.tickets.length));
    expect(tile('milestones')).toBe(String(data.milestones.length));
    expect(tile('prs')).toBe(String(new Set(data.tickets.flatMap((t) => t.prs)).size));
    expect(tile('chain')?.startsWith(String(data.chain.length))).toBe(true);
  });

  it('loads nothing from another origin', () => {
    const external = [...doc.querySelectorAll('[src], link[href]')].map(
      (el) => el.getAttribute('src') ?? el.getAttribute('href'),
    );
    expect(external).toEqual([]);
  });

  it('passes the banned-string check', () => {
    const result = run(['--check-page', '--page', page], process.env.BANNED_PATTERNS_FILE ?? '');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('is linked from the guide header and its documentation map', () => {
    const g = parse(readFileSync(guide, 'utf8'));
    const href = 'a[href="../how-it-was-built/index.html"]';
    expect(g.querySelector(`#start ${href}`)).not.toBeNull();
    expect(g.querySelector(`#docs ${href}`)).not.toBeNull();
  });
});

describe('scripts/how-it-was-built.py', () => {
  /** A Linear export record with every field the script reads, plus private ones it must drop. */
  const issue = (id: string, fields: Record<string, unknown> = {}) => ({
    identifier: id,
    title: `${id} title`,
    description: 'private description text',
    url: `https://tracker.example/issue/${id}`,
    parentId: null,
    projectMilestone: null,
    labels: [],
    statusType: 'completed',
    createdAt: '2026-10-12T13:14:05.000Z',
    startedAt: '2026-10-12T14:00:00.000Z',
    completedAt: '2026-10-12T15:30:00.000Z',
    canceledAt: null,
    blockedBy: [],
    blocks: [],
    related: [],
    attachments: [],
    ...fields,
  });
  const m0 = { name: 'M0 Foundation' };
  const issues = [
    issue('TOM-1', { title: 'E0 Foundation' }),
    issue('TOM-2', {
      title: '1.7 First task (ruling 2026-10-13)',
      parentId: 'TOM-1',
      projectMilestone: m0,
      labels: ['lane:foundation'],
      blockedBy: ['TOM-5'],
      blocks: ['TOM-3'],
      attachments: [{ url: 'https://github.com/owner/repo/pull/9' }],
    }),
    issue('TOM-3', {
      parentId: 'TOM-1',
      projectMilestone: m0,
      statusType: 'canceled',
      completedAt: null,
      canceledAt: '2026-10-12T16:00:00.000Z',
      blockedBy: ['TOM-2', 'TOM-4'],
      related: ['TOM-4'],
    }),
    issue('TOM-4', { blocks: ['TOM-3'], related: ['TOM-3'] }),
    // Closed after the ticket it blocks: the link is not shown on either side.
    issue('TOM-5', {
      parentId: 'TOM-1',
      projectMilestone: m0,
      completedAt: '2026-10-12T17:00:00.000Z',
      blocks: ['TOM-2'],
    }),
  ];
  const data = {
    summaries: {
      'TOM-1': 'The epic.',
      'TOM-2': 'The first task.',
      'TOM-3': 'The second task.',
      'TOM-5': 'The late task.',
    },
    titles: { 'TOM-3': 'Reworded title' },
    prs: { 'TOM-3': [12] },
  };

  /** A fresh export folder, data file and copy of the committed page; returns their paths. */
  function fixture(name: string, summaries = data.summaries, titles = data.titles) {
    const dir = join(work, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'issues.json'), JSON.stringify(issues));
    writeFileSync(
      join(dir, 'milestones.json'),
      JSON.stringify([{ ...m0, description: 'private milestone text' }]),
    );
    writeFileSync(join(dir, 'data.json'), JSON.stringify({ ...data, summaries, titles }));
    copyFileSync(page, join(dir, 'index.html'));
    const args = [dir, '--data', join(dir, 'data.json'), '--page', join(dir, 'index.html')];
    return { args, out: join(dir, 'index.html') };
  }

  it('turns an export into the public shape: fields only, unpublished tickets and links dropped', () => {
    const { args, out } = fixture('ok');
    const result = run(args);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    // A count only: the ids of unpublished tickets never reach the output.
    expect(result.stdout).toContain('4 tickets written');
    expect(result.stdout).toContain('1 in the export not published');
    expect(result.stdout).not.toContain('TOM-4');
    const html = readFileSync(out, 'utf8');
    expect(html).not.toContain('private description text');
    expect(html).not.toContain('private milestone text');
    expect(html).not.toContain('tracker.example');
    const doc = parse(html);
    const built = buildMap(doc);
    expect(built.milestones).toEqual([{ id: 'M0', name: 'Foundation' }]);
    expect(built.chain).toEqual(['TOM-2', 'TOM-3']);
    expect(built.tickets.map((t) => t.id)).toEqual(['TOM-1', 'TOM-2', 'TOM-3', 'TOM-5']);
    const [epic, first, second, late] = built.tickets;
    expect(epic).toMatchObject({ epic: 'TOM-1', milestone: null, lane: null, state: 'done' });
    // Its task number and date leave the title; the late blocker's link leaves both sides.
    expect(first).toMatchObject({
      title: 'First task (ruling)',
      epic: 'TOM-1',
      milestone: 'M0',
      lane: 'foundation',
      created: '2026-10-12T13:14Z',
      started: '2026-10-12T14:00Z',
      closed: '2026-10-12T15:30Z',
      blockedBy: [],
      blocks: ['TOM-3'],
      prs: [9],
    });
    expect(late).toMatchObject({ closed: '2026-10-12T17:00Z', blocks: [] });
    expect(second).toMatchObject({
      title: 'Reworded title',
      state: 'canceled',
      closed: '2026-10-12T16:00Z',
      blockedBy: ['TOM-2'],
      related: [],
      prs: [12],
      summary: 'The second task.',
    });
    expect(doc.querySelectorAll('#map a.tk')).toHaveLength(4);
    expect(doc.querySelector('details.epic .ep[id="TOM-1"]')).not.toBeNull();
    expect(doc.querySelectorAll('details.epic li')).toHaveLength(3);
    expect(doc.querySelector('details.epic summary .n')?.textContent).toBe('TOM-1 · 3 tasks');
    expect(doc.querySelector('[data-tile="tickets"] .value')?.textContent).toBe('4');
  });

  it('refuses a hostname or a commit hash in any field, and leaves the page unchanged', () => {
    const { args, out } = fixture(
      'banned',
      { ...data.summaries, 'TOM-2': 'Deployed to cgis.example.dev from 3f9c2ab1.' },
      { 'TOM-3': 'Moved to cgis.example.dev' },
    );
    const before = readFileSync(out, 'utf8');
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TOM-2 summary: a hostname');
    expect(result.stderr).toContain('TOM-2 summary: a commit hash');
    expect(result.stderr).toContain('TOM-3 title: a hostname');
    expect(readFileSync(out, 'utf8')).toBe(before);
  });

  it('reads the private patterns file and names the pattern by line only', () => {
    // A made-up token stands in for the private names; the file lives outside the repository.
    const { args, out } = fixture('private', { ...data.summaries, 'TOM-3': 'The quokka task.' });
    const patterns = join(work, 'private', 'patterns.txt');
    writeFileSync(patterns, '# one regular expression per line\nquok+a\n');
    const before = readFileSync(out, 'utf8');
    const result = run(args, patterns);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TOM-3 summary: private pattern 2');
    expect(result.stderr).not.toContain('quok');
    expect(readFileSync(out, 'utf8')).toBe(before);
  });

  it('refuses a summary of more than one sentence', () => {
    const { args } = fixture('two-sentences', { ...data.summaries, 'TOM-2': 'One. Two.' });
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TOM-2: the summary must be one sentence');
  });
});
