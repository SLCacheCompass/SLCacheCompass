// Cache Compass in-world L$ vendor
// Put this script in the ROOT prim of the vendor.
// Keep the vendor/script no-mod for anyone except the Cache Compass owner.

string ENDPOINT_URL = "PASTE_LINDEN_PURCHASE_FUNCTION_URL_HERE";
string KIOSK_SHARED_SECRET = "PASTE_KIOSK_SHARED_SECRET_HERE";

integer PRICE_3 = 0;
integer PRICE_5 = 0;
integer PRICE_10 = 0;
integer READY = FALSE;
integer MAX_RETRIES = 3;
integer NORMAL_MAX_AVATARS = 30;

key CONFIG_REQUEST = NULL_KEY;

// Stride: request id, payer uuid, nonce, tier, amount, payer name, retry count
list PENDING = [];
integer PENDING_STRIDE = 7;

hidePayments(string reason)
{
    READY = FALSE;
    llSetPayPrice(PAY_HIDE, [PAY_HIDE, PAY_HIDE, PAY_HIDE, PAY_HIDE]);
    llSetText("CACHE COMPASS\n" + reason, <0.80, 0.68, 0.43>, 1.0);
}

integer validConfig()
{
    return (
        llSubStringIndex(ENDPOINT_URL, "https://") == 0 &&
        ENDPOINT_URL != "PASTE_LINDEN_PURCHASE_FUNCTION_URL_HERE" &&
        KIOSK_SHARED_SECRET != "" &&
        KIOSK_SHARED_SECRET != "PASTE_KIOSK_SHARED_SECRET_HERE"
    );
}

showPrices()
{
    llSetPayPrice(PAY_HIDE, [PRICE_3, PRICE_5, PRICE_10, PAY_HIDE]);
    llSetText(
        "CACHE COMPASS\n" +
        "3 avatars  L$" + (string)PRICE_3 + "\n" +
        "5 avatars  L$" + (string)PRICE_5 + "\n" +
        "10 avatars  L$" + (string)PRICE_10,
        <0.80, 0.68, 0.43>,
        1.0
    );
    READY = TRUE;
}

loadConfig()
{
    hidePayments("Connecting...");

    if (!validConfig())
    {
        hidePayments("Owner setup required");
        llOwnerSay("Cache Compass vendor is not configured yet. Add ENDPOINT_URL and KIOSK_SHARED_SECRET to the script.");
        return;
    }

    CONFIG_REQUEST = llHTTPRequest(
        ENDPOINT_URL,
        [
            HTTP_METHOD, "GET",
            HTTP_CUSTOM_HEADER, "x-cache-compass-kiosk-secret", KIOSK_SHARED_SECRET
        ],
        ""
    );
}

integer tierForAmount(integer amount)
{
    if (amount == PRICE_3) return 3;
    if (amount == PRICE_5) return 5;
    if (amount == PRICE_10) return 10;
    return 0;
}

integer findPending(key requestId)
{
    integer i;
    integer count = llGetListLength(PENDING);
    for (i = 0; i < count; i += PENDING_STRIDE)
    {
        if (llList2Key(PENDING, i) == requestId) return i;
    }
    return -1;
}

key sendPurchase(key payer, key nonce, integer tier, integer amount, string payerName)
{
    string body = llList2Json(JSON_OBJECT, [
        "tier", tier,
        "amount", amount,
        "payerUuid", (string)payer,
        "payerName", payerName,
        "nonce", (string)nonce
    ]);

    return llHTTPRequest(
        ENDPOINT_URL,
        [
            HTTP_METHOD, "POST",
            HTTP_MIMETYPE, "application/json",
            HTTP_CUSTOM_HEADER, "x-cache-compass-kiosk-secret", KIOSK_SHARED_SECRET
        ],
        body
    );
}

