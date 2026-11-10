const quote = (name) => '"' + name.replaceAll('"', '""') + '"';

/** Iterate a source table by its actual primary key, including compound keys. */
export function sqliteMigrationRows(source, table, fields) {
  const primaryKey = source.prepare(`PRAGMA table_info(${quote(table)})`).all()
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => quote(column.name));
  if (!primaryKey.length) throw new Error(`Missing source primary key for ${table}; upgrade a backed-up copy before migration.`);
  return source.prepare(`SELECT ${fields.map(quote).join(", ")} FROM ${quote(table)} ORDER BY ${primaryKey.join(", ")}`).iterate();
}
