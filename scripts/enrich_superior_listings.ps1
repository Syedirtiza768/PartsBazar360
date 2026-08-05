param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

function Clean-Text {
  param([AllowNull()][string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }

  $text = $Value.Trim()
  $dashChars = @(
    [string][char]0x2010,
    [string][char]0x2011,
    [string][char]0x2012,
    [string][char]0x2013,
    [string][char]0x2014,
    ([string][char]0x00E2 + [string][char]0x20AC + [string][char]0x201C),
    ([string][char]0x00E2 + [string][char]0x20AC + [string][char]0x0093),
    ([string][char]0x00C3 + [string][char]0x00A2 + [string][char]0x00E2 + [string][char]0x201A + [string][char]0x00AC + [string][char]0x00E2 + [string][char]0x201E + [string][char]0x00A2)
  )

  foreach ($dash in $dashChars) {
    $text = $text.Replace($dash, '-')
  }

  $text = $text.Replace(([string][char]0x00A0), ' ')
  $text = $text -replace '\s+', ' '
  return $text.Trim()
}

function Title-Case {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }

  $culture = [System.Globalization.CultureInfo]::InvariantCulture
  return $culture.TextInfo.ToTitleCase($Value.ToLowerInvariant())
}

function Get-ProductType {
  param([string]$Title, [string]$Fallback)

  $upper = $Title.ToUpperInvariant()
  $rules = @(
    @{ Pattern = '\bTHERMOSTAT\b'; Type = 'Thermostat' },
    @{ Pattern = '\bGASKET\b'; Type = 'Gasket' },
    @{ Pattern = '\bEGR\b'; Type = 'EGR Component' },
    @{ Pattern = '\bBRAKE\s*PAD|\bPAD\s*SET|\bBRAKE\s*SHOE'; Type = 'Brake Pad or Shoe Set' },
    @{ Pattern = '\bDISC\b|\bROTOR\b'; Type = 'Brake Disc or Rotor' },
    @{ Pattern = '\bCALIPER\b'; Type = 'Brake Caliper' },
    @{ Pattern = '\bSHOCK\b|\bABSORBER\b'; Type = 'Shock Absorber' },
    @{ Pattern = '\bSTRUT\b'; Type = 'Strut Assembly' },
    @{ Pattern = '\bCONTROL\s*ARM\b|\bARM\b'; Type = 'Control Arm' },
    @{ Pattern = '\bBALL\s*JOINT\b'; Type = 'Ball Joint' },
    @{ Pattern = '\bTIE\s*ROD\b'; Type = 'Tie Rod' },
    @{ Pattern = '\bLINK\b|\bSTABILIZER\b|\bSWAY\b'; Type = 'Stabilizer Link' },
    @{ Pattern = '\bBUSH\b|\bBUSHING\b'; Type = 'Bushing' },
    @{ Pattern = '\bMOUNT\b|\bSUPPORT\b'; Type = 'Mount or Support' },
    @{ Pattern = '\bFILTER\b'; Type = 'Filter' },
    @{ Pattern = '\bSENSOR\b'; Type = 'Sensor' },
    @{ Pattern = '\bPUMP\b'; Type = 'Pump' },
    @{ Pattern = '\bRADIATOR\b'; Type = 'Radiator' },
    @{ Pattern = '\bFAN\b'; Type = 'Fan Assembly' },
    @{ Pattern = '\bCONDENSER\b'; Type = 'A/C Condenser' },
    @{ Pattern = '\bCOMPRESSOR\b'; Type = 'Compressor' },
    @{ Pattern = '\bALTERNATOR\b'; Type = 'Alternator' },
    @{ Pattern = '\bSTARTER\b'; Type = 'Starter Motor' },
    @{ Pattern = '\bBELT\b'; Type = 'Belt' },
    @{ Pattern = '\bCHAIN\b'; Type = 'Timing Chain' },
    @{ Pattern = '\bBEARING\b'; Type = 'Bearing' },
    @{ Pattern = '\bHUB\b'; Type = 'Wheel Hub' },
    @{ Pattern = '\bCLUTCH\b'; Type = 'Clutch Component' },
    @{ Pattern = '\bTURBO\b'; Type = 'Turbocharger Component' },
    @{ Pattern = '\bHEAD.?LIGHT|\bLAMP\b'; Type = 'Light or Lamp Assembly' },
    @{ Pattern = '\bMIRROR\b'; Type = 'Mirror Assembly' },
    @{ Pattern = '\bREGULATOR\b'; Type = 'Regulator' },
    @{ Pattern = '\bVALVE\b'; Type = 'Valve' },
    @{ Pattern = '\bHOSE\b'; Type = 'Hose' }
  )

  foreach ($rule in $rules) {
    if ($upper -match $rule.Pattern) {
      return $rule.Type
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($Fallback) -and $Fallback -notmatch 'GENUINE_OEM|USED|OEM') {
    return (Title-Case $Fallback)
  }

  return 'Automotive Replacement Part'
}

function Get-SystemCategory {
  param([string]$ProductType, [string]$ExistingCategory, [string]$Title)

  $value = "$ProductType $ExistingCategory $Title".ToUpperInvariant()

  if ($value -match 'BRAKE|CALIPER|ROTOR|DISC|PAD|SHOE') { return 'Brakes' }
  if ($value -match 'SHOCK|STRUT|CONTROL ARM|BALL JOINT|TIE ROD|STABILIZER|BUSH|SUSPENSION') { return 'Suspension and Steering' }
  if ($value -match 'THERMOSTAT|RADIATOR|COOLANT|WATER PUMP|FAN|COOLING') { return 'Cooling System' }
  if ($value -match 'EGR|GASKET|VALVE|FILTER|BELT|CHAIN|TURBO|ENGINE') { return 'Engine' }
  if ($value -match 'SENSOR|ALTERNATOR|STARTER|LAMP|LIGHT|ELECTRICAL') { return 'Electrical and Lighting' }
  if ($value -match 'CLUTCH|TRANSMISSION|GEAR|DRIVE') { return 'Transmission and Drivetrain' }
  if ($value -match 'COMPRESSOR|CONDENSER|A/C|AC ') { return 'Air Conditioning' }
  if (-not [string]::IsNullOrWhiteSpace($ExistingCategory) -and $ExistingCategory -ne 'General') { return $ExistingCategory }

  return 'General Automotive Parts'
}

function Get-FitmentHints {
  param([string]$Title)

  $candidateText = ($Title -replace '\b\d{1,3}(?:\.\d{1,4}){1,4}\b', ' ')
  $matches = [regex]::Matches($candidateText.ToUpperInvariant(), '\b(?:W|S|C|A|E|F|G|X|Q|V)\d{1,3}[A-Z]?\b|\b(?:W|S|C|A|E|F|G|X|Q|V)\d{1,3}[/-]\d{1,3}[A-Z]?\b')
  $values = New-Object System.Collections.Generic.List[string]

  foreach ($match in $matches) {
    $token = $match.Value
    if ($token.Length -ge 2 -and -not $values.Contains($token)) {
      $values.Add($token)
    }
  }

  $compoundMatches = [regex]::Matches($candidateText.ToUpperInvariant(), '\b([WSCAEFGXQV])(\d{1,3})(?:/\d{1,3}[A-Z]?){1,4}\b')
  foreach ($compound in $compoundMatches) {
    $parts = $compound.Value.Split('/')
    if ($parts.Count -gt 1) {
      $prefix = $parts[0].Substring(0, 1)
      foreach ($part in $parts) {
        if ($part -match '^[A-Z]') {
          $token = $part
        } else {
          $token = "$prefix$part"
        }

        if ($token.Length -ge 2 -and -not $values.Contains($token)) {
          $values.Add($token)
        }
      }
    }
  }

  if ($values.Count -eq 0) {
    return ''
  }

  return ($values -join ', ')
}

function Get-ConditionLabel {
  param([string]$Condition, [string]$QualityTier, [string]$PartSource)

  $parts = @()
  if (-not [string]::IsNullOrWhiteSpace($Condition)) { $parts += (Title-Case $Condition) }
  if (-not [string]::IsNullOrWhiteSpace($QualityTier)) { $parts += (Title-Case $QualityTier) }
  if (-not [string]::IsNullOrWhiteSpace($PartSource)) { $parts += ($PartSource -replace '_', ' ') }

  if ($parts.Count -eq 0) {
    return 'Automotive replacement'
  }

  return (($parts | Select-Object -Unique) -join ' / ')
}

function Get-ListingTitle {
  param([string]$Title, [string]$Brand, [string]$PartNumber, [string]$ProductType)

  $cleanTitle = Clean-Text $Title
  $title = Title-Case $cleanTitle
  if (-not [string]::IsNullOrWhiteSpace($Brand)) {
    $title = $title -replace "\b$([regex]::Escape((Title-Case $Brand)))\b", $Brand
  }
  if (-not [string]::IsNullOrWhiteSpace($PartNumber) -and $title -notlike "*$PartNumber*") {
    $title = "$title - $PartNumber"
  }
  if (-not [string]::IsNullOrWhiteSpace($Brand) -and $title -notlike "$Brand*") {
    $title = "$Brand $title"
  }
  if ($title.Length -gt 150) {
    $title = $title.Substring(0, 150).Trim()
  }
  return $title
}

function Get-Description {
  param(
    [string]$Title,
    [string]$Brand,
    [string]$Manufacturer,
    [string]$PartNumber,
    [string]$OemPartNumber,
    [string]$ProductType,
    [string]$SystemCategory,
    [string]$ConditionLabel,
    [string]$FitmentHints,
    [string]$SellerSku
  )

  $brandText = if ([string]::IsNullOrWhiteSpace($Brand)) { 'the listed brand' } else { $Brand }
  $manufacturerText = if ([string]::IsNullOrWhiteSpace($Manufacturer)) { $brandText } else { $Manufacturer }
  $partNumberText = if ([string]::IsNullOrWhiteSpace($PartNumber)) { 'not provided' } else { $PartNumber }
  $oemText = if ([string]::IsNullOrWhiteSpace($OemPartNumber)) { 'not provided' } else { $OemPartNumber }
  $skuText = if ([string]::IsNullOrWhiteSpace($SellerSku)) { 'not provided' } else { $SellerSku }

  $fitmentSentence = if ([string]::IsNullOrWhiteSpace($FitmentHints)) {
    'No vehicle fitment is guaranteed from the title alone; match the part number, photos, and vehicle VIN before purchase.'
  } else {
    "Possible fitment/application hints found in the listing title: $FitmentHints. Please verify against your vehicle VIN or original part number before purchase."
  }

  return "This listing is for $Title, a $ProductType for the $SystemCategory category. Brand: $brandText. Manufacturer: $manufacturerText. Manufacturer part number: $partNumberText. OEM part number: $oemText. Seller SKU: $skuText. Condition/source: $ConditionLabel. $fitmentSentence The item is supplied by Superior Auto Parts and should be checked for compatibility before installation."
}

function Join-NonEmpty {
  param([string[]]$Values, [string]$Separator = ' | ')
  return (($Values | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join $Separator)
}

$rows = Import-Csv -LiteralPath $InputPath
$enriched = foreach ($row in $rows) {
  $cleanTitle = Clean-Text $row.title
  $cleanBrand = Clean-Text $row.brand
  $cleanManufacturer = Clean-Text $row.manufacturer
  $cleanMfrPart = Clean-Text $row.mfr_part_number
  $cleanOemPart = Clean-Text $row.oem_part_number
  $cleanCategory = Clean-Text $row.category
  $cleanPartType = Clean-Text $row.part_type
  $cleanCondition = Clean-Text $row.condition
  $cleanSource = Clean-Text $row.part_source
  $cleanTier = Clean-Text $row.quality_tier
  $cleanSku = Clean-Text $row.seller_sku

  $productType = Get-ProductType -Title $cleanTitle -Fallback $cleanPartType
  $systemCategory = Get-SystemCategory -ProductType $productType -ExistingCategory $cleanCategory -Title $cleanTitle
  $fitmentHints = Get-FitmentHints -Title $cleanTitle
  $conditionLabel = Get-ConditionLabel -Condition $cleanCondition -QualityTier $cleanTier -PartSource $cleanSource
  $enrichedTitle = Get-ListingTitle -Title $cleanTitle -Brand $cleanBrand -PartNumber $cleanMfrPart -ProductType $productType

  $specifics = [ordered]@{
    Brand = $cleanBrand
    Manufacturer = $cleanManufacturer
    'Manufacturer Part Number' = $cleanMfrPart
    'OEM Part Number' = $cleanOemPart
    'Seller SKU' = $cleanSku
    'Product Type' = $productType
    'System Category' = $systemCategory
    Condition = $conditionLabel
    'Part Source' = ($cleanSource -replace '_', ' ')
    'Quality Tier' = (Title-Case $cleanTier)
    'Minimum Order Quantity' = (Clean-Text $row.moq)
    'Fitment Hints' = $fitmentHints
    'Compatibility Note' = 'Verify fitment using part number, photos, and VIN before purchase.'
  }

  $mfrPartBullet = ''
  if (-not [string]::IsNullOrWhiteSpace($cleanMfrPart)) {
    $mfrPartBullet = "Manufacturer part number: $cleanMfrPart"
  }

  $brandBullet = ''
  if (-not [string]::IsNullOrWhiteSpace($cleanBrand)) {
    $brandBullet = "Brand: $cleanBrand"
  }

  $fitmentBullet = 'Fitment must be verified before purchase'
  if (-not [string]::IsNullOrWhiteSpace($fitmentHints)) {
    $fitmentBullet = "Application hints: $fitmentHints"
  }

  $bullets = @(
    "$productType for $systemCategory",
    $mfrPartBullet,
    $brandBullet,
    "Condition/source: $conditionLabel",
    $fitmentBullet
  )

  $description = Get-Description `
    -Title $enrichedTitle `
    -Brand $cleanBrand `
    -Manufacturer $cleanManufacturer `
    -PartNumber $cleanMfrPart `
    -OemPartNumber $cleanOemPart `
    -ProductType $productType `
    -SystemCategory $systemCategory `
    -ConditionLabel $conditionLabel `
    -FitmentHints $fitmentHints `
    -SellerSku $cleanSku

  $keywords = Join-NonEmpty -Values @(
    $cleanBrand,
    $cleanManufacturer,
    $cleanMfrPart,
    $cleanOemPart,
    $cleanSku,
    $productType,
    $systemCategory,
    $fitmentHints,
    $cleanTitle
  ) -Separator ', '

  $output = [ordered]@{}
  foreach ($property in $row.PSObject.Properties) {
    $value = Clean-Text ([string]$property.Value)
    $output[$property.Name] = $value
  }

  $output['enriched_title'] = $enrichedTitle
  $output['inferred_product_type'] = $productType
  $output['inferred_system_category'] = $systemCategory
  $output['fitment_hints'] = $fitmentHints
  $output['compatibility_note'] = 'Verify fitment using part number, photos, and VIN before purchase.'
  $output['item_specifics_json'] = ($specifics | ConvertTo-Json -Compress)
  $output['description'] = $description
  $output['detail_bullets'] = Join-NonEmpty -Values $bullets
  $output['search_keywords'] = $keywords

  [pscustomobject]$output
}

$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) {
  New-Item -ItemType Directory -Path $outputDirectory | Out-Null
}

$enriched | Export-Csv -LiteralPath $OutputPath -NoTypeInformation -Encoding UTF8

[pscustomobject]@{
  RowsProcessed = $rows.Count
  OutputPath = $OutputPath
}
