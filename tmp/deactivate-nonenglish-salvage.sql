-- Deactivate Salvage Auto Parts offers whose canonical part title is written in
-- a non-English language (Italian/French/German/Spanish). RealTrack exposes no
-- English title field, so these can never be shown as English. Match is on
-- highly-distinctive automotive terms to avoid false positives.
WITH nonenglish AS (
  SELECT p.id AS part_id, o.id AS offer_id
  FROM "CanonicalPart" p
  JOIN "SellerOffer" o ON o."canonicalPartId" = p.id
  JOIN "Seller" s ON s.id = o."sellerId"
  WHERE s.name = 'Salvage Auto Parts'
    AND o.status = 'ACTIVE'
    AND p.title ~* '(albero|coperchio|altoparlante|sterzo|cinghia|modanatura|passaruota|pannello|bilanciere|cremagliera|pignone|omocinetico|marmitta|longherone|parabrezza|lunotto|finestrino|specchietto|retrovisore|sospension|frenata|ammortizzatore|termostato|climatizzatore|centralina|collettore|aspirazione|scarico|portiera|cofano|parafango|montante|cuscinetto|tirante|differenziale|serratura|cruscotto|plancia|compressore|alternatore|motorino|sensore|lambdasonda|candeletta|pompetta|rétroviseur|pare-brise|parechoc|pare-chocs|crémaillère|stabilisatrice|triangul|bercage|flasque|cardan|homociné|embrayage|vilebrequin|soupape|injecteur|échappement|silencieux|catalyseur|plaquette|tambour|biellette|essieu|getriebe|schaltung|scheinwerfer|kotflügel|stoßstange|stoßfänger|seitenspiegel|rückspiegel|außenspiegel|sitzheizung|bremssattel|bremsbelag|bremsschlauch|lenkrad|lenksäule|lenkgetriebe|lenkstockhebel|schaltgestänge|kupplungsnehmer|kupplungsgeber|anlasser|lichtmaschine|zündkerze|zündspule|zündverteiler|einspritzdüse|kraftstoffpumpe|luftfiltergehäuse|auspuffkrümmer|endtopf|hinterachse|vorderachse|querlenker|längslenker|stabilisator|schraubenfeder|stoßdämpfer|radlager|radnabe|achslenker|gebraucht|amortiguador|guardabarro|parachoques|paragolpes|neumático|cigüeñal|silenciador|embrague|mangueta|inyector|maletero|parabrisas|guardafango|espejo|farol|volante|dirección|suspensión)'
)
UPDATE "SellerOffer" o
SET status = 'INACTIVE', "updatedAt" = now()
FROM nonenglish n
WHERE o.id = n.offer_id;

-- Report counts
SELECT s.name,
  COUNT(*) FILTER (WHERE o.status='ACTIVE') AS active_now,
  COUNT(*) FILTER (WHERE o.status='INACTIVE') AS inactive_now
FROM "SellerOffer" o JOIN "Seller" s ON s.id=o."sellerId"
WHERE s.name='Salvage Auto Parts'
GROUP BY 1;
