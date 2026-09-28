import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTmpVault, removeTmpVault } from '../helpers/tmpVault.js';
import { defaultSchema } from '../../src/vault/schema.js';
import { readEntity, writeEntity, listEntityFiles, listAllEntities } from '../../src/vault/entity.js';
import { upsertFact } from '../../src/vault/facts.js';
import type { EntityFile } from '../../src/vault/types.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

describe('entity read/write', () => {
  let vaultPath: string;
  const schema = defaultSchema();

  beforeEach(async () => {
    vaultPath = await makeTmpVault();
  });
  afterEach(async () => {
    await removeTmpVault(vaultPath);
  });

  it('returns null for a missing entity', async () => {
    expect(await readEntity(vaultPath, schema, 'person', 'Петя Иванов')).toBeNull();
  });

  it('round-trips an entity through write and read', async () => {
    const entity: EntityFile = {
      type: 'person',
      name: 'Петя Иванов',
      frontmatter: { type: 'person', aliases: ['Петя'] },
      factLines: ['- Первая девушка: [[Яна Сергеева]] _(добавлено 2026-09-19)_'],
      notes: 'Любит late-night звонки.',
      extraContent: '',
    };
    await writeEntity(vaultPath, schema, entity);
    const reloaded = await readEntity(vaultPath, schema, 'person', 'Петя Иванов');
    expect(reloaded?.frontmatter.aliases).toEqual(['Петя']);
    expect(reloaded?.factLines).toEqual(entity.factLines);
    expect(reloaded?.notes).toBe('Любит late-night звонки.');
  });

  it('lists entity file names for a type, empty when folder is absent', async () => {
    expect(await listEntityFiles(vaultPath, schema, 'person')).toEqual([]);
    await writeEntity(vaultPath, schema, {
      type: 'person',
      name: 'Яна Сергеева',
      frontmatter: { type: 'person', aliases: [] },
      factLines: [],
      notes: '',
      extraContent: '',
    });
    expect(await listEntityFiles(vaultPath, schema, 'person')).toEqual(['Яна Сергеева']);
  });

  it('lists all entities across all types', async () => {
    await writeEntity(vaultPath, schema, {
      type: 'person',
      name: 'Петя Иванов',
      frontmatter: { type: 'person', aliases: [] },
      factLines: [],
      notes: '',
      extraContent: '',
    });
    await writeEntity(vaultPath, schema, {
      type: 'event',
      name: 'ДР у Кати 2026-09-20',
      frontmatter: { type: 'event', aliases: [], date: '2026-09-20' },
      factLines: [],
      notes: '',
      extraContent: '',
    });
    const all = await listAllEntities(vaultPath, schema);
    expect(all.map((e) => e.name).sort()).toEqual(['ДР у Кати 2026-09-20', 'Петя Иванов']);
  });

  it('preserves hand-written content outside the managed sections across a read→upsert→write round-trip', async () => {
    const filePath = path.join(vaultPath, 'Events', 'ДР у Кати.md');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      [
        '---',
        'type: event',
        'aliases: []',
        '---',
        '# ДР у Кати',
        '',
        'Вечеринка на даче, было весело.',
        '',
        '## Участники',
        '- [[Петя Иванов]]',
        '- [[Яна Сергеева]]',
        '',
        '## Факты',
        '- Торт: наполеон _(добавлено 2026-09-20)_',
        'Дописано вручную в Obsidian.',
        '',
        '## Заметки',
        'Позвать снова в следующем году.',
        '',
      ].join('\n'),
      'utf8',
    );

    const loaded = await readEntity(vaultPath, schema, 'event', 'ДР у Кати');
    expect(loaded).not.toBeNull();
    await writeEntity(vaultPath, schema, upsertFact(loaded!, schema, 'Музыка', 'рок'));

    const reloaded = await readEntity(vaultPath, schema, 'event', 'ДР у Кати');
    expect(reloaded?.extraContent).toContain('# ДР у Кати');
    expect(reloaded?.extraContent).toContain('Вечеринка на даче, было весело.');
    expect(reloaded?.extraContent).toContain('## Участники\n- [[Петя Иванов]]\n- [[Яна Сергеева]]');
    expect(reloaded?.factLines[0]).toBe('- Торт: наполеон _(добавлено 2026-09-20)_');
    expect(reloaded?.factLines).toContain('Дописано вручную в Obsidian.');
    expect(reloaded?.factLines.some((l) => l.startsWith('- Музыка: рок'))).toBe(true);
    expect(reloaded?.notes).toBe('Позвать снова в следующем году.');

    const raw = await fs.readFile(filePath, 'utf8');
    expect(raw.indexOf('# ДР у Кати')).toBeLessThan(raw.indexOf('## Факты'));
    expect(raw.indexOf('## Участники')).toBeLessThan(raw.indexOf('## Факты'));
  });

  it('is stable across repeated round-trips (no growing blank lines, no placeholder leaking into facts)', async () => {
    const entity: EntityFile = {
      type: 'person',
      name: 'Петя',
      frontmatter: { type: 'person', aliases: [] },
      factLines: [],
      notes: '',
      extraContent: '# Петя\n\nОдноклассник.',
    };
    await writeEntity(vaultPath, schema, entity);
    const once = await readEntity(vaultPath, schema, 'person', 'Петя');
    await writeEntity(vaultPath, schema, once!);
    const twice = await readEntity(vaultPath, schema, 'person', 'Петя');
    expect(twice).toEqual(once);
    expect(twice?.extraContent).toBe('# Петя\n\nОдноклассник.');
    expect(twice?.factLines).toEqual([]);
  });

  it('keeps date-like frontmatter values as plain YYYY-MM-DD strings (written by us or by hand)', async () => {
    const eventSchema = { types: { event: { folder: 'Events', structuredFields: ['date'] } } };
    const base: EntityFile = {
      type: 'event',
      name: 'ДР у Кати',
      frontmatter: { type: 'event', aliases: [] },
      factLines: [],
      notes: '',
      extraContent: '',
    };
    await writeEntity(vaultPath, eventSchema, upsertFact(base, eventSchema, 'date', '2026-09-20'));
    const first = await readEntity(vaultPath, eventSchema, 'event', 'ДР у Кати');
    expect(first?.frontmatter.date).toBe('2026-09-20');

    // Hand-written unquoted date (YAML parses it as a timestamp) must survive a write_fact-style rewrite.
    const filePath = path.join(vaultPath, 'Events', 'ДР у Кати.md');
    await fs.writeFile(filePath, '---\ntype: event\naliases: []\ndate: 2026-09-20\n---\n## Факты\n\n## Заметки\n', 'utf8');
    const handWritten = await readEntity(vaultPath, eventSchema, 'event', 'ДР у Кати');
    expect(handWritten?.frontmatter.date).toBe('2026-09-20');
    await writeEntity(vaultPath, eventSchema, upsertFact(handWritten!, eventSchema, 'Торт', 'наполеон'));
    const rewritten = await readEntity(vaultPath, eventSchema, 'event', 'ДР у Кати');
    expect(rewritten?.frontmatter.date).toBe('2026-09-20');
    expect(rewritten?.frontmatter.date).not.toBeInstanceOf(Date);
    expect(await fs.readFile(filePath, 'utf8')).not.toContain('T00:00:00');
  });

  it('normalizes a hand-written string alias into an array', async () => {
    const filePath = path.join(vaultPath, 'People', 'Петя.md');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '---\ntype: person\naliases: Петруха\n---\n## Факты\n\n## Заметки\n', 'utf8');
    const loaded = await readEntity(vaultPath, schema, 'person', 'Петя');
    expect(loaded?.frontmatter.aliases).toEqual(['Петруха']);
  });
});
