#!/usr/bin/env bash
# Step 1.5 check: roll ranges place students into sections and parts; history; manual moves; semester promotion.
# It builds its OWN test cohort (session "SMOKE-1"), so your real cohort is not touched.
# Usage:
#   npm run seed:smoke-staff -w server
#   SMOKE_ADMIN_EMAIL=you@example.com SMOKE_ADMIN_PASSWORD='...' bash docs/api/step-1.5-smoke-test.sh
#   npm run cleanup:smoke -w server
set -u
API=${API:-http://localhost:5000/api/v1}
H='Content-Type: application/json'
pass=0; fail=0
jget() { python3 -c "import sys,json
try:
  d=json.load(sys.stdin)
  for k in sys.argv[1].split('.'):
    d=d[int(k)] if k.isdigit() else d[k]
  print(d)
except Exception: print('')" "$1"; }
pyj() { python3 -c "import sys,json
d=json.load(sys.stdin)
try: print(eval(sys.argv[1]))
except Exception: print('ERR')" "$1"; }
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1)); else echo "  FAIL  $1 (expected '$3', got '$2')"; fail=$((fail+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
post() { curl -s -X POST "$1" -H "$H" -H "$AUTH" -d "$2"; }

[ -z "${SMOKE_ADMIN_EMAIL:-}" ] || [ -z "${SMOKE_ADMIN_PASSWORD:-}" ] && { echo "Set SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD"; exit 1; }

echo "0. Log in"
S=$(curl -s -X POST $API/auth/login -H "$H" -d "{\"identifier\":\"$SMOKE_ADMIN_EMAIL\",\"password\":\"$SMOKE_ADMIN_PASSWORD\"}" | jget data.accessToken)
[ -z "$S" ] && { echo "STOP: Super Admin login failed. Use the account you created with: npm run seed:admin -w server"; exit 1; }
AUTH="Authorization: Bearer $S"
TB=$(curl -s -X POST $API/auth/login -H "$H" -d '{"identifier":"smoke-admin-b@smoke.rubayos.test","password":"Smoke-admin-2026"}' | jget data.accessToken)
TT=$(curl -s -X POST $API/auth/login -H "$H" -d '{"identifier":"smoke-teacher@smoke.rubayos.test","password":"Smoke-admin-2026"}' | jget data.accessToken)
[ -z "$TB" ] && { echo "STOP: run  npm run seed:smoke-staff -w server  first"; exit 1; }
HB="Authorization: Bearer $TB"; HT="Authorization: Bearer $TT"
check "super admin logged in" yes yes

echo "1. Build a test cohort: session SMOKE-1, 8 semesters, Section A, Part 1 = rolls 1-30"
PROG=$(curl -s "$API/academic/programs?limit=1" -H "$AUTH" | jget data.0._id)
INST=$(curl -s "$API/academic/programs?limit=1" -H "$AUTH" | jget data.0.institutionId)
DEPT=$(curl -s "$API/academic/programs?limit=1" -H "$AUTH" | jget data.0.departmentId)
[ "$(curl -s "$API/academic/sessions?limit=100" -H "$AUTH" | pyj "any(x['label']=='SMOKE-1' for x in d['data'])")" = "True" ] && { echo "STOP: an old SMOKE-1 cohort exists. Run  npm run cleanup:smoke -w server  first"; exit 1; }
SESS=$(post $API/academic/sessions "{\"institutionId\":\"$INST\",\"label\":\"SMOKE-1\",\"startYear\":2099,\"endYear\":2100}" | jget data._id)
COH=$(post $API/academic/cohorts "{\"programId\":\"$PROG\",\"sessionId\":\"$SESS\"}" | jget data._id)
check "cohort created" "$([ -n "$COH" ] && echo yes)" yes
SEMS=$(curl -s "$API/academic/semesters?cohortId=$COH&limit=20" -H "$AUTH")
check "8 semesters were generated" "$(echo "$SEMS" | jget meta.total)" 8
SEM1=$(echo "$SEMS" | pyj "[s['_id'] for s in d['data'] if s['number']==1][0]")
SEM2=$(echo "$SEMS" | pyj "[s['_id'] for s in d['data'] if s['number']==2][0]")
SECA=$(post $API/academic/sections "{\"semesterId\":\"$SEM1\",\"name\":\"A\"}" | jget data._id)
P1=$(post $API/academic/parts "{\"sectionId\":\"$SECA\",\"name\":\"Part 1\",\"rollMin\":1,\"rollMax\":30}" | jget data._id)
check "section A and Part 1 created" "$([ -n "$SECA" ] && [ -n "$P1" ] && echo yes)" yes

echo "2. Roster (rolls 5, 45, 75) and registration"
CSV=$'Name,Reg No,Roll\nSmoke Roll Five,9000000011,5\nSmoke Roll Fortyfive,9000000012,45\nSmoke Roll Seventyfive,9000000013,75\n'
BODY=$(python3 -c "import json,sys;print(json.dumps({'cohortId':sys.argv[1],'csv':sys.argv[2]}))" "$COH" "$CSV")
check "roster import creates 3" "$(post $API/roster/import "$BODY" | jget data.created)" 3
reg() { curl -s -X POST $API/auth/register -H "$H" -d "{\"departmentId\":\"$DEPT\",\"name\":\"$1\",\"registrationNo\":\"$2\",\"classRoll\":$3,\"email\":\"$4\",\"password\":\"Smoke-test-2026\"}"; }
R5=$(reg "Smoke Roll Five" 9000000011 5 smoke-r5@example.com)
reg "Smoke Roll Fortyfive" 9000000012 45 smoke-r45@example.com >/dev/null
reg "Smoke Roll Seventyfive" 9000000013 75 smoke-r75@example.com >/dev/null
check "student with roll 5 joined" "$(echo "$R5" | jget data.status)" active
ST5=$(echo "$R5" | jget data.accessToken); HS5="Authorization: Bearer $ST5"

echo "3. Joining places a student automatically when a part covers the roll"
check "roll 5 is already in Part 1 (profile)" "$(curl -s $API/auth/me -H "$HS5" | jget data.profile.partId)" "$P1"
OV=$(curl -s "$API/enrollment/overview?cohortId=$COH" -H "$AUTH")
check "3 students, 1 placed, 2 not" "$(echo "$OV" | pyj "(d['data']['totals']['students'], d['data']['totals']['assigned'], d['data']['totals']['unassigned'])")" "(3, 1, 2)"
check "rolls 45 and 75 are reported as not covered" "$(echo "$OV" | pyj "sorted(u['classRoll'] for u in d['data']['warnings']['uncovered'])")" "[45, 75]"

echo "4. Adding a part places waiting students at once"
P2=$(post $API/academic/parts "{\"sectionId\":\"$SECA\",\"name\":\"Part 2\",\"rollMin\":61,\"rollMax\":90}" | jget data._id)
OV=$(curl -s "$API/enrollment/overview?cohortId=$COH" -H "$AUTH")
check "roll 75 was placed automatically" "$(echo "$OV" | jget data.totals.unassigned)" 1
check "a gap 31-60 is flagged" "$(echo "$OV" | pyj "any(g['from']==31 and g['to']==60 for g in d['data']['warnings']['gaps'])")" True
check "an overlapping part (25-70) is refused" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/academic/parts -H "$H" -H "$AUTH" -d "{\"sectionId\":\"$SECA\",\"name\":\"Bad\",\"rollMin\":25,\"rollMax\":70}")" 409
P3=$(post $API/academic/parts "{\"sectionId\":\"$SECA\",\"name\":\"Part 3\",\"rollMin\":40,\"rollMax\":50}" | jget data._id)
OV=$(curl -s "$API/enrollment/overview?cohortId=$COH" -H "$AUTH")
check "roll 45 was placed; nobody is left waiting" "$(echo "$OV" | jget data.totals.unassigned)" 0
check "gaps are now 31-39 and 51-60" "$(echo "$OV" | pyj "[(g['from'],g['to']) for g in d['data']['warnings']['gaps']]")" "[(31, 39), (51, 60)]"
LIST=$(curl -s "$API/enrollment/students?cohortId=$COH" -H "$AUTH")
PID5=$(echo "$LIST" | pyj "[s['profileId'] for s in d['data'] if s['classRoll']==5][0]")
PID45=$(echo "$LIST" | pyj "[s['profileId'] for s in d['data'] if s['classRoll']==45][0]")
check "roll 45's history shows the automatic placement" "$(curl -s $API/enrollment/students/$PID45/history -H "$AUTH" | pyj "[h['method'] for h in d['data']['history']]")" "['auto']"

echo "5. Manual move, and automatic runs respect it"
check "dry run on a clean cohort changes nothing" "$(post $API/enrollment/assign "{\"cohortId\":\"$COH\",\"mode\":\"all\",\"dryRun\":true}" | jget data.assigned)" 0
RE=$(post $API/enrollment/students/$PID5/reassign "{\"partId\":\"$P2\",\"reason\":\"Smoke test: moved by hand\"}")
check "moving roll 5 to Part 2 works" "$(echo "$RE" | jget data.partId)" "$P2"
check "...and is flagged as outside the roll range" "$(echo "$RE" | jget data.outsideRange)" True
check "moving to the same part again is refused (409)" "$(code -X POST $API/enrollment/students/$PID5/reassign -H "$H" -H "$AUTH" -d "{\"partId\":\"$P2\",\"reason\":\"again\"}")" 409
AR=$(post $API/enrollment/assign "{\"cohortId\":\"$COH\",\"mode\":\"all\"}")
check "a full automatic run moves nobody and skips the hand-placed student" "$(echo "$AR" | pyj "(d['data']['assigned'], d['data']['manual'])")" "(0, 1)"
check "roll 5 stayed in Part 2" "$(curl -s $API/auth/me -H "$HS5" | jget data.profile.partId)" "$P2"
check "history keeps both placements for roll 5" "$(curl -s $API/enrollment/students/$PID5/history -H "$AUTH" | pyj "len(d['data']['history'])")" 2
check "a part from the wrong semester is refused (400)" "$(code -X POST $API/enrollment/students/$PID45/reassign -H "$H" -H "$AUTH" -d '{"partId":"000000000000000000000000","reason":"nonsense id"}')" 400

echo "6. Other admins and roles are kept out"
check "admin B cannot see this cohort's overview (403)" "$(code "$API/enrollment/overview?cohortId=$COH" -H "$HB")" 403
check "admin B cannot run an assignment (403)" "$(code -X POST $API/enrollment/assign -H "$H" -H "$HB" -d "{\"cohortId\":\"$COH\"}")" 403
check "admin B cannot promote the cohort (403)" "$(code -X POST $API/enrollment/cohorts/$COH/promote -H "$H" -H "$HB" -d '{"toSemesterNo":2}')" 403
check "admin B cannot see the student (404)" "$(code $API/enrollment/students/$PID5/history -H "$HB")" 404
check "admin B cannot move the student (404)" "$(code -X POST $API/enrollment/students/$PID5/reassign -H "$H" -H "$HB" -d "{\"partId\":\"$P1\",\"reason\":\"hack attempt\"}")" 404
check "a teacher cannot use enrollment (403)" "$(code "$API/enrollment/overview?cohortId=$COH" -H "$HT")" 403
check "a student cannot use enrollment (403)" "$(code "$API/enrollment/overview?cohortId=$COH" -H "$HS5")" 403

echo "7. Semester promotion keeps history"
check "skipping a semester is refused (400)" "$(code -X POST $API/enrollment/cohorts/$COH/promote -H "$H" -H "$AUTH" -d '{"toSemesterNo":3}')" 400
PR=$(post $API/enrollment/cohorts/$COH/promote '{"toSemesterNo":2}')
check "promotion to semester 2 moves 3 students" "$(echo "$PR" | pyj "(d['data']['students'], d['data']['assigned'], d['data']['unassigned'])")" "(3, 0, 3)"
check "the cohort is now in semester 2" "$(curl -s $API/academic/cohorts/$COH -H "$AUTH" | jget data.currentSemesterNo)" 2
check "semester 1 records are kept and closed" "$(curl -s "$API/enrollment/students?cohortId=$COH&semesterId=$SEM1" -H "$AUTH" | pyj "[s['status'] for s in d['data']]")" "['completed', 'completed', 'completed']"
check "roll 5 still shows Part 2 for semester 1" "$(curl -s "$API/enrollment/students?cohortId=$COH&semesterId=$SEM1" -H "$AUTH" | pyj "[s['partId'] for s in d['data'] if s['classRoll']==5][0]")" "$P2"
check "in semester 2 nobody has a part yet" "$(curl -s "$API/enrollment/students?cohortId=$COH&unassigned=true" -H "$AUTH" | jget meta.total)" 3
check "the student profile now points to semester 2 with no part" "$(curl -s $API/auth/me -H "$HS5" | jget data.profile.partId)" None
check "the student has two semester records" "$(curl -s $API/enrollment/students/$PID5/history -H "$AUTH" | pyj "len(d['data']['semesters'])")" 2

echo "8. Parts for the new semester place students automatically"
SEC2=$(post $API/academic/sections "{\"semesterId\":\"$SEM2\",\"name\":\"A\"}" | jget data._id)
P21=$(post $API/academic/parts "{\"sectionId\":\"$SEC2\",\"name\":\"Part 1\",\"rollMin\":1,\"rollMax\":30}" | jget data._id)
check "roll 5 is placed in the new semester's Part 1" "$(curl -s $API/auth/me -H "$HS5" | jget data.profile.partId)" "$P21"
check "the old semester's record did not change" "$(curl -s "$API/enrollment/students?cohortId=$COH&semesterId=$SEM1" -H "$AUTH" | pyj "[s['partId'] for s in d['data'] if s['classRoll']==5][0]")" "$P2"

echo; echo "Result: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
