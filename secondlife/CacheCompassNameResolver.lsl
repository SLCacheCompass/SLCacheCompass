// Cache Compass avatar-name resolver worker.
// Rez one owner-only object on the production grid and place this script inside it.
// Put the same limited KIOSK_SHARED_SECRET used by the vendor in SHARED_SECRET.
// Never put LICENSE_ISSUER_SECRET or a Supabase service-role key in LSL.

string ENDPOINT = "https://glamoujtjfczrpkrpbmp.supabase.co/functions/v1/avatar-name-resolver";
string SHARED_SECRET = "PASTE_KIOSK_SHARED_SECRET_HERE";
float POLL_SECONDS = 5.0;
float LOOKUP_TIMEOUT = 12.0;

key currentAvatar = NULL_KEY;
key legacyQuery = NULL_KEY;
key displayQuery = NULL_KEY;
string legacyName = "";
string displayName = "";
float lookupStarted = 0.0;
integer posting = FALSE;

list requestHeaders(string method)
{
    return [
        HTTP_METHOD, method,
        HTTP_MIMETYPE, "application/json",
        HTTP_CUSTOM_HEADER, "x-cache-compass-kiosk-secret", SHARED_SECRET
    ];
}

poll()
{
    if (currentAvatar != NULL_KEY || posting) return;
    llHTTPRequest(ENDPOINT + "?worker=next", requestHeaders("GET"), "");
}

beginLookup(key avatarId)
{
    currentAvatar = avatarId;
    legacyName = "";
    displayName = "";
    posting = FALSE;
    lookupStarted = llGetTime();
    legacyQuery = llRequestAgentData(avatarId, DATA_NAME);
    displayQuery = llRequestDisplayName(avatarId);
}

postResult()
{
    if (currentAvatar == NULL_KEY || posting) return;
    posting = TRUE;
    string body = llList2Json(JSON_OBJECT, [
        "avatarUuid", (string)currentAvatar,
        "legacyName", legacyName,
        "displayName", displayName
    ]);
    llHTTPRequest(ENDPOINT + "?worker=result", requestHeaders("POST"), body);
}

finishIfReady()
{
    if (legacyName != "" && displayName != "") postResult();
}

resetLookup()
{
    currentAvatar = NULL_KEY;
    legacyQuery = NULL_KEY;
    displayQuery = NULL_KEY;
    legacyName = "";
    displayName = "";
    posting = FALSE;
    lookupStarted = 0.0;
}

default
{
    state_entry()
    {
        if (SHARED_SECRET == "PASTE_KIOSK_SHARED_SECRET_HERE" || SHARED_SECRET == "")
        {
            llOwnerSay("Cache Compass name resolver is not configured. Add the kiosk shared secret to SHARED_SECRET.");
            return;
        }
        llSetTimerEvent(POLL_SECONDS);
        llOwnerSay("Cache Compass name resolver ready.");
        poll();
    }

    on_rez(integer start)
    {
        llResetScript();
    }

    timer()
    {
        if (currentAvatar != NULL_KEY && !posting && lookupStarted > 0.0 && (llGetTime() - lookupStarted) >= LOOKUP_TIMEOUT)
        {
            postResult();
            return;
        }
        poll();
    }

    dataserver(key queryId, string data)
    {
        if (queryId == legacyQuery)
        {
            legacyName = llStringTrim(data, STRING_TRIM);
            legacyQuery = NULL_KEY;
            finishIfReady();
            return;
        }
        if (queryId == displayQuery)
        {
            displayName = llStringTrim(data, STRING_TRIM);
            displayQuery = NULL_KEY;
            finishIfReady();
        }
    }

    http_response(key requestId, integer status, list metadata, string body)
    {
        if (posting)
        {
            if (status >= 200 && status < 300)
            {
                resetLookup();
                poll();
            }
            else
            {
                llOwnerSay("Name resolver result POST failed: HTTP " + (string)status);
                resetLookup();
            }
            return;
        }

        if (status < 200 || status >= 300)
        {
            llOwnerSay("Name resolver poll failed: HTTP " + (string)status);
            return;
        }

        string pending = llJsonGetValue(body, ["pending"]);
        if (pending != JSON_TRUE) return;

        string uuidText = llJsonGetValue(body, ["avatarUuid"]);
        key avatarId = (key)uuidText;
        if (avatarId == NULL_KEY) return;
        beginLookup(avatarId);
    }
}
