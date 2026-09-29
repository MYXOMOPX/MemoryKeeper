import { describe, it, expect } from 'vitest';
import { TOOL_DECLARATIONS } from '../../src/llm/toolDeclarations.js';

describe('TOOL_DECLARATIONS', () => {
  it('declares exactly the 8 tools exposed over MCP, excluding apply_schema_change', () => {
    const names = TOOL_DECLARATIONS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'add_alias',
        'create_entity',
        'get_schema',
        'list_entities',
        'propose_schema_change',
        'read_entity',
        'search_entities',
        'write_fact',
      ].sort(),
    );
  });

  it('every declaration has a non-empty name and description, and an object-typed schema', () => {
    for (const decl of TOOL_DECLARATIONS) {
      expect(decl.name.length).toBeGreaterThan(0);
      expect(decl.description.length).toBeGreaterThan(0);
      expect(decl.parametersJsonSchema.type).toBe('object');
    }
  });

  it('write_fact requires type, name, key and value', () => {
    const writeFact = TOOL_DECLARATIONS.find((t) => t.name === 'write_fact');
    expect(writeFact?.parametersJsonSchema.required).toEqual(['type', 'name', 'key', 'value']);
  });

  it('propose_schema_change describes the promote_field/new_type union via oneOf', () => {
    const propose = TOOL_DECLARATIONS.find((t) => t.name === 'propose_schema_change');
    const changeSchema = (propose?.parametersJsonSchema.properties as Record<string, { oneOf?: unknown[] }>).change;
    expect(changeSchema.oneOf).toHaveLength(2);
  });
});
