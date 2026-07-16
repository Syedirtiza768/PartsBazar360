$urls = @(
    'https://partsbazar360.realtrackapp.com/img-proxy/?url=https://i.ebayimg.com/images/g/S80AAeSw5zhqD7FP/s-l500.jpg',
    'https://partsbazar360.realtrackapp.com/img-proxy/?url=https://i.ebayimg.com/images/g/sjoAAeSwl6ZqD-AX/s-l500.jpg',
    'https://partsbazar360.realtrackapp.com/img-proxy/?url=https://i.ebayimg.com/images/g/~ZYAAeSweINqDuZu/s-l500.jpg'
)

foreach ($url in $urls) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing
        Write-Output "OK: Status $($r.StatusCode), Type: $($r.Headers['Content-Type']), Length: $($r.RawContentLength)"
    } catch {
        Write-Output "FAIL: $url"
        Write-Output "  Error: $_"
    }
}