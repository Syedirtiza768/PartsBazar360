#!/usr/bin/env python3
import urllib.request, json
data = json.dumps({"partId": "0a4583af-44cd-44bc-a459-4cd17f2df80d"}).encode()
req = urllib.request.Request(
    "https://partsbazar360.com/buyer/api/revalidate/",
    data=data,
    headers={
        "Content-Type": "application/json",
        "x-revalidate-secret": "0ef6bcfb592dc55d127245076ca3f5881244168fe612a95f"
    }
)
print(urllib.request.urlopen(req).read().decode())
