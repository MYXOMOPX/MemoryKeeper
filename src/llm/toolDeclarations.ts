export interface ToolDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export const TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'get_schema',
    description: 'Return the vault entity-type schema',
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_entities',
    description: 'List entities, optionally filtered by type',
    parametersJsonSchema: {
      type: 'object',
      properties: { type: { type: 'string' } },
    },
  },
  {
    name: 'search_entities',
    description: 'Find entities by name, alias, fact text or field value',
    parametersJsonSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'read_entity',
    description: 'Read the full content of one entity',
    parametersJsonSchema: {
      type: 'object',
      properties: { type: { type: 'string' }, name: { type: 'string' } },
      required: ['type', 'name'],
    },
  },
  {
    name: 'write_fact',
    description: 'Create or update a fact on an entity, creating the entity if it does not exist',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        name: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'string' },
        relatedEntities: {
          type: 'array',
          items: {
            type: 'object',
            properties: { type: { type: 'string' }, name: { type: 'string' } },
            required: ['type', 'name'],
          },
        },
      },
      required: ['type', 'name', 'key', 'value'],
    },
  },
  {
    name: 'create_entity',
    description:
      'Explicitly create a new entity of a known type; if it already exists, merges fields into it without losing its facts',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        name: { type: 'string' },
        fields: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['type', 'name'],
    },
  },
  {
    name: 'add_alias',
    description:
      'Add an alternative name (alias) to an entity, keeping all its existing facts; creates the entity if it does not exist',
    parametersJsonSchema: {
      type: 'object',
      properties: { type: { type: 'string' }, name: { type: 'string' }, alias: { type: 'string' } },
      required: ['type', 'name', 'alias'],
    },
  },
  {
    name: 'propose_schema_change',
    description: 'Record a proposed schema change; it is NOT applied until the user confirms it via /confirm_schema',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        change: {
          oneOf: [
            {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['promote_field'] },
                entityType: { type: 'string' },
                factKey: { type: 'string' },
              },
              required: ['kind', 'entityType', 'factKey'],
            },
            {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['new_type'] },
                typeName: { type: 'string' },
                folder: { type: 'string' },
                structuredFields: { type: 'array', items: { type: 'string' } },
              },
              required: ['kind', 'typeName', 'folder', 'structuredFields'],
            },
          ],
        },
      },
      required: ['description', 'change'],
    },
  },
];
