export interface EntityTypeSchema {
  folder: string;
  structuredFields: string[];
}

export interface VaultSchema {
  types: Record<string, EntityTypeSchema>;
}

export interface EntityFrontmatter {
  type: string;
  aliases: string[];
  [field: string]: unknown;
}

export interface EntityFile {
  type: string;
  name: string;
  frontmatter: EntityFrontmatter;
  factLines: string[];
  notes: string;
  /**
   * Everything in the body that is neither the `## Факты` block nor the
   * `## Заметки` block (a `# Title`, intro prose, other `##` sections such as
   * `## Участники`), kept verbatim so hand edits made in Obsidian survive a
   * read→write round-trip. Re-emitted before `## Факты`. Empty for new entities.
   */
  extraContent: string;
}
