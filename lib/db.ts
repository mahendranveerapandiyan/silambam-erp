import postgres from 'postgres';

const g = globalThis as unknown as { __erpSql?: postgres.Sql };

// Dates come back as 'YYYY-MM-DD' strings; bigint/numeric as strings.
export const sql: postgres.Sql =
  g.__erpSql ??
  (g.__erpSql = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/silambam', {
    onnotice: () => {},
    max: 10,
    transform: { undefined: null },
    types: {
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    } as any,
  }));

export type Tx = postgres.TransactionSql | postgres.Sql;
export type Row = Record<string, any>;

export const EOT = '4712-12-31';

/** Turn a database error into a message a user can act on. */
export function friendlyError(e: unknown): string {
  const err = e as { code?: string; message?: string; detail?: string; constraint_name?: string };
  switch (err?.code) {
    case '23505':
      return `Duplicate value: ${(err.detail || '').replace(/^Key /, '').replace(/=/, ' = ')}`.trim();
    case '23P01':
      return 'This change overlaps an existing date-effective record. Pick a different effective date.';
    case '23503':
      return 'This record is referenced by (or refers to) another record that does not allow this change.';
    case '23514':
      return `Value check failed (${err.constraint_name ?? 'constraint'}).`;
    case '23502':
      return `A required value is missing (${(err.message || '').match(/column "([^"]+)"/)?.[1] ?? 'field'}).`;
    case '22P02':
    case '22007':
    case '22008':
      return 'One of the values is not in a valid format.';
  }
  return err?.message || 'Unexpected error';
}
