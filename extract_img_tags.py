import sys, re

html = sys.stdin.read()
# Find actual <img> tags with src attribute
urls = re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', html)
print(f"Total <img> src URLs: {len(urls)}")
print("---")
for u in urls:
    print(u)
