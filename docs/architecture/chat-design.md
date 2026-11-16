# Notice chat design (built in Phase 3)

Decided with the project owner:

- One chat per target group (cohort, section or course). Members are the students of that group, plus its teacher(s).
- **Only the teacher and the moderators the teacher selects can post.** Everyone else reads, reacts and votes. Default is announcement-only.
- Students never create chats. Department and college admins can lock, mute or close chats in their own area.
- Every message shows the sender's name and a role badge. Students are shown by name only, never by roll or registration number.
- **Edit** (keeps "edited" mark and the history) and **Delete for everyone** (sender, the teacher, or an admin in scope). Deleting hides the message and keeps an audit record.
- **Reactions:** 👍 ❤️ 😂 😮 🙏 ✅. One emoji per person per message; tapping it again removes it.
- **Polls:** single or multiple choice, 2 to 10 options, one vote per person enforced by a database unique index, optional anonymous mode, optional close time. Results are shown after voting or when closed.
- Visibility is decided on the server from the member's cohort and course enrollment, never from ids sent by the client.
- First version refreshes every few seconds. Real-time (SSE or WebSocket) comes later.
