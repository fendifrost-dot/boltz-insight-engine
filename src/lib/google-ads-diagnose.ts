/** Pure next-step copy for the Ads connection panel. No secrets. */

export function diagnoseNextStep(input: {
  errorClass: string;
  shapeWarnings: string[];
  configuredCustomerInAccessible: boolean | null;
  configuredLoginInAccessible: boolean | null;
  directAccessOk: boolean | null;
  hasLoginCustomerId: boolean;
}): string {
  const gemini = input.shapeWarnings.find((w) => w.includes("Gemini"));
  if (gemini) {
    return "GOOGLE_ADS_DEVELOPER_TOKEN is a Gemini/AI Studio key. Replace it with the 22-character token from ads.google.com → tool icon → API Center (manager account).";
  }
  const blockingShape = input.shapeWarnings.find((w) =>
    w.startsWith("GOOGLE_ADS_DEVELOPER_TOKEN"),
  );
  if (blockingShape && input.errorClass !== "user_permission_denied" && input.errorClass !== "ok") {
    return `A secret has the wrong shape. ${blockingShape}`;
  }

  switch (input.errorClass) {
    case "ok":
      return "Connection succeeded. No secret rotation needed.";
    case "oauth_refresh_failed":
      return "OAuth refresh failed. In an incognito window signed in only as info@boltzautoinc.com, remint GOOGLE_ADS_REFRESH_TOKEN with scope https://www.googleapis.com/auth/adwords, then update that one secret. Do not rotate the developer token unless OAuth still fails.";
    case "service_disabled":
      return "Enable the Google Ads API on the OAuth Cloud project: console.cloud.google.com → APIs & Services → Library → Google Ads API → Enable. Then reload /ads.";
    case "developer_token_not_approved":
      return "This developer token is Test Account Access only. In Google Ads → API Center apply for Explorer or Basic access, or point GOOGLE_ADS_CUSTOMER_ID at a test account. Explorer Access is enough for production reads.";
    case "developer_token_invalid":
      return "GOOGLE_ADS_DEVELOPER_TOKEN is not a valid Ads developer token. Copy the 22-character token from the manager account API Center — not an AI Studio / Gemini key.";
    case "developer_token_prohibited":
      return "This Cloud project is permanently paired to a different manager's developer token. Create a new Google Cloud project, enable Google Ads API, and remint OAuth client + refresh token there.";
    case "customer_not_enabled":
      return "GOOGLE_ADS_CUSTOMER_ID is a cancelled or not-yet-enabled Ads account. Use 166-162-6288 (BOLTZ AUTOMOTIVE). Ignore 861-385-4078.";
    case "sunset_404":
      return "API version path is sunset (HTML 404). Bump API_VERSION in src/server/google-ads/client.server.ts to a live version (v22–v25 as of Aug 2026).";
    case "user_permission_denied":
      return diagnosePermissionDenied(input);
    case "missing_secrets":
      return "Enter the five required Google Ads secrets in Lovable Cloud.";
    default:
      return "Google returned an unclassified error. Confirm the /ads detail line, then check OAuth refresh and Ads API enablement before rotating the developer token.";
  }
}

function diagnosePermissionDenied(input: {
  configuredCustomerInAccessible: boolean | null;
  configuredLoginInAccessible: boolean | null;
  directAccessOk: boolean | null;
  hasLoginCustomerId: boolean;
}): string {
  if (input.directAccessOk) {
    return "The OAuth user can read 166-162-6288 directly. Clear GOOGLE_ADS_LOGIN_CUSTOMER_ID in Lovable Cloud secrets — 509-490-7041 is not the manager path for this client.";
  }
  if (input.configuredCustomerInAccessible === false && input.configuredLoginInAccessible === true) {
    return "Refresh token can see manager 509-490-7041 but not client 166-162-6288. In ads.google.com as info@boltzautoinc.com: switch to 509-490-7041 → Accounts (or Sub-account settings) → confirm 166-162-6288 is linked. If it is not, link it there or set GOOGLE_ADS_LOGIN_CUSTOMER_ID to the MCC that actually lists 6288.";
  }
  if (input.configuredCustomerInAccessible === false && input.configuredLoginInAccessible === false) {
    return "Refresh token cannot see 166-162-6288 or 509-490-7041. Remint GOOGLE_ADS_REFRESH_TOKEN in incognito as info@boltzautoinc.com with scope https://www.googleapis.com/auth/adwords, then update only that secret.";
  }
  if (input.configuredCustomerInAccessible === true && input.hasLoginCustomerId) {
    return "OAuth user can see 166-162-6288, but login-customer-id 509-490-7041 is not a manager of that client. Either clear GOOGLE_ADS_LOGIN_CUSTOMER_ID or set it to the MCC that lists 6288 under Accounts.";
  }
  if (input.hasLoginCustomerId) {
    return "USER_PERMISSION_DENIED: login-customer-id 509-490-7041 does not grant access to 166-162-6288. In ads.google.com as info@boltzautoinc.com, switch to manager 509-490-7041 → Accounts → confirm 166-162-6288 is a linked sub-account. If you only have direct access to 6288, clear GOOGLE_ADS_LOGIN_CUSTOMER_ID.";
  }
  return "USER_PERMISSION_DENIED without a login-customer-id. The Google account that minted GOOGLE_ADS_REFRESH_TOKEN must have Standard/Admin on 166-162-6288. Remint that token as info@boltzautoinc.com with https://www.googleapis.com/auth/adwords.";
}
