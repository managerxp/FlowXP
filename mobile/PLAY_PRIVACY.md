# Privacy policy and Data Safety: what matches, what is missing

Checked 2026-10-09 against the policy text on the website (`frontend/src/site/Legal.jsx`, supplied by the owner, so I have **not edited it**) and the app as built. The Data Safety answers themselves are in `STORE.md`. This file lists where the policy and the app do not yet line up. Someone with authority over the policy (and ideally a lawyer) needs to decide the wording.

## Covered by the policy today
- Account details, customers' and suppliers' details a business enters, and purchase history (sections on information collected).
- Crash information (section 20), approximate location (section 21), retention and backups (section 33).
- "AI service providers" and "Backup providers" are listed among those who may receive information.

## Gaps to close before you submit
1. **Flow AI is not explained.** The policy only lists "AI service providers" as a kind of recipient. The app sends a person's question plus figures from the business's own records (sales, stock, dues, customer names where they appear in a question) from FlowXP's server to the AI provider. Add a plain sentence saying that, that the provider acts for FlowXP and may not use it for its own purposes, and that a business can switch Flow AI off. *Suggested text:* "When you use Flow AI, your question and the business figures needed to answer it are sent to our AI service provider to write the reply. The provider processes them for us and may not use them for advertising or to train its own models."  (Confirm the "train" part against the provider's actual terms before using it.)
2. **Precise location for field sales is not described.** Section 21 says FlowXP "does not intend to continuously track precise personal location unless a feature requires it". The app does record the phone's location, once, when a field-sales person records a visit, only while the app is open and only if the business switched on "record where visits happen". Say so in those words, and say it is stored with the visit and visible to the business.
3. **Account and data deletion: built 2026-10-09.** Web page `https://flowxp.in/delete-account` (public, for the Play form), a Security-page "Delete my account" for signed-in people (password and, if used, a two-step code), a request form for people who cannot sign in, a Deletions queue in the super-admin console, and a Settings link in the app. The policy text should still mention it (item 6's wording can cover both). Backups keep data for the period already in the policy (section 33).
4. **Privacy page address.** `STORE.md` assumes `https://flowxp.in/privacy`. It must be live, public, not behind a login, and name the company that publishes the app (ManagerXP Private Limited, as the policy does).
5. **Play form consistency.** Every "collected" item in `STORE.md` must also appear in the policy; item 2 (location) and Flow AI are the two that do not yet.

6. **Phone alerts (added 2026-10-09).** The app now stores the phone's notification address on FlowXP's servers with the person's account, and sends alerts through Expo's push service and Google's Firebase Cloud Messaging. The policy should say: what the address is, that alerts go through those two providers, that it is removed on sign-out or when alerts are switched off, and that alerts contain only business information (an order, a table, a stock item), never customers' phone numbers. In Play's Data Safety form this is "Device or other IDs", collected, linked to the person, for app functionality, not shared for ads. The row is already in `STORE.md`.

## Not something I can do
Publishing the policy, submitting the form, and the Play Console declarations (content rating, target audience, ads: none) are yours.
