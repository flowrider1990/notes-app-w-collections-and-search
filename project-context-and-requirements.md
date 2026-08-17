Sprint 2: Final Project.
Project Deadline 21st of August 2026

### Topics

* Email/password sign-in and sign-out with Supabase Auth (test accounts created in the Supabase dashboard)
* Server-side session handling, so sign-in is verified by the server rather than trusting the browser
* Route protection: redirecting unauthenticated users to sign-in, with the check done on the server, never trusting the browser session alone
* Note scoping: filtering rows by the signed-in user's ID so each account sees only its own data
* Reviewing the auth diff for common mistakes before merging
* Sprint 2 workflow: custom skill, slash command on the PR diff, Context7 for Supabase API prompts, fresh-session diff review

###The exact task requirements are as follows
1. Email/password auth is in place. The app has a sign-in page and a sign-out button or link accessible once signed in. For the core project, test accounts are created by hand in the Supabase dashboard's Authentication tab — a self-service sign-up page is an optional task.



2\. Routes are protected. Any route in the notes workspace redirects unauthenticated visitors to the sign-in page. The signed-in check is done on the server before the page loads, not just hidden in the browser. Run the auth-flaw scan from the authentication lesson to confirm this; if it flags a check that only trusts the browser session, fix it before merging.



3\. Notes are persisted in Supabase and scoped to the signed-in user. A user sees only the notes they created — not notes belonging to other accounts. localStorage and sessionStorage are not acceptable persistence layers for this project — no note data may live in either, under any circumstances. Before settling on a persistence approach, consult Claude Code on the best option given the existing stack, evaluate its recommendation, and record the chosen approach (and why) in REFLECTION.md.



4\. Full CRUD works and persists across reloads. A user can create a note, edit it, and delete it. All changes are stored in Supabase and are still there after a page reload.



5\. The app runs locally and is verified locally. Start it with npm run dev and confirm every feature works at http://localhost:3000. Deployment to a live URL is not required this sprint — that happens next sprint.



6\. The local verification checklist passes:

&#x20;- Create a test account in the Supabase dashboard's Authentication tab, then sign in and land on the workspace

&#x20;- Create a note, reload the page — the note is still there

&#x20;- Sign out — the workspace is no longer accessible; going to it directly redirects to sign-in

&#x20;- Create a second account in the dashboard, sign in as that account, and confirm it sees none of the first account's notes


7. CLAUDE.md is updated to reflect the full stack and the authentication rules (let Supabase handle all sign-in and session handling, verify the session on the server before any protected page loads, workspace routes require a signed-in user, no custom password handling, no service-role key in client-accessible env vars).

### Optional tasks

Complete at least one optional task via a dedicated feature branch and pull request.



\#Easy

* Loading states. Show a skeleton or spinner while notes are being fetched from Supabase, so the page never flashes a blank list.
* Minimalist design. Ask the agent to give the app a clean, modern look: a restrained colour palette, generous spacing, clear typography, simple hover states, and a tidy header. Describe the feel you want and let the agent handle the styling.

\#Medium

* Server-side search. Add a search box that filters notes by querying Supabase directly, so only matching rows are returned from the database rather than filtering in the browser.
* Tags. Add a tags column to the notes table and a tag filter in the UI so a user can view only notes with a given tag.
* Export to Markdown. Add a button on each note page that downloads the note content as a .md file.
* Password-reset email flow. Add a "Forgot your password?" link on the sign-in page that sends a reset email via Supabase Auth. Verify the flow locally using the email Supabase sends to the test inbox.
* Self-service sign-up page. Add a sign-up page so new users can register themselves with an email address and password, rather than being created in the Supabase dashboard. Handle the confirmation-email step that Supabase triggers on registration. After a successful sign-up and email confirmation, the user should be able to sign in and land on the workspace as normal.

\# Hard

* Image uploads. Use Supabase Storage to host uploaded images, and let a user attach an image to a note from the editor. The image must be stored in a Supabase Storage bucket — not embedded as base64 in the database — and must display on the note when the page is reopened.
* GitHub social login. Add GitHub as a sign-in option alongside email/password. This requires creating an OAuth app on GitHub and configuring the credentials in the Supabase dashboard. Verify that both sign-in methods land the user on the workspace and that notes are correctly scoped to each account.



\### Evaluation criteria

1. The project has a clear purpose (a private, per-user notes app) and a verifiable success outcome: notes are persisted in Supabase, scoped to the signed-in user, and the workspace is inaccessible to unauthenticated visitors. Weight: 1



2\. The local verification checklist passes end-to-end: sign in (using a test account created in the Supabase dashboard), create a note, reload — still there, sign out, confirm the workspace redirects to sign-in, sign in as a second dashboard account and confirm it sees none of the first account's notes. All task requirements pass locally. Weight: 2



3\. Authentication works and is built safely. A signed-in user reaches the workspace; a signed-out one is sent to the sign-in page, with that check done on the server before the page loads, not just in the browser. The app uses Supabase Auth rather than custom password handling and no note data is held in localStorage or sessionStorage. Weight: 2



4\. The learner can demonstrate that they understand their own data. They can open the Supabase dashboard Authentication tab and show the test users registered during verification. They can open the Table Editor (or run a query in the SQL Editor) and show that the note rows include a user ID column that matches the signed-in user's ID. REFLECTION.md (or the review call) explains what each relevant column means and describes how a new row is created when a note is added. Weight: 2



5\. README.md covers what the app does, how to run it locally (including which environment variables to set and where to find the values), a screenshot of the local app, and which optional task was chosen and delivered through its own feature branch and merged pull request. CLAUDE.md reflects the full stack and the auth rules. The official Supabase Agent Skills are installed in the repo (with npx skills add supabase/agent-skills) and were used to guide the agent on the project's Supabase patterns. At least one merged pull request shows a meaningful diff with a fresh-session review noted. Weight: 1

Bonus points:

* A second optional task completed and explained in REFLECTION.md.
* Evidence of a Supabase SQL editor query confirming that note rows are correctly scoped to distinct user IDs (for example, a screenshot showing rows from account 1 and rows from account 2 filtered by their respective user IDs).



\### Documention requirement
- CLAUDE.md at the repo root, updated to reflect the full stack and the authentication rules the agent was asked to follow.

* Supabase Agent Skills installed in the repo with npx skills add supabase/agent-skills and used during the build to guide the agent on the project's Supabase patterns.
* At least one merged pull request with a visible diff and a short description of what changed.
* README.md covering: what the app does, how to run it locally (including which environment variables to set and where to find the values), a screenshot of the local app, and which optional task you chose.
* REFLECTION.md (300–500 words) addressing three issues. IMPORTANT: ask me, the dev, to fill them in manually before the final commit



