-- Count English vs non-English among SalvageA active listings.
-- Heuristic: common Italian/French/German/Spanish automotive words => non-English.
WITH sal AS (
  SELECT p.id, p.title
  FROM "CanonicalPart" p
  JOIN "SellerOffer" o ON o."canonicalPartId"=p.id
  JOIN "Seller" s ON s.id=o."sellerId"
  WHERE s.name='Salvage Auto Parts' AND o.status='ACTIVE'
),
flagged AS (
  SELECT id, title,
    (title ~* '\m(albero|coperchio|pompa|altoparlante|sterzo|cinghia|motore|anteriore|posteriore|destra|sinistra|volant|modanatura|passaruota|pannello|bilanciere|occasion|schermo|paraurti|paraurti|specchio|faro|fanale|portiera|cofano|parafango|asse|sospensione|frenata|cambio|scatola|albero a|tubo di|pompa di|coperchio di|raccolta|iniezione|secondaria|trasmissione|accessori|aria|olio|acqua|termostato|cuscino|airbag|cremagliera|pignone|biella|stelo|boccola|raccordo|supporto|fissaggio|regolazione|rinforzo|portiere|passenger|porte|roue|pneu|capot|pare|choc|essu|glace|rétroviseur|feu|phares|pare-brise|hayon|aile|bas de|support de|bras de|rotule|roulement|bague|joint|durit|collec|refroid|clim|ventil|allume|démarr|altern|batterie|frein|amort|ressort|coupelle|biellette|barre|train|essieu|differential|differenz|getriebe|schaltung|hinter|vorder|motor|lenk|brems|feder|dämpf|stoß|stoss|abgas|auspuff|kotfl|tür|haube|scheibe|scheinwerfer|rück|seiten|spiegel|kasten|halter|lager|buchse|bolzen|nabe|achse|lenker|stabil|quer|hilfs|neben|ölpumpe|wasserpumpe|zahnriemen|riemen|keilriemen|kurbel|nocken|zylinder|kolben|pleuel|ventil|nockenwelle|zünd|einspritz|kraftstoff|luftfilter|ölkühler|bremszylinder|bremsscheibe|bremse|handbremse|getriebeöl|achsen|antriebswelle|gelenk|gelenkwell|kupplung|drehmoment|differenzial|differentialgetr)\M') AS nonenglish
  FROM sal
)
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE nonenglish) AS nonenglish,
  COUNT(*) FILTER (WHERE NOT nonenglish) AS english
FROM flagged;

-- Sample of "english" (per heuristic) SalvageA titles
SELECT p.title, p.brand FROM "CanonicalPart" p
JOIN "SellerOffer" o ON o."canonicalPartId"=p.id JOIN "Seller" s ON s.id=o."sellerId"
WHERE s.name='Salvage Auto Parts' AND o.status='ACTIVE'
  AND NOT (p.title ~* '\m(albero|coperchio|pompa|altoparlante|sterzo|cinghia|motore|anteriore|posteriore|destra|sinistra|volant|modanatura|passaruota|pannello|bilanciere|occasion|schermo|paraurti|paraurti|specchio|faro|fanale|portiera|cofano|parafango|tubo di|pompa di|coperchio di|raccolta|iniezione|secondaria|trasmissione|accessori|aria|olio|acqua|termostato|cuscino|cremagliera|pignone|biella|stelo|boccola|raccordo|supporto|fissaggio|regolazione|rinforzo|portiere|roue|pneu|capot|pare|choc|essu|glace|rétroviseur|feu|phares|pare-brise|hayon|aile|bas de|support de|bras de|rotule|roulement|bague|joint|durit|collec|refroid|clim|ventil|allume|démarr|altern|batterie|frein|amort|ressort|coupelle|biellette|barre|train|essieu|differenz|getriebe|schaltung|hinter|vorder|lenk|brems|feder|dämpf|stoß|stoss|abgas|auspuff|kotfl|tür|haube|scheibe|scheinwerfer|rück|seiten|spiegel|kasten|halter|lager|buchse|bolzen|nabe|achse|lenker|stabil|quer|ölpumpe|wasserpumpe|zahnriemen|riemen|keilriemen|kurbel|nocken|zylinder|kolben|pleuel|ventil|zünd|einspritz|kraftstoff|luftfilter|ölkühler|bremsscheibe|bremse|handbremse|antriebswelle|gelenk|kupplung|differenzial)\M')
ORDER BY p."createdAt" DESC LIMIT 10;
