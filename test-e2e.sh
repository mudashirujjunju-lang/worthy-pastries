#!/usr/bin/env bash
# End-to-end API smoke test. Usage: BASE=http://localhost:3000 PW=changeme ./test-e2e.sh
B=${BASE:-http://localhost:3000}; PW=${PW:-changeme}; J='Content-Type: application/json'; D=$(date -d tomorrow +%F)
P="07$(shuf -i 10000000-99999999 -n1)"; pass=0; fail=0
ok(){ if eval "$2"; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1"; fail=$((fail+1)); fi; }
Q=$(curl -s -XPOST $B/api/quote -H "$J" -d "{\"items\":[{\"id\":\"choc\",\"size\":1,\"qty\":2}],\"area\":\"Kansanga\",\"promo\":\"WORTHY10\",\"phone\":\"$P\"}")
ok "quote: 2x2kg choc=280000, -10%=28000, +5000 fee => 257000" '[[ $(echo $Q|jq .total) == 257000 ]]'
R=$(curl -s -XPOST $B/api/orders -H "$J" -d "{\"name\":\"Test Customer\",\"phone\":\"$P\",\"area\":\"Makindye\",\"date\":\"$D\",\"payment\":\"MTN Mobile Money\",\"promo\":\"WORTHY10\",\"items\":[{\"id\":\"vanilla\",\"size\":0,\"qty\":1,\"price\":1}]}")
N=$(echo $R|jq -r .number); ok "order created $N, client price ignored, total=54000 (60000-6000, free Makindye)" '[[ $N == WP-* && $(echo $R|jq .total) == 54000 ]]'
ok "MoMo instructions returned" '[[ $(echo $R|jq -r .paymentInstructions) == *WhatsApp* ]]'
R2=$(curl -s -XPOST $B/api/orders -H "$J" -d "{\"name\":\"T\",\"phone\":\"$P\",\"area\":\"Makindye\",\"date\":\"$D\",\"payment\":\"Cash on delivery\",\"promo\":\"WORTHY10\",\"items\":[{\"id\":\"vanilla\",\"size\":0,\"qty\":1}]}")
ok "WORTHY10 rejected on 2nd order" '[[ $(echo $R2|jq -r .error) == *first* ]]'
ok "invalid phone rejected" '[[ $(curl -s -XPOST $B/api/orders -H "$J" -d "{\"name\":\"T\",\"phone\":\"123\",\"area\":\"Makindye\",\"date\":\"$D\",\"payment\":\"Cash on delivery\",\"items\":[{\"id\":\"vanilla\",\"size\":0,\"qty\":1}]}"|jq -r .error) == *phone* ]]'
ok "bad size rejected" '[[ $(curl -s -XPOST $B/api/quote -H "$J" -d "{\"items\":[{\"id\":\"vanilla\",\"size\":9,\"qty\":1}],\"area\":\"Makindye\"}"|jq -r .error) == *size* ]]'
ok "track wrong phone 404" '[[ $(curl -s -o /dev/null -w %{http_code} -XPOST $B/api/track -H "$J" -d "{\"number\":\"$N\",\"phone\":\"0700000000\"}") == 404 ]]'
ok "track works with +256 format" '[[ $(curl -s -XPOST $B/api/track -H "$J" -d "{\"number\":\"$N\",\"phone\":\"+256${P:1}\"}"|jq -r .status) == New ]]'
ok "admin w/o token 401" '[[ $(curl -s -o /dev/null -w %{http_code} $B/api/admin/orders) == 401 ]]'
ok "admin wrong pw 401" '[[ $(curl -s -o /dev/null -w %{http_code} -XPOST $B/api/admin/login -H "$J" -d "{\"password\":\"nope\"}") == 401 ]]'
T=$(curl -s -XPOST $B/api/admin/login -H "$J" -d "{\"password\":\"$PW\"}"|jq -r .token); A="Authorization: Bearer $T"
ok "admin lists order" '[[ $(curl -s $B/api/admin/orders -H "$A"|jq --arg n $N "[.orders[]|select(.number==\$n)]|length") == 1 ]]'
U=$(curl -s -XPATCH $B/api/admin/orders/$N -H "$A" -H "$J" -d '{"status":"Baking","paid":true}')
ok "admin status->Baking, paid" '[[ $(echo $U|jq -r .status) == Baking && $(echo $U|jq .paid) == true ]]'
ok "invalid status rejected" '[[ $(curl -s -o /dev/null -w %{http_code} -XPATCH $B/api/admin/orders/$N -H "$A" -H "$J" -d "{\"status\":\"Eaten\"}") == 400 ]]'
ok "customer sees Baking + paid" '[[ $(curl -s -XPOST $B/api/track -H "$J" -d "{\"number\":\"$N\",\"phone\":\"$P\"}"|jq -r "\"\(.status)/\(.paid)\"") == Baking/true ]]'
ok "admin filter Baking" '[[ $(curl -s "$B/api/admin/orders?status=Baking" -H "$A"|jq "[.orders[].status]|unique") == *Baking* ]]'
IMG=$(base64 -w0 public/icon-192.png)
C=$(curl -s -XPOST $B/api/custom-requests -H "$J" -d "{\"name\":\"Test\",\"phone\":\"$P\",\"occasion\":\"Graduation\",\"date\":\"$D\",\"budget\":200000,\"description\":\"Mortarboard cake\",\"photo\":\"data:image/png;base64,$IMG\"}")
ok "custom request + photo saved" '[[ $(echo $C|jq -r .ref) == CR-* && $(curl -s $B/api/admin/custom-requests -H "$A"|jq -r ".[0].photo") == *.png ]]'
echo "== $pass passed, $fail failed =="; echo "ORDER=$N PHONE=$P"
