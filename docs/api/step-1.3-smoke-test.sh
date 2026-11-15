#!/usr/bin/env bash
# Step 1.3 end-to-end check against a RUNNING server (npm run dev:server).
# Usage:
#   SMOKE_ADMIN_EMAIL=you@example.com SMOKE_ADMIN_PASSWORD='...' bash docs/api/step-1.3-smoke-test.sh
# It creates 3 fake students (registration numbers 90000000xx). Remove them afterwards with:
#   npm run cleanup:smoke -w server
set -u
API=${API:-http://localhost:5000/api/v1}
H='Content-Type: application/json'
JAR=$(mktemp); JAR_OLD=$(mktemp)
pass=0; fail=0
jget() { python3 -c "import sys,json
try:
  d=json.load(sys.stdin)
  for k in sys.argv[1].split('.'):
    d=d[int(k)] if k.isdigit() else d[k]
  print(d)
except Exception: print('')" "$1"; }
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1)); else echo "  FAIL  $1 (expected '$3', got '$2')"; fail=$((fail+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

[ -z "${SMOKE_ADMIN_EMAIL:-}" ] || [ -z "${SMOKE_ADMIN_PASSWORD:-}" ] && { echo "Set SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD"; exit 1; }

echo "1. Admin login"
R=$(curl -s -c "$JAR" -X POST $API/auth/login -H "$H" -d "{\"identifier\":\"$SMOKE_ADMIN_EMAIL\",\"password\":\"$SMOKE_ADMIN_PASSWORD\"}")
TOKEN=$(echo "$R" | jget data.accessToken); check "admin gets an access token" "$([ -n "$TOKEN" ] && echo yes)" yes
[ -z "$TOKEN" ] && { echo; echo "STOP: the admin login failed, so every later check would be meaningless."; echo "Use the email and password of the Super Admin you created with: npm run seed:admin -w server"; exit 1; }
A="Authorization: Bearer $TOKEN"
check "GET /auth/me works with the token" "$(code $API/auth/me -H "$A")" 200
check "GET /auth/me fails without it" "$(code $API/auth/me)" 401

echo "2. Find department and cohort"
DEPT=$(curl -s $API/public/departments | jget data.0.id)
COH=$(curl -s "$API/academic/cohorts?limit=1" -H "$A" | jget data.0._id)
check "a department exists" "$([ -n "$DEPT" ] && echo yes)" yes
check "a cohort exists (run the Step 1.2 test first)" "$([ -n "$COH" ] && echo yes)" yes

echo "3. Roster import (CSV, dry run then real)"
CSV=$'Name,Reg No,Roll\nTest Student One,9000000001,81\nTest Student Two,9000000002,82\nTest Student Three,9000000003,83\n'
BODY=$(python3 -c "import json,sys;print(json.dumps({'cohortId':sys.argv[1],'csv':sys.argv[2],'dryRun':True}))" "$COH" "$CSV")
check "dry run counts 3 new rows" "$(curl -s -X POST $API/roster/import -H "$H" -H "$A" -d "$BODY" | jget data.created)" 3
BODY=$(python3 -c "import json,sys;print(json.dumps({'cohortId':sys.argv[1],'csv':sys.argv[2]}))" "$COH" "$CSV")
check "real import creates 3" "$(curl -s -X POST $API/roster/import -H "$H" -H "$A" -d "$BODY" | jget data.created)" 3
check "importing again creates 0" "$(curl -s -X POST $API/roster/import -H "$H" -H "$A" -d "$BODY" | jget data.created)" 0

echo "4. Student 1: exact match joins automatically"
reg() { curl -s -w '\n%{http_code}' -X POST $API/auth/register -H "$H" "${@:2}" -d "{\"departmentId\":\"$DEPT\",\"name\":\"$1\",\"registrationNo\":\"$2\",\"classRoll\":$3,\"email\":\"$4\",\"password\":\"Smoke-test-2026\"}"; }
OUT=$(curl -s -c "$JAR" -w '\n%{http_code}' -X POST $API/auth/register -H "$H" -d "{\"departmentId\":\"$DEPT\",\"name\":\"test  STUDENT one\",\"registrationNo\":\"9000000001\",\"classRoll\":81,\"email\":\"smoke1@example.com\",\"password\":\"Smoke-test-2026\"}")
check "HTTP 201 and active" "$(echo "$OUT" | tail -1) $(echo "$OUT" | head -1 | jget data.status)" "201 active"
S1=$(echo "$OUT" | head -1 | jget data.accessToken)
check "student /me has a profile" "$(curl -s $API/auth/me -H "Authorization: Bearer $S1" | jget data.profile.classRoll)" 81
check "student cannot read the roster (403)" "$(code "$API/roster?cohortId=$COH" -H "Authorization: Bearer $S1")" 403
check "student cannot create staff (403)" "$(code -X POST $API/staff -H "$H" -H "Authorization: Bearer $S1" -d '{}')" 403
check "same registration number again is refused (409)" "$(code -X POST $API/auth/register -H "$H" -d "{\"departmentId\":\"$DEPT\",\"name\":\"Test Student One\",\"registrationNo\":\"9000000001\",\"classRoll\":81,\"email\":\"other@example.com\",\"password\":\"Smoke-test-2026\"}")" 409

echo "5. Student 2: wrong roll goes to admin approval"
OUT=$(curl -s -w '\n%{http_code}' -X POST $API/auth/register -H "$H" -d "{\"departmentId\":\"$DEPT\",\"name\":\"Test Student Two\",\"registrationNo\":\"9000000002\",\"classRoll\":99,\"email\":\"smoke2@example.com\",\"password\":\"Smoke-test-2026\"}")
check "HTTP 202 pending" "$(echo "$OUT" | tail -1) $(echo "$OUT" | head -1 | jget data.status)" "202 pending_approval"
R=$(curl -s -X POST $API/auth/login -H "$H" -d '{"identifier":"9000000002","password":"Smoke-test-2026"}')
check "pending student cannot log in" "$(echo "$R" | jget error.code)" ACCOUNT_PENDING
check "wrong password gives a generic 401" "$(code -X POST $API/auth/login -H "$H" -d '{"identifier":"9000000002","password":"nope-nope-nope"}')" 401

echo "6. Admin approves student 2"
RID=$(curl -s "$API/registrations?status=pending" -H "$A" | python3 -c "import sys,json
for r in json.load(sys.stdin)['data']:
  if r['submitted']['registrationNo']=='9000000002': print(r['_id'])")
check "request is visible to the admin" "$([ -n "$RID" ] && echo yes)" yes
check "approve works" "$(curl -s -X POST $API/registrations/$RID/approve -H "$H" -H "$A" -d '{}' | jget data.status)" approved
R=$(curl -s -X POST $API/auth/login -H "$H" -d '{"identifier":"smoke2@example.com","password":"Smoke-test-2026"}')
check "approved student can log in with email" "$([ -n "$(echo "$R" | jget data.accessToken)" ] && echo yes)" yes

echo "7. Student 3: not in roster at all"
curl -s -o /dev/null -X POST $API/auth/register -H "$H" -d "{\"departmentId\":\"$DEPT\",\"name\":\"Stranger Person\",\"registrationNo\":\"9000000099\",\"classRoll\":55,\"email\":\"smoke3@example.com\",\"password\":\"Smoke-test-2026\"}"
RID=$(curl -s "$API/registrations?status=pending" -H "$A" | python3 -c "import sys,json
for r in json.load(sys.stdin)['data']:
  if r['submitted']['registrationNo']=='9000000099': print(r['_id'], r['reasons'])")
check "queued with reason not_in_roster" "$(echo "$RID" | grep -c not_in_roster)" 1
RID=$(echo "$RID" | cut -d' ' -f1)
check "approve without a cohort is refused (400)" "$(code -X POST $API/registrations/$RID/approve -H "$H" -H "$A" -d '{}')" 400
check "reject works" "$(curl -s -X POST $API/registrations/$RID/reject -H "$H" -H "$A" -d '{"reason":"Not a student of this college"}' | jget data.status)" rejected

echo "8. Refresh rotation and reuse detection"
cp "$JAR" "$JAR_OLD"
check "refresh with the cookie works" "$(curl -s -b "$JAR" -c "$JAR" -X POST $API/auth/refresh | jget data.accessToken | head -c 1 | wc -c | tr -d ' ')" 1
echo "  ...waiting 11 s so the old token is outside the 10 s grace window"; sleep 11
check "replaying the OLD refresh cookie is refused" "$(code -b "$JAR_OLD" -X POST $API/auth/refresh)" 401
check "the NEW cookie is now dead too (whole login revoked)" "$(code -b "$JAR" -X POST $API/auth/refresh)" 401

echo "9. Logout kills the access token at once"
R=$(curl -s -c "$JAR" -X POST $API/auth/login -H "$H" -d "{\"identifier\":\"$SMOKE_ADMIN_EMAIL\",\"password\":\"$SMOKE_ADMIN_PASSWORD\"}"); T2=$(echo "$R" | jget data.accessToken)
check "token works" "$(code $API/auth/me -H "Authorization: Bearer $T2")" 200
curl -s -b "$JAR" -X POST $API/auth/logout >/dev/null
check "token stops working right after logout" "$(code $API/auth/me -H "Authorization: Bearer $T2")" 401

echo "10. Forgot password gives the same answer for unknown accounts"
check "unknown account" "$(code -X POST $API/auth/forgot-password -H "$H" -d '{"identifier":"nobody@example.com"}')" 200
check "known account" "$(code -X POST $API/auth/forgot-password -H "$H" -d '{"identifier":"smoke2@example.com"}')" 200
echo "  (look in the server terminal for the EMAIL (console mode) reset link)"

echo; echo "Result: $pass passed, $fail failed"
rm -f "$JAR" "$JAR_OLD"
[ "$fail" -eq 0 ]