beginPurchase(key payer, integer amount)
{
    integer tier = tierForAmount(amount);
    if (!tier)
    {
        llInstantMessage(payer, "Cache Compass could not match that payment to a license tier. Please contact support and do not pay again.");
        llOwnerSay("WARNING: unmatched Cache Compass payment of L$" + (string)amount + " from " + (string)payer + ".");
        return;
    }

    key nonce = llGenerateKey();
    string payerName = llKey2Name(payer);
    key requestId = sendPurchase(payer, nonce, tier, amount, payerName);

    PENDING += [requestId, payer, nonce, tier, amount, payerName, 0];
    llInstantMessage(payer, "Cache Compass received your L$ payment. Processing your " + (string)tier + "-avatar purchase now...");
}

retryPurchase(integer index)
{
    key payer = llList2Key(PENDING, index + 1);
    key nonce = llList2Key(PENDING, index + 2);
    integer tier = llList2Integer(PENDING, index + 3);
    integer amount = llList2Integer(PENDING, index + 4);
    string payerName = llList2String(PENDING, index + 5);
    integer retries = llList2Integer(PENDING, index + 6) + 1;

    llSleep(2.0);
    key newRequest = sendPurchase(payer, nonce, tier, amount, payerName);
    PENDING = llListReplaceList(PENDING, [newRequest, payer, nonce, tier, amount, payerName, retries], index, index + PENDING_STRIDE - 1);
}

