-- Speed up cascading vehicle picker lookups (Make → Model → Generation → Engine).
CREATE INDEX IF NOT EXISTS "VehicleModel_makeId_idx" ON "VehicleModel"("makeId");
CREATE INDEX IF NOT EXISTS "VehicleGeneration_modelId_idx" ON "VehicleGeneration"("modelId");
CREATE INDEX IF NOT EXISTS "VehicleConfiguration_generationId_idx" ON "VehicleConfiguration"("generationId");
