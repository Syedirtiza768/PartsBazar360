SELECT
  r."ebayItemId",
  r.title AS raw_title,
  r."storeId",
  r.status,
  r."rawPayload"->>'title' AS p_title,
  r."rawPayload"->>'titleEn' AS p_titleEn,
  r."rawPayload"->>'englishTitle' AS p_englishTitle,
  r."rawPayload"->>'marketplaceTitle' AS p_mkt,
  r."rawPayload"->>'marketplaceId' AS p_mktid,
  r."rawPayload"->'localizedTitles' AS p_localized,
  r."rawPayload"->'itemSpecifics' AS p_specifics
FROM "RawStagingListing" r
WHERE r."ebayItemId"='398121232563';

SELECT jsonb_object_keys(r."rawPayload") AS keys
FROM "RawStagingListing" r
WHERE r."ebayItemId"='398121232563';
