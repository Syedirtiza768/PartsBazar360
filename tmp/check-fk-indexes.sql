SELECT c.conrelid::regclass::text AS child_table,
       a.attname AS fk_col,
       ci.relname AS index_name
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
LEFT JOIN pg_index i ON i.indrelid = c.conrelid AND a.attnum = ANY(i.indkey)
LEFT JOIN pg_class ci ON ci.oid = i.indexrelid
WHERE c.contype = 'f'
  AND c.confrelid = '"CanonicalPart"'::regclass
ORDER BY child_table, a.attname;
