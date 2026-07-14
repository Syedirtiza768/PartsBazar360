$xml = [xml](Get-Content 'F:\apps\PartsBazar360\docx-temp\word\document.xml')
$xml.document.body.InnerText | Out-File 'F:\apps\PartsBazar360\document-text.txt' -Encoding UTF8
Write-Output "Done"
