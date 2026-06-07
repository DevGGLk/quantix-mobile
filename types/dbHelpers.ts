import type { Database } from './database.types';

/**
 * Helper para tipar payloads de escritura con `satisfies`, p.ej.:
 *
 *   const payload = { ... } satisfies TableInsert<'suggestions'>;
 *
 * A diferencia de pasar el literal directo a `.insert()` (que es genérico e
 * infiere el tipo, saltándose el excess-property-check), `satisfies` valida el
 * literal contra el tipo Insert real y marca columnas inexistentes/mal nombradas.
 */
export type TableInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];

export type TableUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
