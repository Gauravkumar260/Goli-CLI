/**
 * JSON Schema validator for tool inputs (Module 3).
 *
 * Validates tool-call arguments against their JSON Schema before dispatch.
 * On failure, returns a structured error + the schema + a hint so the
 * model can self-correct.
 *
 * Phase 4 uses a hand-rolled validator (no external dependency) that
 * handles the subset of JSON Schema we use: `type`, `properties`,
 * `required`, `enum`, `additionalProperties`. Phase 6 will swap this
 * for `ajv` (MIT, SBOM-clean) when we add MCP support (which requires
 * full JSON Schema validation).
 *
 * @module tools/schema-validator
 */

import type { ToolInputSchema } from './types.js';

/** A single validation error. */
export interface ValidationError {
  /** The path to the invalid field (e.g. `'file_path'`). */
  path: string;
  /** What was expected. */
  expected: string;
  /** What was received. */
  received: string;
}

/** Result of validating arguments against a schema. */
export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

/**
 * Validate arguments against a JSON Schema.
 *
 * @param args - The parsed tool arguments.
 * @param schema - The tool's input schema.
 */
export function validateToolArgs(
  args: Record<string, unknown>,
  schema: ToolInputSchema,
): ValidationResult {
  const errors: ValidationError[] = [];

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in args)) {
        errors.push({
          path: field,
          expected: 'required field present',
          received: 'missing',
        });
      }
    }
  }

  // Check each property's type
  for (const [key, value] of Object.entries(args)) {
    const propSchema = schema.properties[key] as
      | { type?: string | string[]; enum?: unknown[] }
      | undefined;
    if (!propSchema) {
      // Check additionalProperties
      if (schema.additionalProperties === false) {
        errors.push({
          path: key,
          expected: 'not present (additionalProperties: false)',
          received: `present with value ${JSON.stringify(value).slice(0, 50)}`,
        });
      }
      continue;
    }

    // Type check
    if (propSchema.type) {
      const types = Array.isArray(propSchema.type) ? propSchema.type : [propSchema.type];
      const actualType = getTypeOf(value);
      if (!types.includes(actualType)) {
        errors.push({
          path: key,
          expected: `type ${types.join(' | ')}`,
          received: `type ${actualType} (${JSON.stringify(value).slice(0, 50)})`,
        });
      }
    }

    // Enum check
    if (propSchema.enum && !propSchema.enum.includes(value)) {
      errors.push({
        path: key,
        expected: `one of ${JSON.stringify(propSchema.enum)}`,
        received: JSON.stringify(value).slice(0, 50),
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Get the JSON-Schema type name for a value.
 * @param value
 */
function getTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Format validation errors as a human-readable string for the model.
 * @param errors
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => `  - ${e.path}: expected ${e.expected}, got ${e.received}`)
    .join('\n');
}
