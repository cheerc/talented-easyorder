# Firebase Sync Verification Matrix

| Scenario | Expected Result |
|---|---|
| Google sign-in with `cheerc@talented.com.tw` and active operator doc | App opens POS. |
| Google sign-in with non-talented email | App blocks before reading Firestore data. |
| Active operator creates online order | Transaction doc created once, student balance updates once, sync badge returns green. |
| Same transaction ID retried | Existing transaction doc is treated as duplicate, no second balance update occurs. |
| Two online devices update same student | Firestore transaction retries or one client receives revision conflict; no partial write. |
| Offline payment while app is already loaded | Transaction appears locally as pending and sync badge is red/yellow until ack. |
| Offline closeout | Close attempt is saved, parent summary is promoted after reconnect if no competing attempt exists. |
| Two close attempts for same business date disagree | Closeout conflict UI blocks final close until operator resolves. |
| Student disabled after historical transaction | Historical transaction still displays student snapshot. |
| Direct student balance update without matching transaction | Firestore emulator rules reject the write. |
| Non-whitelisted or wrong-domain login | App signs the user out and displays the authorization failure. |
| Vercel production response | Includes CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and Permissions-Policy headers. |
| Vercel production env missing Firebase key | Build or runtime config fails fast with explicit missing env var message. |
