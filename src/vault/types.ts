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
}
