#!/bin/sh
# Submit sitemap URLs to IndexNow (Bing, Yandex, Seznam, Naver; Yahoo/DDG use Bing) after deploy.
U=https://worthy-pastries.onrender.com; KEY=$(cat "$(dirname "$0")/.indexnow-key")
curl -s -o /dev/null -w "IndexNow HTTP %{http_code}\n" -X POST https://api.indexnow.org/indexnow -H 'Content-Type: application/json; charset=utf-8' \
 -d "{\"host\":\"worthy-pastries.onrender.com\",\"key\":\"$KEY\",\"keyLocation\":\"$U/$KEY.txt\",\"urlList\":[\"$U/\",\"$U/track\"]}"
