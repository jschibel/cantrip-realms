// Cantrip Realms' bridge (?realm; RealmBridge.cs, MainPage.Realm.cs). This page sits in a layer over the realm's
// overworld, which asks it for card screens - a duel, the spell table, a vendor - with window.postMessage, and hears
// back the same way when one closes. Messages are kept in a queue the client reads each tick, as Keys.js keeps keys.
// Only the page that framed this one is listened to and answered: the referrer's origin, or this page's own when it
// was opened directly.
//
// Playtest reports (realms/web/src/reports) are this file's alone, never the client's: framed, the page's console is
// kept (the last few hundred lines), F8 is passed up to the overworld, whose report box it opens, and a `snapshot`
// asked for is answered with the page's picture of itself - its canvases, read just after the client draws a frame, as
// the overworld cannot read another origin's pixels - and that console.
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

    const kept = [];
    const keep = (line) => {
        kept.push(new Date().toISOString().slice(11, 23) + " " + line);
        if (kept.length > 600) {
            kept.splice(0, kept.length - 600);
        }
    };
    const show = (value) => {
        if (typeof value === "string") {
            return value;
        }
        if (value instanceof Error) {
            return value.stack || (value.name + ": " + value.message);
        }
        try {
            return JSON.stringify(value) ?? String(value);
        } catch (e) {
            return String(value);
        }
    };

    if (framed) {
        for (const level of ["log", "info", "warn", "error", "debug"]) {
            const original = console[level].bind(console);
            console[level] = (...args) => {
                keep(level + " " + args.map(show).join(" "));
                original(...args);
            };
        }
        window.addEventListener("error", (e) => keep("uncaught " + (e.error ? show(e.error) : e.message)));
        window.addEventListener("unhandledrejection", (e) => keep("unhandled rejection " + show(e.reason)));

        // The client draws with WebGL only when something changes, and a WebGL canvas keeps no frame once the browser has
        // shown it: framed in the realm, its contexts keep their drawing buffer, so the picture can be read whenever a
        // report asks. This runs before the client makes its context (the scripts load before the runtime starts).
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, attributes) {
            if (type === "webgl" || type === "webgl2") {
                attributes = Object.assign({}, attributes, { preserveDrawingBuffer: true });
            }
            return getContext.call(this, type, attributes);
        };

        // F8 files a playtest report from anywhere in the game; while a card screen is open its keys are this page's.
        window.addEventListener("keydown", (e) => {
            if (e.key === "F8" && !e.repeat) {
                e.preventDefault();
                e.stopPropagation();
                window.parent.postMessage({ realm: 1, op: "report" }, origin);
            }
        }, true);
    }

    // The page's canvases drawn as they stand, one picture the size of the window; null when every pixel is empty (a
    // WebGL canvas read once its frame was shown).
    const picture = () => {
        const ratio = window.devicePixelRatio || 1;
        const out = document.createElement("canvas");
        out.width = Math.max(1, Math.round(window.innerWidth * ratio));
        out.height = Math.max(1, Math.round(window.innerHeight * ratio));
        const g = out.getContext("2d");
        let drawn = false;
        for (const canvas of document.querySelectorAll("canvas")) {
            const rect = canvas.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1 || canvas.width < 1 || canvas.height < 1) {
                continue;
            }
            try {
                g.drawImage(canvas, rect.left * ratio, rect.top * ratio, rect.width * ratio, rect.height * ratio);
                drawn = true;
            } catch (e) {
                // A canvas that cannot be read is left out.
            }
        }
        if (!drawn) {
            return null;
        }
        const pixels = g.getImageData(0, 0, out.width, out.height).data;
        const step = Math.max(4, Math.floor(pixels.length / 4 / 4096) * 4);
        for (let i = 3; i < pixels.length; i += step) {
            if (pixels[i] !== 0) {
                return out.toDataURL("image/png");
            }
        }
        return null;
    };

    // Read in a frame's callback, after the client's own of that frame has drawn and before the browser shows it; tried
    // over a few frames, as an idle client draws none.
    const snapshot = (id, wanted) => {
        let tries = 0;
        const attempt = () => {
            const image = wanted ? picture() : null;
            if (wanted && image === null && ++tries < 4) {
                requestAnimationFrame(attempt);
                return;
            }
            window.parent.postMessage({ realm: 1, op: "snapshot", id, image, log: kept.join("\n") }, origin);
        };
        requestAnimationFrame(attempt);
    };

    window.addEventListener("message", (e) => {
        if (!framed || e.source !== window.parent || e.origin !== origin) {
            return;
        }

        const message = e.data;
        if (message && message.realm === 1 && message.op === "snapshot") {
            snapshot(message.id, !!(message.args && message.args.picture));
            return;
        }

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
