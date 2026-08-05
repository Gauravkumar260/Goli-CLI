/**
 * JSON Schema + Zod validator for tool inputs (Module 3).
 *
 * Validates tool-call arguments against their JSON Schema before dispatch.
 * On failure, returns a structured error + the schema + a hint so the
 * model can self-correct.
 *
 * P1-15 fix (remediation plan Phase 15): Zod is now a first-class
 * dependency. The hand-rolled JSON Schema validator remains as the
 * default path (it's stable, well-tested, and handles the JSON Schema
 * subset we use), but tools that prefer Zod can call `validateWithZod()`
 * directly with a `ZodSchema`. The skill subsystem
 * (`memory/skills/types.ts`) is fully migrated to Zod for runtime
 * validation of YAML frontmatter.
 *
 * @module tools/schema-validator
 */

import { z, type ZodSchema } from 'zod';

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
  // Recurse from the top level with the root path "" so nested
  // errors are reported as `config.path` not just `path`. The
  // previous implementation did NOT recurse into nested
  // `type: 'object'` schemas or validate `array` `items`. A schema
  // like { properties: { config: { type: 'object', properties:
  // { path: { type: 'string' } }, required: ['path'] } } } would
  // accept { config: {} } (missing required `path`) and
  // { config: { path: 123 } } (wrong type) — silently bypassing
  // validation. This is a real safety gap for tools that accept
  // nested config (e.g., save_tool's `args` array, or MCP tool
  // schemas).
  validateObject(args, schema, '', errors);
  return { ok: errors.length === 0, errors };
}

/**
 * Recursive validator for `type: 'object'` schemas. Walks
 * `properties` + `required` + `additionalProperties`, recursing
 * into nested objects and arrays.
 */
function validateObject(
  args: Record<string, unknown>,
  schema: ToolInputSchema,
  pathPrefix: string,
  errors: ValidationError[],
): void {
  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in args)) {
        errors.push({
          path: pathPrefix ? `${pathPrefix}.${field}` : field,
          expected: 'required field present',
          received: 'missing',
        });
      }
    }
  }

  // Check each property's type, recursing into nested objects/arrays.
  for (const [key, value] of Object.entries(args)) {
    const fullPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    const propSchema = schema.properties?.[key] as
      | {
          type?: string | string[];
          enum?: unknown[];
          properties?: Record<string, unknown>;
          required?: string[];
          additionalProperties?: boolean;
          items?: unknown;
        }
      | undefined;
    if (!propSchema) {
      // Check additionalProperties
      if (schema.additionalProperties === false) {
        errors.push({
          path: fullPath,
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
          path: fullPath,
          expected: `type ${types.join(' | ')}`,
          received: `type ${actualType} (${JSON.stringify(value).slice(0, 50)})`,
        });
      }
      // Recurse into nested objects.
      if (actualType === 'object' && types.includes('object') && propSchema.properties) {
        validateObject(
          value as Record<string, unknown>,
          propSchema as unknown as ToolInputSchema,
          fullPath,
          errors,
        );
      }
      // Recurse into array items.
      if (actualType === 'array' && types.includes('array') && propSchema.items) {
        const itemSchema = propSchema.items as {
          type?: string | string[];
          properties?: Record<string, unknown>;
          required?: string[];
          additionalProperties?: boolean;
        };
        const arr = value as unknown[];
        for (let i = 0; i < arr.length; i++) {
          const itemValue = arr[i]!;
          const itemPath = `${fullPath}[${i}]`;
          if (itemSchema.type) {
            const itemTypes = Array.isArray(itemSchema.type) ? itemSchema.type : [itemSchema.type];
            const itemActual = getTypeOf(itemValue);
            if (!itemTypes.includes(itemActual)) {
              errors.push({
                path: itemPath,
                expected: `type ${itemTypes.join(' | ')}`,
                received: `type ${itemActual}`,
              });
            }
            // Recurse into array-of-objects.
            if (itemActual === 'object' && itemSchema.properties) {
              validateObject(
                itemValue as Record<string, unknown>,
                itemSchema as unknown as ToolInputSchema,
                itemPath,
                errors,
              );
            }
          }
        }
      }
    }

    // Enum check
    if (propSchema.enum && !propSchema.enum.includes(value)) {
      errors.push({
        path: fullPath,
        expected: `one of ${JSON.stringify(propSchema.enum)}`,
        received: JSON.stringify(value).slice(0, 50),
      });
    }
  }
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

// ─── P1-15: Zod-based validation ────────────────────────────────────────

