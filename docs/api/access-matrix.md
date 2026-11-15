# Who can do what (Step 1.4)

Rules live in `server/src/modules/auth/policy.ts` and are tested in `server/tests/policy.test.ts`.
An action is allowed only when ONE role assignment both has the right role and covers the area of the record.

| Action | Super Admin | College Admin (own college) | Department Admin (own department) |
|---|---|---|---|
| Institution: read / change | all / yes | read | read |
| College: read / create / change | all / yes / yes | read own | read own |
| Department: read / create / change | all / yes / yes | own college: yes / yes / yes | read own |
| Program: read / create / change | all / yes / yes | own college: yes / yes / yes | read own |
| Session (shared by the institution): read / create / change | yes / yes / yes | read / yes / no | read / yes / no |
| Cohort, semester, section, part: read / create / change | all | own college | own department |
| Roster import, registration approval | all | own college | own department |
| Enrollment: view sections/parts, auto-assign, move a student, promote a semester | all | own college | own department |
| Create college admin | yes | no | no |
| Create department admin | yes | own college | no |
| Create teacher | yes | own college | own department |
| Deactivate / reactivate / change roles of a user | anyone except another Super Admin | roles below college admin, in own college | roles below department admin, in own department |

Teachers, students and CRs have no access to these admin APIs.

Rules that always hold:
- Records outside your area answer 404 (they do not exist for you). Records you can see but not change answer 403.
- Parent ids (cohort, college, department) are looked up in the database. Ids sent by the client for them are rejected.
- Nobody can manage an equal or higher role. Nobody can manage a Super Admin, including another Super Admin.
- Nobody can deactivate or change the roles of their own account.
- Deactivation and role changes take effect at once: old access tokens stop working and all logins are ended.
- Super Admin accounts are created only with `npm run seed:admin`.

## Roll engine (Step 1.5)

- A student's section and part come from the roll ranges of the part, never from what the student types.
- Placement happens when a student joins, when a part is created or edited, and on demand (`POST /enrollment/assign`).
- Automatic runs fill in students who have no part. Mode `all` also corrects wrongly placed students.
- A student placed by hand is never moved by an automatic run. A manual move outside the roll range is allowed but flagged.
- Every placement is kept in the history (who, when, from, to, why).
- Promoting a cohort adds a new semester record per student and closes the old one. Nothing is deleted.
- Warnings: roll numbers no part covers, gaps between ranges, overlapping ranges, students placed in a part that no longer fits.
