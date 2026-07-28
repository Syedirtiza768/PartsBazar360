import zipfile
import re

z = zipfile.ZipFile(r"F:/apps/PartsBazar360/Published Listings Reader.docx")
xml = z.read("word/document.xml").decode("utf-8")
text = re.sub(r"</w:p>", "\n", xml)
text = re.sub(r"<[^>]+>", "", text)
for a, b in [("&amp;", "&"), ("&quot;", '"'), ("&lt;", "<"), ("&gt;", ">")]:
    text = text.replace(a, b)
out = r"F:/apps/PartsBazar360/tmp/rt-contract-full.txt"
with open(out, "w", encoding="utf-8") as f:
    f.write(text)
print("wrote", out, "chars", len(text))
