import sys, re

html = sys.stdin.read()
# Find all eBay image URLs
urls = re.findall(r'https://i\.ebayimg\.com[^"\\]+', html)
print(f"Total eBay image URLs found: {len(urls)}")
print("---")
for u in urls:
    print(u)
