SELECT pid, state, wait_event_type, wait_event,
       now() - query_start AS running_for,
       LEFT(query, 120) AS query
FROM pg_stat_activity
WHERE datname='partsbazar_db' AND state <> 'idle'
ORDER BY query_start;
SELECT locktype, relation::regclass::text AS rel, mode, granted, pid
FROM pg_locks WHERE granted=false LIMIT 10;
