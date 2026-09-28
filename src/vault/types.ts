export interface EntityTypeSchema {
  folder: string;
  structuredFields: string[];
}

export interface VaultSchema {
  types: Record<string, EntityTypeSchema>;
}