/**
 * P1-15 fix (remediation plan Phase 15): validate an unknown input
 * against a Zod schema. Returns the same `ValidationResult` shape as
 * `validateToolArgs()` so callers can swap one for the other without
 * touching their error-handling code.
 *
 * Tools that prefer Zod (e.g. the skills subsystem) call this directly
 * with a `ZodSchema`. Tools that still use JSON Schema continue to
 * call `validateToolArgs()` — both paths produce the same result type.
 *
 * @param input - The parsed input to validate (typically the result of
 *   `JSON.parse(toolCall.arguments)` or `parseToolCallArgs()`).
 * @param schema - The Zod schema to validate against.
 */
export function validateWithZod(
  input: unknown,
  schema: ZodSchema,
): ValidationResult {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, errors: [] };
  }
  // Map Zod issues to our ValidationError shape. Zod's `path` is an
  // array of strings/numbers; we join with '.' for object paths and
  // '[i]' for array indices (matching the JSON Schema validator's
  // convention).
  const errors: ValidationError[] = result.error.issues.map((issue) => {
    const pathStr = issue.path
      .map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? String(p) : `.${p}`))
      .join('');
    return {
      path: pathStr || '(root)',
      expected: issue.message,
      received: 'invalid value',
    };
  });
  return { ok: false, errors };
}

/**
 * P1-15: Convert a JSON Schema (the `ToolInputSchema` shape) into a
 * Zod schema. Used by tools that want Zod validation but still define
 * their schema in JSON Schema form (the common case — JSON Schema is
 * the lingua franca for MCP and tool definitions).
 *
 * Handles the subset of JSON Schema we use: `type`, `properties`,
 * `required`, `enum`, `additionalProperties`, `items`. Unknown
 * keywords are ignored (Zod is permissive by default).
 *
 * For schemas this converter can't handle (e.g. `$ref`, `oneOf`,
 * `allOf`), it falls back to `z.unknown()` so validation is a no-op
 * rather than a hard failure — the caller can opt in to strict
 * validation by defining a Zod schema directly.
 */
export function jsonSchemaToZod(schema: ToolInputSchema): ZodSchema {
  // Top-level is always an object.
  const shape: Record<string, z.ZodTypeAny> = {};
  const props = (schema.properties ?? {}) as Record<string, { type?: string | string[]; enum?: unknown[]; items?: unknown; properties?: Record<string, unknown>; required?: string[] }>;
  const required = new Set(schema.required ?? []);
  for (const [key, propSchema] of Object.entries(props)) {
    const isRequired = required.has(key);
    let zodType = jsonSchemaPropToZod(propSchema);
    if (!isRequired) {
      zodType = zodType.optional();
    }
    shape[key] = zodType;
  }
  // additionalProperties: false → strict object; otherwise passthrough.
  if (schema.additionalProperties === false) {
    return z.object(shape).strict();
  }
  return z.object(shape).passthrough();
}

/** Convert a single JSON Schema property descriptor to a Zod type. */
function jsonSchemaPropToZod(prop: { type?: string | string[]; enum?: unknown[]; items?: unknown; properties?: Record<string, unknown>; required?: string[] }): z.ZodTypeAny {
  // Enum first (independent of type).
  if (prop.enum && prop.enum.length > 0) {
    return z.enum(prop.enum.map(String) as [string, ...string[]]);
  }
  if (!prop.type) {
    return z.unknown();
  }
  const types = Array.isArray(prop.type) ? prop.type : [prop.type];
  // Build a union when multiple types are allowed.
  const zodTypes: z.ZodTypeAny[] = [];
  for (const t of types) {
    switch (t) {
      case 'string': zodTypes.push(z.string()); break;
      case 'number': zodTypes.push(z.number()); break;
      case 'integer': zodTypes.push(z.number().int()); break;
      case 'boolean': zodTypes.push(z.boolean()); break;
      case 'array': {
        const items = prop.items as { type?: string; properties?: Record<string, unknown>; required?: string[] } | undefined;
        const itemZod = items ? jsonSchemaPropToZod(items) : z.unknown();
        zodTypes.push(z.array(itemZod)); break;
      }
      case 'object': {
        if (prop.properties) {
          const objShape: Record<string, z.ZodTypeAny> = {};
          const objRequired = new Set(prop.required ?? []);
          for (const [k, v] of Object.entries(prop.properties)) {
            const vSchema = v as { type?: string; enum?: unknown[] };
            let zt = jsonSchemaPropToZod(vSchema);
            if (!objRequired.has(k)) zt = zt.optional();
            objShape[k] = zt;
          }
          zodTypes.push(z.object(objShape).passthrough());
        } else {
          zodTypes.push(z.record(z.unknown()));
        }
        break;
      }
      case 'null': zodTypes.push(z.null()); break;
      default: zodTypes.push(z.unknown());
    }
  }
  if (zodTypes.length === 1) return zodTypes[0]!;
  return z.union([zodTypes[0]!, zodTypes[1]!, ...(zodTypes.slice(2) as [z.ZodTypeAny, ...z.ZodTypeAny[]])]);
}
