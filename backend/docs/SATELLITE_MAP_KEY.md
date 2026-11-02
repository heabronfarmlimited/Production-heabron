# Satellite imagery — which key to get, and where to put it

Short version: **Google Cloud → enable “Maps Static API” → create an API key →
restrict it to that one API → put it in the BACKEND env as
`MAP_STATIC_API_KEY`, with `MAP_PROVIDER=google`.**

Nothing goes in the mobile app. Read the next section before you create the
key, because *which* Google API you enable matters and the wrong one will not
work.

---

## 1. Which API, exactly

Enable **Maps Static API**. Not “Maps SDK for Android”, not “Maps SDK for
iOS”, not “Maps JavaScript API”.

| API | Works here? | Why |
|---|---|---|
| **Maps Static API** | **Yes — this is the one** | Returns a satellite PNG for a centre point, with the farm boundary drawn on it. One HTTP GET, no native code. |
| Maps SDK for Android / iOS | No | Native SDKs. They require a new app build and a key compiled into the native manifest. |
| Maps JavaScript API | No | For web pages. |
| Map Tiles API | No | Different product, 3D tiles, much more expensive. |

In the Google Cloud console:

1. Create (or pick) a project, and make sure **billing is enabled** on it.
   Static Maps returns an error, not an image, on a project without billing —
   even inside the free monthly credit.
2. **APIs & Services → Library → “Maps Static API” → Enable.**
3. **APIs & Services → Credentials → Create credentials → API key.**
4. Open the new key and set **API restrictions → Restrict key → Maps Static
   API**. This is the important part: an unrestricted key works for every
   Google API on the project, so a leak would be expensive.
5. Leave **Application restrictions** as *None* — see the note below — and
   instead cap spending in step 6.
6. **APIs & Services → Maps Static API → Quotas**, and set a daily request
   cap. Something like 5,000/day is far above real usage for a field team and
   turns a runaway loop into a stopped map rather than a bill.

### Why Application restrictions stays “None”

Maps Static API only supports **HTTP referrer** and **IP address**
restrictions. The request comes from the backend, and Vercel does not give
serverless functions a fixed outbound IP on the standard plans, so there is no
IP to allow. Hence: restrict by **API** (step 4) and cap by **quota** (step 6).

If you later move the backend somewhere with a static IP, add that IP as an
application restriction and the key is then locked to your server.

---

## 2. Where the key goes

**Backend environment only.** On Vercel: Project → Settings → Environment
Variables.

```
MAP_PROVIDER=google
MAP_STATIC_API_KEY=AIza...        # the key from step 3
MAP_CACHE_SECONDS=604800          # optional, defaults to 7 days
```

Redeploy after adding them. Nothing is needed in the mobile app, and the app
does not need rebuilding — it asks the backend whether imagery is available
and starts showing it on the next launch.

### Why not in the app

This is the reason the key is server-side and it is worth being explicit
about: **a Maps Static API key cannot be restricted to a mobile app.** The only
restrictions Google offers for it are referrer and IP, which a phone cannot
satisfy. So a key placed in the app would be an *unrestricted* key sitting in
a file anybody can download and unzip — and the first thing that happens to a
leaked Maps key is somebody else's traffic on your bill.

With the proxy:

- the key never leaves the server and can be rotated without an app release;
- requests are authenticated as the signed-in agent, so an anonymous caller
  cannot spend your quota;
- responses are cached for a week, so the same farm reopened costs nothing;
- usage is attributable in your own logs.

---

## 3. Cost, realistically

Static Maps is billed per request. Google's pricing has historically included
a recurring monthly credit on Maps Platform; check the current figure in the
console, because it changes and anything quoted here would go stale.

What keeps the request count low here:

- **One request per farm view**, not per tile — a static image, not a tile grid.
- **Cached for 7 days** on the device (`memory-disk`) and by the response's
  `Cache-Control`, so reopening a farm costs nothing.
- **Zoom is quantised to whole levels**, so a pinch cannot fire a request per
  frame.
- **No imagery while walking a boundary**, where the centre moves with every
  dropped point.

A field agent opening twenty farms a day, each a couple of times, is in the
low hundreds of requests a month.

---

## 4. Mapbox instead

Supported, and a reasonable choice if you prefer its free tier:

1. Create a Mapbox account, **Account → Tokens → Create a token**.
2. Scopes: `styles:tiles` is the one Static Images needs. Leave the rest off.
3. Set a **URL restriction** if you like — the request comes from your
   backend, so this is simpler to lock down than Google's.

```
MAP_PROVIDER=mapbox
MAP_STATIC_API_KEY=pk.eyJ...
```

The two differ in imagery, not in anything you have to configure: Google's
satellite coverage of rural Nigeria is generally sharper and more recently
flown, which matters when the picture exists so an agent can confirm a
boundary sits on actual farmland. Mapbox's free allowance is more generous.
**Start with Google** unless cost is the binding constraint; switching later
is one environment variable.

---

## 5. Checking it works

With the backend deployed and the variables set:

```bash
curl -s https://api.heabroncoopscore.com/api/agent/map/config \
  -H "Authorization: Bearer <an agent access token>"
```

Expected:

```json
{"success":true,"data":{"satellite_available":true,"provider":"google","max_dimension":640}}
```

Then fetch an actual image (a farm in Oju, Benue):

```bash
curl -s -o /tmp/farm.png -w '%{http_code} %{content_type} %{size_download}\n' \
  "https://api.heabroncoopscore.com/api/agent/map/satellite?lat=6.851234&lng=8.391234&zoom=17&width=640&height=640" \
  -H "Authorization: Bearer <an agent access token>"
```

Expected: `200 image/png` and a size in the tens of kilobytes. Open the file —
you should see farmland, not a street map. A street map means `maptype` is not
reaching the provider; a very small PNG is usually Google's “this page can't
load Google Maps correctly” watermark, which means billing or the API
enablement in step 1.

If `satellite_available` is `false`, the variables did not reach the running
deployment — on Vercel, environment variables only apply to builds made after
they were added, so redeploy.

### If something is wrong, the logs say what

The proxy logs the provider's own rejection body (truncated to 500
characters), with the key redacted. That text is usually explicit: “API keys
with referer restrictions cannot be used with this API”, “This API project is
not authorized to use this API”, “You must enable Billing”. Look there before
changing anything.

---

## 6. What happens with no key at all

Nothing breaks. The farm map draws the boundary to scale, the numbered
vertices, the centre marker, the area, the perimeter, a metre grid and a scale
bar — all from the recorded GPS points. The readout says imagery is
unavailable. Adding the key later turns the basemap on with no app change and
no migration.
