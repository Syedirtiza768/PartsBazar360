SELECT COUNT(*) AS zero_offer_remaining
FROM "CanonicalPart" p
WHERE NOT EXISTS (SELECT 1 FROM "SellerOffer" o WHERE o."canonicalPartId"=p.id);
SELECT COUNT(*) AS total_parts FROM "CanonicalPart";
