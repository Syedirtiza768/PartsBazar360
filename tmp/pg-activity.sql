SELECT pid, state, wait_event_type, wait_event,
       now() - query_start AS running_for,
       LEFT(query, 160) AS query
FROM pg_stat_activity
WHERE datname='partsbazar_db' AND state <> 'idle'
ORDER BY query_start;
