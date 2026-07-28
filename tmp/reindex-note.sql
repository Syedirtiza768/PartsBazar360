-- SQL approach: Just update the OpenSearch index via the API's built-in reindex
-- For now, let's just clear brand in OpenSearch for all non-FEBEST parts

-- The simplest approach: clear the entire index and let it rebuild naturally
-- from the next search queries. Or trigger a bulk update.
