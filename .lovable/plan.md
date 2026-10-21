# Meta token report (read-only, 2026-10-21 00:28 UTC) — nothing changed

1. META_PAGE_ID 433712466491882 · META_APP_ID 2854559924918431 · META_GRAPH_API_VERSION v26.0 · META_PAGE_ACCESS_TOKEN length 203.

2. Stored token: is_valid true, type SYSTEM_USER, user_id 122113617513492333, profile_id none, app "Boltz Insight Engine", expires_at 0 (never), data_access_expires_at 0 (never), issued_at 1790367674 = 2026-09-25T20:21:14Z. Scopes: pages_show_list, ads_management, business_management, leads_retrieval, pages_read_engagement, pages_manage_metadata, pages_manage_ads, public_profile. Every granular scope has target_ids = none (applies to all granted assets). No error.
   - Derived token for 433712466491882 (redacted, 205 chars): is_valid true, type PAGE, user_id 122113617513492333, profile_id 433712466491882, same scopes, never expires, issued_at 2026-10-21T00:28:31Z (minted by this check), no error.
   - Derive for 101035642014297: HTTP 400, code 10, no subcode — "requires the 'pages_read_engagement' permission or Page Public Content/Metadata Access".

3. /me: id 122113617513492333, name "boltzinsightengine". Not Frost Cleveland (it is the system user).

4. /me/accounts: one Page only — 433712466491882 "Boltz Automotive", tasks CREATE_CONTENT, MODERATE, MESSAGING, ADVERTISE, ANALYZE, MANAGE_LEADS, MANAGE. Page 101035642014297 is not assigned to this system user.

5. Calls made with the stored (system-user) token:
   - /433712466491882?fields=id,name,tasks — HTTP 400, code 100: "nonexisting field (tasks)" (tasks is not a Page field).
   - /433712466491882/leadgen_forms — HTTP 400, code 190: "must be called with a Page Access Token".
   - /433712466491882/subscribed_apps — HTTP 400, code 190, subcode 2069032: "Invalid OAuth 2.0 Access Token".
   - /101035642014297 — HTTP 400, code 10: pages_read_engagement / Page Public Access required.
   - /101035642014297/leadgen_forms — HTTP 400, code 10: "User has insufficient privileges on the page."
   - /101035642014297/subscribed_apps — HTTP 403, code 210: "A page access token is required."
   (The app itself uses the derived Page token for 433712466491882, which is why diagnose/forms work there.)

6. Stored token issued_at (2026-09-25T20:21:14Z) is before 2026-10-21T00:15:00Z: yes. Any newer token added around 00:15 is not what the server is reading.

## Takeaway
Page 101035642014297 has to be assigned to the system user in Business Settings (with Leads access), and the token regenerated, before it can work. No action taken.
