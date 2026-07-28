-- Complete version (all fields)
COPY (
  SELECT
    cp.title AS "Part Title",
    cp.brand AS "Brand",
    cp.manufacturer AS "Manufacturer",
    cp.category AS "Category",
    cp."partType" AS "Part Type",
    so.condition AS "Condition",
    so."qualityTier" AS "Quality Tier",
    cp."partSource" AS "Part Source",
    so.price AS "Price",
    so.currency AS "Currency",
    so."sellerSku" AS "Seller SKU",
    cp."ebayItemId" AS "eBay Item ID",
    array_to_string(cp."oeNumbers", '; ') AS "OEM Part Numbers",
    cp."manufacturerPartNumber" AS "MPN",
    cp.position AS "Position",
    cp."vehicleSystem" AS "Vehicle System",
    array_to_string(cp."imageUrls", '; ') AS "Image URLs",
    cp."listingUrl" AS "Listing URL",
    (SELECT COALESCE(SUM(i.quantity), 0) FROM "Inventory" i WHERE i."offerId" = so.id) AS "Quantity",
    cp."fitmentStatus" AS "Fitment Status",
    dv."modelYear" AS "Donor Year",
    vm.name AS "Donor Make",
    dv.model AS "Donor Model",
    dv.trim AS "Donor Trim",
    dv.engine AS "Donor Engine",
    dv.transmission AS "Donor Transmission",
    su."conditionGrade" AS "Condition Grade",
    su."testedStatus" AS "Tested Status",
    su."damageNotes" AS "Damage Notes",
    so."sellerNotes" AS "Seller Notes"
  FROM "SellerOffer" so
  JOIN "CanonicalPart" cp ON cp.id = so."canonicalPartId"
  LEFT JOIN "SalvageUnit" su ON su."sellerOfferId" = so.id
  LEFT JOIN "DonorVehicle" dv ON dv.id = su."donorVehicleId"
  LEFT JOIN "VehicleMake" vm ON vm.id = dv."makeId"
  WHERE so."sellerId" = 'seller-salvage-auto-parts'
  ORDER BY so."createdAt" DESC
) TO '/tmp/salvage-auto-parts-complete.csv' WITH CSV HEADER;

-- Version without Image URLs
COPY (
  SELECT
    cp.title AS "Part Title",
    cp.brand AS "Brand",
    cp.manufacturer AS "Manufacturer",
    cp.category AS "Category",
    cp."partType" AS "Part Type",
    so.condition AS "Condition",
    so."qualityTier" AS "Quality Tier",
    cp."partSource" AS "Part Source",
    so.price AS "Price",
    so.currency AS "Currency",
    so."sellerSku" AS "Seller SKU",
    cp."ebayItemId" AS "eBay Item ID",
    array_to_string(cp."oeNumbers", '; ') AS "OEM Part Numbers",
    cp."manufacturerPartNumber" AS "MPN",
    cp.position AS "Position",
    cp."vehicleSystem" AS "Vehicle System",
    cp."listingUrl" AS "Listing URL",
    (SELECT COALESCE(SUM(i.quantity), 0) FROM "Inventory" i WHERE i."offerId" = so.id) AS "Quantity",
    cp."fitmentStatus" AS "Fitment Status",
    dv."modelYear" AS "Donor Year",
    vm.name AS "Donor Make",
    dv.model AS "Donor Model",
    dv.trim AS "Donor Trim",
    dv.engine AS "Donor Engine",
    dv.transmission AS "Donor Transmission",
    su."conditionGrade" AS "Condition Grade",
    su."testedStatus" AS "Tested Status",
    su."damageNotes" AS "Damage Notes",
    so."sellerNotes" AS "Seller Notes"
  FROM "SellerOffer" so
  JOIN "CanonicalPart" cp ON cp.id = so."canonicalPartId"
  LEFT JOIN "SalvageUnit" su ON su."sellerOfferId" = so.id
  LEFT JOIN "DonorVehicle" dv ON dv.id = su."donorVehicleId"
  LEFT JOIN "VehicleMake" vm ON vm.id = dv."makeId"
  WHERE so."sellerId" = 'seller-salvage-auto-parts'
  ORDER BY so."createdAt" DESC
) TO '/tmp/salvage-auto-parts-no-images.csv' WITH CSV HEADER;
