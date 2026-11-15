#!/usr/bin/env bash
# Step 1.4 check: scoped admins cannot reach each other's data. Needs a RUNNING server and the Step 1.2/1.3 test data.
# Usage:
#   npm run seed:smoke-staff -w server
#   SMOKE_ADMIN_EMAIL=you@example.com SMOKE_ADMIN_PASSWORD='...' bash docs/api/step-1.4-smoke-test.sh
#   npm run cleanup:smoke -w server
set -u
API=${API:-http://localhost:5000/api/v1}
H='Content-Type: application/json'
PW='Smoke-admin-2026'; D='@smoke.rubayos.test'
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
login() { curl -s -X POST $API/auth/login -H "$H" -d "{\"identifier\":\"$1\",\"password\":\"$2\"}"; }

[ -z "${SMOKE_ADMIN_EMAIL:-}" ] || [ -z "${SMOKE_ADMIN_PASSWORD:-}" ] && { echo "Set SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD"; exit 1; }

echo "0. Log in as everyone"
RS=$(login "$SMOKE_ADMIN_EMAIL" "$SMOKE_ADMIN_PASSWORD"); S=$(echo "$RS" | jget data.accessToken); SUPER_ID=$(echo "$RS" | jget data.user.id)
RA=$(login "smoke-admin-a$D" "$PW"); TA=$(echo "$RA" | jget data.accessToken)
RB=$(login "smoke-admin-b$D" "$PW"); TB=$(echo "$RB" | jget data.accessToken); B_ID=$(echo "$RB" | jget data.user.id)
RT=$(login "smoke-teacher$D" "$PW"); TT=$(echo "$RT" | jget data.accessToken); T_ID=$(echo "$RT" | jget data.user.id)
[ -z "$S" ] && { echo; echo "STOP: the Super Admin login failed, so every later check would be meaningless."; echo "Use the email and password of the Super Admin you created with: npm run seed:admin -w server"; exit 1; }
for v in S TA TB TT; do check "token for $v" "$([ -n "${!v}" ] && echo yes)" yes; done
[ -z "$TA" ] && { echo "Run: npm run seed:smoke-staff -w server"; exit 1; }
HS="Authorization: Bearer $S"; HA="Authorization: Bearer $TA"; HB="Authorization: Bearer $TB"; HT="Authorization: Bearer $TT"

DEPT_A=$(curl -s "$API/academic/departments?limit=100" -H "$HS" | python3 -c "import sys,json
for d in json.load(sys.stdin)['data']:
  if d['code']=='CSE': print(d['_id'])")
DEPT_B=$(curl -s "$API/academic/departments?limit=100" -H "$HS" | python3 -c "import sys,json
for d in json.load(sys.stdin)['data']:
  if d['code']=='SMOKEDB': print(d['_id'])")
INST=$(curl -s "$API/academic/departments/$DEPT_A" -H "$HS" | jget data.institutionId)
COLL_A=$(curl -s "$API/academic/departments/$DEPT_A" -H "$HS" | jget data.collegeId)
COH=$(curl -s "$API/academic/cohorts?limit=1" -H "$HS" | jget data.0._id)
SEM=$(curl -s "$API/academic/semesters?cohortId=$COH&limit=1" -H "$HS" | jget data.0._id)
SEC=$(curl -s "$API/academic/sections?cohortId=$COH&limit=1" -H "$HS" | jget data.0._id)
check "found both departments, a cohort and a section" "$([ -n "$DEPT_A" ] && [ -n "$DEPT_B" ] && [ -n "$COH" ] && [ -n "$SEC" ] && echo yes)" yes

echo "1. Lists only show your own area"
check "super admin sees both departments" "$([ "$(curl -s "$API/academic/departments" -H "$HS" | jget meta.total)" -ge 2 ] && echo yes)" yes
check "admin A sees exactly 1 department" "$(curl -s "$API/academic/departments" -H "$HA" | jget meta.total)" 1
check "admin A sees exactly 1 college" "$(curl -s "$API/academic/colleges" -H "$HA" | jget meta.total)" 1
check "admin B sees 0 cohorts (none are theirs)" "$(curl -s "$API/academic/cohorts" -H "$HB" | jget meta.total)" 0
check "admin B sees 0 sections" "$(curl -s "$API/academic/sections" -H "$HB" | jget meta.total)" 0
check "admin A sees the cohort" "$([ "$(curl -s "$API/academic/cohorts" -H "$HA" | jget meta.total)" -ge 1 ] && echo yes)" yes

echo "2. Records outside your area do not exist for you (404, not 403)"
check "A reads own department" "$(code $API/academic/departments/$DEPT_A -H "$HA")" 200
check "A reading department B -> 404" "$(code $API/academic/departments/$DEPT_B -H "$HA")" 404
check "B reading A's cohort -> 404" "$(code $API/academic/cohorts/$COH -H "$HB")" 404
check "B reading A's section -> 404" "$(code $API/academic/sections/$SEC -H "$HB")" 404
check "B editing A's cohort -> 404" "$(code -X PATCH $API/academic/cohorts/$COH -H "$H" -H "$HB" -d '{"currentSemesterNo":2}')" 404

echo "3. Writes outside your area are refused (403)"
check "B creating a section in A's semester -> 403" "$(code -X POST $API/academic/sections -H "$H" -H "$HB" -d "{\"semesterId\":\"$SEM\",\"name\":\"Hack\"}")" 403
check "B creating a part in A's section -> 403" "$(code -X POST $API/academic/parts -H "$H" -H "$HB" -d "{\"sectionId\":\"$SEC\",\"name\":\"Hack\",\"rollMin\":200,\"rollMax\":210}")" 403
check "A cannot create a college" "$(code -X POST $API/academic/colleges -H "$H" -H "$HA" -d "{\"institutionId\":\"$INST\",\"name\":\"Evil College\",\"code\":\"EVIL\"}")" 403
check "A cannot create a department" "$(code -X POST $API/academic/departments -H "$H" -H "$HA" -d "{\"collegeId\":\"$COLL_A\",\"name\":\"Evil Dept\",\"code\":\"EVIL\"}")" 403
check "A cannot rename its own department" "$(code -X PATCH $API/academic/departments/$DEPT_A -H "$H" -H "$HA" -d '{"name":"Renamed"}')" 403
check "A can edit its own section" "$(code -X PATCH $API/academic/sections/$SEC -H "$H" -H "$HA" -d '{"status":"active"}')" 200
check "client-supplied parent ids are ignored/rejected (422)" "$(code -X POST $API/academic/sections -H "$H" -H "$HA" -d "{\"semesterId\":\"$SEM\",\"name\":\"X\",\"cohortId\":\"$COH\"}")" 422
check "teacher cannot use the admin API (403)" "$(code $API/academic/cohorts -H "$HT")" 403
check "no token -> 401" "$(code $API/academic/cohorts)" 401

echo "4. Staff creation ladder"
check "A cannot create a teacher in department B" "$(code -X POST $API/staff -H "$H" -H "$HA" -d "{\"name\":\"Evil Teacher\",\"email\":\"evil$D\",\"role\":\"teacher\",\"departmentId\":\"$DEPT_B\"}")" 403
check "A cannot create a college admin" "$(code -X POST $API/staff -H "$H" -H "$HA" -d "{\"name\":\"Evil Boss\",\"email\":\"evil2$D\",\"role\":\"college_admin\",\"collegeId\":\"$COLL_A\"}")" 403
check "A cannot create a department admin" "$(code -X POST $API/staff -H "$H" -H "$HA" -d "{\"name\":\"Evil Admin\",\"email\":\"evil3$D\",\"role\":\"department_admin\",\"departmentId\":\"$DEPT_A\"}")" 403
check "A can create a teacher in own department" "$(code -X POST $API/staff -H "$H" -H "$HA" -d "{\"name\":\"Smoke New Teacher\",\"email\":\"smoke-new-teacher$D\",\"role\":\"teacher\",\"departmentId\":\"$DEPT_A\"}")" 201
check "teacher cannot create staff" "$(code -X POST $API/staff -H "$H" -H "$HT" -d '{}')" 403

echo "5. Managing users"
check "A sees the teacher in the user list" "$(curl -s "$API/users?limit=100" -H "$HA" | python3 -c "import sys,json;print(any(u['email'].startswith('smoke-teacher') for u in json.load(sys.stdin)['data']))")" True
check "A does NOT see admin B in the user list" "$(curl -s "$API/users?limit=100" -H "$HA" | python3 -c "import sys,json;print(any(u['email'].startswith('smoke-admin-b') for u in json.load(sys.stdin)['data']))")" False
check "A reading admin B -> 404" "$(code $API/users/$B_ID -H "$HA")" 404
check "A reading the super admin -> 404" "$(code $API/users/$SUPER_ID -H "$HA")" 404
check "A deactivating admin B -> 404" "$(code -X POST $API/users/$B_ID/deactivate -H "$H" -H "$HA" -d '{"reason":"hack attempt"}')" 404
check "A deactivating the super admin -> 404" "$(code -X POST $API/users/$SUPER_ID/deactivate -H "$H" -H "$HA" -d '{"reason":"hack attempt"}')" 404
check "super admin cannot deactivate itself (400)" "$(code -X POST $API/users/$SUPER_ID/deactivate -H "$H" -H "$HS" -d '{"reason":"oops"}')" 400
A_ID=$(echo "$RA" | jget data.user.id)
check "A cannot deactivate itself (400)" "$(code -X POST $API/users/$A_ID/deactivate -H "$H" -H "$HA" -d '{"reason":"oops"}')" 400

echo "6. Deactivation works at once"
check "teacher token works before" "$(code $API/auth/me -H "$HT")" 200
check "A deactivates the teacher" "$(code -X POST $API/users/$T_ID/deactivate -H "$H" -H "$HA" -d '{"reason":"smoke test"}')" 200
check "the teacher's existing token stops working immediately" "$(code $API/auth/me -H "$HT")" 401
check "the teacher cannot log in" "$(login "smoke-teacher$D" "$PW" | jget error.code)" ACCOUNT_DISABLED
check "A reactivates the teacher" "$(code -X POST $API/users/$T_ID/reactivate -H "$H" -H "$HA" -d '{}')" 200
check "the teacher can log in again" "$([ -n "$(login "smoke-teacher$D" "$PW" | jget data.accessToken)" ] && echo yes)" yes

echo "7. Role changes work at once"
ASSIGN=$(curl -s $API/users/$B_ID -H "$HS" | jget data.roles.0.assignmentId)
check "admin B token works before" "$(code $API/academic/departments -H "$HB")" 200
check "super admin removes admin B's role" "$(code -X DELETE $API/users/$B_ID/roles/$ASSIGN -H "$HS")" 200
check "admin B's old token is dead immediately" "$(code $API/academic/departments -H "$HB")" 401
TB2=$(login "smoke-admin-b$D" "$PW" | jget data.accessToken)
check "after logging in again admin B has no admin power (403)" "$(code $API/academic/departments -H "Authorization: Bearer $TB2")" 403

echo; echo "Result: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
