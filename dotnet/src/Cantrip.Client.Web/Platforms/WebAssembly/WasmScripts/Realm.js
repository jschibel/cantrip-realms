// Cantrip Realms' bridge (?realm; RealmBridge.cs, MainPage.Realm.cs). This page sits in a layer over the realm's
// overworld, which asks it for card screens - a duel, the spell table, a vendor - with window.postMessage, and hears
// back the same way when one closes. Messages are kept in a queue the client reads each tick, as Keys.js keeps keys.
// Only the page that framed this one is listened to and answered: the referrer's origin, or this page's own when it
// was opened directly.
(function () {
    const queue = [];
    const framed = window.parent !== window;
    let origin = window.location.origin;
    try {
        if (document.referrer) {
            origin = new URL(document.referrer).origin;
        }
    } catch (e) {
        // An unreadable referrer leaves this page's own origin.
    }

    window.addEventListener("message", (e) => {
        if (!framed || e.source !== window.parent || e.origin !== origin) {
            return;
        }

        const message = e.data;
        if (message && message.realm === 1 && typeof message.op === "string") {
            queue.push(JSON.stringify(message));
        }
    });

    globalThis.cantripRealmTake = () => {
        const taken = queue.join("\n");
        queue.length = 0;
        return taken;
    };

    globalThis.cantripRealmPost = (json) => {
        if (!framed) {
            return;
        }

        const message = JSON.parse(json);
        message.realm = 1;
        window.parent.postMessage(message, origin);
    };
})();
