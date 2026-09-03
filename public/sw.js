// HAIL service worker — Web Push + بقاء الكاشير عاملاً بلا إنترنت.
//
// كان بلا تخزين إطلاقاً، فانقطاع الشبكة يوقف المحل: الشاشة لا تفتح أصلاً.
// الآن تُخزَّن آخر نسخة ناجحة من كل شاشة، فتُفتح من الذاكرة حين تنقطع الشبكة.
//
// الشبكة أولاً دائماً، والذاكرة احتياط — لا العكس. الكاشير يجب أن يرى أحدث
// الأسعار والطلبات ما دامت الشبكة موجودة؛ عرض نسخة قديمة وهي متاحة أسوأ من
// انتظار ثانية.
const CACHE = "hail-v2";

// الشاشات التي يجب أن تفتح بلا شبكة. غيرها يمرّ إلى الشبكة كما هو.
const OFFLINE_PAGES = ["/cashier", "/orders", "/menu"];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      // إصدار جديد ← تُمسح ذاكرة الإصدار القديم، وإلا بقيت شاشة قديمة تعمل بعد التحديث
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  ),
);

const isPage = (req) => req.mode === "navigate";
const isAsset = (url) => url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // الطلبات والدفع تمرّ للشبكة، ولها طابور خاص في الصفحة
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // ملفات البناء لا تتغيّر (اسمها يحمل بصمتها) — الذاكرة أولاً
  if (isAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  if (!isPage(request)) return;
  if (!OFFLINE_PAGES.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"))) return;

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(request);
        if (res.ok) {
          const c = await caches.open(CACHE);
          c.put(request, res.clone());
        }
        return res;
      } catch {
        const hit = await caches.match(request);
        if (hit) return hit;
        return new Response(
          `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
           <body style="font-family:system-ui;text-align:center;padding:3rem;background:#f6f4ee;color:#22301a">
           <h1 style="color:#556f42">لا يوجد اتصال</h1>
           <p>افتح هذه الشاشة مرة واحدة والإنترنت موجود، فتبقى تعمل بعدها بلا شبكة.</p>
           </body>`,
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* non-JSON payload */
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "مخبز ومقهى هيل", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      dir: "rtl",
      lang: "ar",
      tag: data.tag,
      vibrate: [200, 100, 200],
      data: { url: data.url || "/orders" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/orders";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
