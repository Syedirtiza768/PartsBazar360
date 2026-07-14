$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Open("F:\apps\PartsBazar360\Published Listings Reader.docx")
$text = $doc.Content.Text
$doc.Close()
$word.Quit()
$text | Out-File -FilePath "F:\apps\PartsBazar360\document-text.txt" -Encoding UTF8
Write-Output "Document text extracted successfully"