default
{
    state_entry()
    {
        if (llGetLinkNumber() > 1)
        {
            hidePayments("SCRIPT MUST BE IN ROOT PRIM");
            llOwnerSay("Move CacheCompassVendor.lsl into the root prim of the vendor object.");
            return;
        }
        loadConfig();
    }

    on_rez(integer startParam) { llResetScript(); }

    changed(integer change)
    {
        if (change & (CHANGED_OWNER | CHANGED_LINK)) llResetScript();
    }

    touch_start(integer total)
    {
        key toucher = llDetectedKey(0);
        if (toucher == llGetOwner())
        {
            string statusText = "NOT READY";
            if (READY) statusText = "READY";
            llOwnerSay("Cache Compass vendor status: " + statusText + " | Owner UUID: " + (string)llGetOwner() + " | Object UUID: " + (string)llGetKey());
            if (!READY) loadConfig();
        }
        else if (READY)
        {
            llInstantMessage(
                toucher,
                "Cache Compass prices: 3 avatars L$" + (string)PRICE_3 +
                ", 5 avatars L$" + (string)PRICE_5 +
                ", 10 avatars L$" + (string)PRICE_10 +
                ". Existing customers can add capacity up to " + (string)NORMAL_MAX_AVATARS + " total avatars. Right-click this kiosk and choose Pay."
            );
        }
    }

    money(key payer, integer amount)
    {
        if (!READY)
        {
            llInstantMessage(payer, "Cache Compass is temporarily unavailable. Your payment was received; please contact support and do not pay again.");
            llOwnerSay("WARNING: payment arrived while vendor was not ready. Payer " + (string)payer + ", amount L$" + (string)amount + ".");
            return;
        }
        beginPurchase(payer, amount);
    }

    http_response(key requestId, integer status, list metadata, string body)
    {
        if (requestId == CONFIG_REQUEST)
        {
            CONFIG_REQUEST = NULL_KEY;
            if (status != 200)
            {
                hidePayments("Temporarily unavailable");
                llOwnerSay("Cache Compass vendor config request failed. HTTP " + (string)status + ": " + body);
                return;
            }

            PRICE_3 = (integer)llJsonGetValue(body, ["tiers", 0, "price"]);
            PRICE_5 = (integer)llJsonGetValue(body, ["tiers", 1, "price"]);
            PRICE_10 = (integer)llJsonGetValue(body, ["tiers", 2, "price"]);
            string maxText = llJsonGetValue(body, ["normalMaxAvatars"]);
            if (maxText != JSON_INVALID && (integer)maxText > 0) NORMAL_MAX_AVATARS = (integer)maxText;

            if (PRICE_3 <= 0 || PRICE_5 <= 0 || PRICE_10 <= 0)
            {
                hidePayments("Price configuration error");
                llOwnerSay("Cache Compass vendor received invalid prices from the server: " + body);
                return;
            }

            showPrices();
            llOwnerSay("Cache Compass vendor is online and ready for L$ payments.");
            return;
        }

        integer index = findPending(requestId);
        if (index < 0) return;

        key payer = llList2Key(PENDING, index + 1);
        key nonce = llList2Key(PENDING, index + 2);
        integer tier = llList2Integer(PENDING, index + 3);
        integer retries = llList2Integer(PENDING, index + 6);

        if (status == 200 || status == 201 || status == 202)
        {
            string purchased = llJsonGetValue(body, ["purchased"]);
            if (purchased == JSON_TRUE)
            {
                string pendingReview = llJsonGetValue(body, ["pendingOwnerReview"]);
                string capacityAdded = llJsonGetValue(body, ["capacityAdded"]);
                string totalCapacity = llJsonGetValue(body, ["maxAvatars"]);
                string requestedCapacity = llJsonGetValue(body, ["requestedCapacity"]);
                string remaining = llJsonGetValue(body, ["remainingSlots"]);
                string licenseKey = llJsonGetValue(body, ["licenseKey"]);

                if (pendingReview == JSON_TRUE)
                {
                    llInstantMessage(
                        payer,
                        "Cache Compass received your payment, but this purchase would place the account above the normal " +
                        (string)NORMAL_MAX_AVATARS + "-avatar limit. It has been held for owner review. DO NOT PAY AGAIN. " +
                        "Current capacity: " + totalCapacity + ". Requested capacity: " + requestedCapacity + ". " +
                        "If you need help, contact support@slcachecompass.com and include receipt code " + (string)nonce + "."
                    );
                    llOwnerSay("CACHE COMPASS OWNER REVIEW REQUIRED: payer " + (string)payer + ", requested capacity " + requestedCapacity + ", receipt " + (string)nonce + ".");
                    PENDING = llDeleteSubList(PENDING, index, index + PENDING_STRIDE - 1);
                    return;
                }

                if (capacityAdded == JSON_TRUE)
                {
                    llInstantMessage(
                        payer,
                        "Cache Compass capacity added successfully. Your account now supports " + totalCapacity +
                        " avatars. Remaining open slots: " + remaining + ". No new license key is required."
                    );
                    PENDING = llDeleteSubList(PENDING, index, index + PENDING_STRIDE - 1);
                    return;
                }

                if (licenseKey != JSON_INVALID && licenseKey != "")
                {
                    llInstantMessage(
                        payer,
                        "Cache Compass purchase complete.\n" +
                        "License: " + licenseKey + "\n" +
                        "Tier: " + (string)tier + " avatars\n" +
                        "Your purchasing avatar is registered automatically. Remaining slots: " + remaining + ".\n" +
                        "Keep this license key private. Download/support: https://slcachecompass.com/"
                    );
                    PENDING = llDeleteSubList(PENDING, index, index + PENDING_STRIDE - 1);
                    return;
                }
            }
        }

        // Retry with the SAME nonce so a lost HTTP response cannot create a duplicate purchase or add capacity twice.
        if ((status == 0 || status == 408 || status == 429 || status >= 500) && retries < MAX_RETRIES)
        {
            retryPurchase(index);
            return;
        }

        llInstantMessage(
            payer,
            "Your Cache Compass payment was received, but automatic processing did not finish. DO NOT PAY AGAIN. " +
            "Contact support@slcachecompass.com and include receipt code " + (string)nonce + "."
        );
        llOwnerSay(
            "CACHE COMPASS PURCHASE NEEDS ATTENTION: payer " + (string)payer +
            ", tier " + (string)tier + ", receipt " + (string)nonce +
            ", HTTP " + (string)status + ", response: " + body
        );
        PENDING = llDeleteSubList(PENDING, index, index + PENDING_STRIDE - 1);
    }
}
