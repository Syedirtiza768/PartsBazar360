Write-Output "=== Test 1: Image proxy with s-l500 ==="
try {
    $r = Invoke-WebRequest -Uri 'https://partsbazar360.realtrackapp.com/img-proxy/?url=https://i.ebayimg.com/images/g/pRkAAeSw8D1qMoRj/s-l500.jpg' -UseBasicParsing
    Write-Output "Status: $($r.StatusCode), Content-Type: $($r.Headers['Content-Type']), Length: $($r.Content.Length)"
} catch {
    Write-Output "FAILED: $_"
}

Write-Output ""
Write-Output "=== Test 2: Image proxy with original s-l140 ==="
try {
    $r = Invoke-WebRequest -Uri 'https://partsbazar360.realtrackapp.com/img-proxy/?url=https://i.ebayimg.com/images/g/pRkAAeSw8D1qMoRj/s-l140.jpg' -UseBasicParsing
    Write-Output "Status: $($r.StatusCode), Content-Type: $($r.Headers['Content-Type']), Length: $($r.Content.Length)"
} catch {
    Write-Output "FAILED: $_"
}

Write-Output ""
Write-Output "=== Test 3: Direct eBay image (no proxy) ==="
try {
    $r = Invoke-WebRequest -Uri 'https://i.ebayimg.com/images/g/pRkAAeSw8D1qMoRj/s-l500.jpg' -UseBasicParsing
    Write-Output "Status: $($r.StatusCode), Content-Type: $($r.Headers['Content-Type']), Length: $($r.Content.Length)"
} catch {
    Write-Output "FAILED: $_"
}

Write-Output ""
Write-Output "=== Test 4: Buyer search page HTML ==="
try {
    $r = Invoke-WebRequest -Uri 'https://partsbazar360.realtrackapp.com/buyer/search/' -UseBasicParsing
    $matches = [regex]::Matches($r.Content, 'img-proxy[^"]*')
    foreach ($m in $matches | Select-Object -First 5) {
        Write-Output "Found: $($m.Value)"
    }
    if ($matches.Count -eq 0) {
        Write-Output "No img-proxy URLs found in HTML"
        $imgMatches = [regex]::Matches($r.Content, '<img[^>]*src[^>]*>')
        foreach ($m in $imgMatches | Select-Object -First 5) {
            Write-Output "Img tag: $($m.Value.Substring(0, [Math]::Min(200, $m.Value.Length)))"
        }
    }
} catch {
    Write-Output "FAILED: $_"
}

Write-Output ""
Write-Output "=== Test 5: gridxconnect image via proxy ==="
try {
    $r = Invoke-WebRequest -Uri 'https://partsbazar360.realtrackapp.com/img-proxy/?url=https://images.gridxconnect.io/gxc/63267bc3-3730-4c88-8710-77db616dbd60/BLA-26177/BLA-26177_6_6d1eecf4.jpg' -UseBasicParsing
    Write-Output "Status: $($r.StatusCode), Content-Type: $($r.Headers['Content-Type']), Length: $($r.Content.Length)"
} catch {
    Write-Output "FAILED: $_"
}

Write-Output ""
Write-Output "=== Test 6: ebay static stock image ==="
try {
    $r = Invoke-WebRequest -Uri 'https://partsbazar360.realtrackapp.com/img-proxy/?url=https://pics.ebaystatic.com/aw/pics/stockimage1.jpg' -UseBasicParsing
    Write-Output "Status: $($r.StatusCode), Content-Type: $($r.Headers['Content-Type']), Length: $($r.Content.Length)"
} catch {
    Write-Output "FAILED: $_"
}