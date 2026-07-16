$r = Invoke-WebRequest -Uri 'https://partsbazar360.realtrackapp.com/buyer/search/' -UseBasicParsing
$matches = [regex]::Matches($r.Content, 'src="[^"]*img-proxy[^"]*"')
Write-Output "=== img src URLs with proxy ==="
foreach ($m in $matches | Select-Object -First 5) {
    Write-Output $m.Value
}
if ($matches.Count -eq 0) {
    Write-Output "No img-proxy in src attributes"
    $matches2 = [regex]::Matches($r.Content, 'src="[^"]*"')
    Write-Output "=== All src URLs ==="
    foreach ($m in $matches2 | Select-Object -First 10) {
        Write-Output $m.Value
    }
}