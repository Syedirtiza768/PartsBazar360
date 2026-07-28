SELECT pid, state, wait_event_type, wait_event,
       now() - query_start AS running_for,
       LEFT(query, 200) AS query
FROM pg_stat_activity
WHERE datname='partsbazar_db' AND state <> 'idle'
ORDER BY query_start;
SELECT 'SourceRecord' AS t, COUNT(*) FROM "SourceRecord"
UNION ALL SELECT 'SellerOffer', COUNT(*) FROM "SellerOffer"
UNION ALL SELECT 'ReviewTask', COUNT(*) FROM "ReviewTask"
UNION ALL SELECT 'SellerUploadRow', COUNT(*) FROM "SellerUploadRow"
UNION ALL SELECT 'SupportTicket', COUNT(*) FROM "SupportTicket";
