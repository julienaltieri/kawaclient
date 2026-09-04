# Authentication and Session

How you get into Kawa, how you stay in, and what the credentials involved are worth if they leak.

Kawa has one user. That fact shapes every trade-off below: there is no account recovery flow, no
per-user isolation to defend between tenants, and no support burden. What there *is* is a live
connection to real bank accounts, which is what makes the credentials worth protecting at all.

The two halves are owned in different places. The server half lives in
[`src/authService.js`](../../src/authService.js) and the `authenticatedRoute` middleware in
[`server.js`](../../server.js); the client half lives in [`ApiCaller.js`](../src/ApiCaller.js),
[`core.js`](../src/core.js) and [`components/loginPage.js`](../src/components/loginPage.js).
Identity itself is owned by **AWS Cognito** — Kawa stores no passwords.

---

## How a login works today

Kawa proxies Cognito rather than talking to it from the browser. The password travels to Kawa's own
server, and the server performs the Cognito exchange.

1. `LoginPage.submitCredentials` reads the username and password out of the DOM by element id and
   POSTs them as JSON to `/login`.
2. The `login` handler in [`routes/index.js`](../../routes/index.js) hands the body to
   `AuthService.login`.
3. `AuthService.login` builds a `CognitoUser` against the pool named in
   [`src/config/awsConfig.js`](../../src/config/awsConfig.js) and calls `authenticateUser`, which
   runs the SRP exchange server-side.
4. On success the callback returns **both** tokens as `{accessToken, refreshToken}`. The refresh
   token matters because Cognito hands one out only here, at password login — there is no other way
   to obtain one.
5. `LoginPage` passes both to `ApiCaller.setSession`, along with the username, which persists them
   to `localStorage` under the key `kawa.session`.
6. Every authenticated call sends the access token in an `accesstoken` header. The
   `authenticatedRoute` middleware in `server.js` validates it with `cognito-express` and puts the
   decoded user on `res.locals.user`.
7. Route handlers resolve identity through the `getUsername` helper in `routes/index.js`, which
   reads `res.locals.user.username`.

`core.js` gates the app on startup: `checkAuthentication` either restores the session through
`ApiCaller.ensureValidSession` or holds it behind the biometric gate below, and `setLoggedIn` either
loads data or redirects to the login route. There is no client-side route guard beyond that —
`components/Navigation.js` only declares the route constant.

## How a session survives

Access token lifetime is an app client setting, currently **1 day** (`AccessTokenValidity: 1`, units
`days`), which is Cognito's maximum — the range is 5 minutes to 1 day. Past that only a refresh token
can mint a new one, so staying logged in longer than a day is entirely a matter of what holds a
refresh token.

`server.js` configures `cognito-express` with `tokenExpiration: 3600000` and a comment reading "1
hour (3600000 ms)". That comment is wrong in a way worth knowing: `cognito-express` forwards the
value to `jsonwebtoken` as `maxAge`, and a bare number there is **seconds**, not milliseconds — so
the setting means roughly 41 days. It never binds, because `jwt.verify` independently enforces the
token's own `exp` claim, which the 1-day setting above makes far shorter. The practical ceiling is
1 day, from Cognito, not from this number.

`AuthService.refreshSession` exchanges a refresh token for a fresh access token and is exposed at
`POST /refreshSession`. Like `/login` it is unauthenticated, because the refresh token *is* the
credential being presented — the same way the password is at `/login`. Cognito needs the username to
rebuild the `CognitoUser`, which is why the session store keeps it.

Two things drive that route:

**Startup.** `ApiCaller.ensureValidSession` prefers the refresh token whenever there is one, rather
than validating the stored access token first. An access token more than a day old is dead anyway, so
validating first would often cost a second round trip to learn nothing. Validating a bare access token
is the fallback path, and exists only for a session created before this store did.

**Expiry mid-use.** `ApiCaller.sendRequest` is the single choke point every API method already funnels
through, so it is the only place that has to know how to recover. On a 401 it calls
`retryAfterRefresh`, which spends the refresh token and replays the original call with the new access
token. The request is cloned *before* the first `fetch` consumes its body, since a consumed request
cannot be replayed. Concurrent calls that all 401 at once share one in-flight refresh promise rather
than each firing their own.

If the refresh itself is refused, the session is genuinely over: the store is cleared and
`onSessionExpired` fires. `ApiCaller` cannot import `Core` — `Core` imports it — so `Core` assigns
that callback in its constructor instead of being reached into.

**Refresh token lifetime is a Cognito app client setting, not a value in this repo**, currently 1 year
— read it from the app client rather than trusting this sentence. The expiry is absolute from
issuance: refreshing does not extend it, so a year after a password login the password is needed
again. See the sliding-expiry roadmap item for what would change that.

The app client has token revocation enabled, which is what makes a leaked refresh token recoverable
from — without it a year-long credential could not be withdrawn short of disabling the user. Nothing
in Kawa calls `RevokeToken` yet; enabling it only preserves the option.

### Where the tokens live, and why it is not an httpOnly cookie

Both tokens sit in `localStorage`, in `ApiCaller`'s session store. An `httpOnly` cookie is the
stronger default and would be the right call if the refresh token were the only consideration, but the
biometric unlock has to be able to *withhold* the token until the device reports a successful user
verification, and a cookie the browser attaches automatically cannot be withheld. Choosing `httpOnly`
would make the fingerprint gate decorative.

`localStorage` also survives the PWA being evicted from memory. The store it replaced was a session
cookie written with no `expires`, which the browser discarded when the browsing context ended — that
eviction, not token expiry, was the more frequent of the two reasons the password used to be needed
several times a day.

Because the refresh token is long-lived, **logging out must clear it.** `SideBar.logout` calls
`ApiCaller.clearSession` rather than blanking a cookie; anything that only cleared the access token
would leave a working credential behind.

**A session created before this store existed does not survive.** It has a cookie but no refresh
token, so the first app kill after upgrading still lands on the login screen. One password login mints
the refresh token and the behaviour starts. This is worth knowing because it looks exactly like the
feature not working.

## The biometric gate

A stored session is not spent until the device has verified its owner. [`Biometrics.js`](../src/Biometrics.js)
holds the WebAuthn side; `Core.checkAuthentication` is where the gate fires and
`Core.unlockWithBiometrics` is the way through it.

**What this is.** WebAuthn with a platform authenticator. The fingerprint never leaves the device and
never reaches Kawa or Cognito — it unlocks a device-bound private key, which signs a challenge. Kawa
is not verifying a fingerprint; it is deciding to release the stored refresh token because the device
reported that it verified its owner. The assertion has to succeed *before* the refresh token is spent,
or the gate would be decorative.

**The gate fires on enrolment alone.** With a credential enrolled and a session stored,
`checkAuthentication` rejects rather than restoring, which lands on the login page. With no credential
the session restores untouched. So enrolling is what switches the behaviour on, and discarding the
credential is what switches it off — there is no separate setting.

**Enrolment has no Kawa-authored UI.** After a password login, `navigator.credentials.create()` is
called and the platform's own prompt does the asking. Declining stores nothing, which leaves the gate
off. Whatever was stored is discarded first, on the reasoning that reaching the password means the
fingerprint path was either never set up or stopped working; a credential goes stale if the device's
biometrics are reset, and since the gate fires on enrolment alone, a dead credential would otherwise
force a password at every launch. Replacing it at that moment makes the failure self-healing.

**The affordance.** A fingerprint glyph inside the password field, rendered only when three things
hold: the device can verify its owner, a credential is enrolled, and there is a session to release.
Anything less and there is no glyph, rather than a glyph that fails when tapped. The unlock is also
attempted on mount, so the ordinary case is one biometric prompt and no tap; where a browser refuses
that without a user gesture, the glyph is already on screen to retry.

Note the condition is capability, not device class. `Core.isMobile()` is
`window.innerHeight > window.innerWidth` and belongs to the display system — it answers "is this a
narrow layout". A user-agent check would be no better: "is this a phone" and "can this device sign a
WebAuthn challenge after verifying its owner" are different facts, and only the second predicts
whether the glyph works. `isUserVerifyingPlatformAuthenticatorAvailable()` answers the second, needs
no device table kept current, and picks up Touch ID on a laptop for free.

**What this is worth, stated plainly.** Nothing server-side verifies the assertion, and the refresh
token sits in `localStorage` in plaintext. This stops someone holding an unlocked phone from opening
Kawa. It does not stop script injection, or anyone with devtools and physical access. That is the
accepted trade for a single-user app, not an oversight — the deferred items below are the two ways
out of it.

`prf` is requested at enrolment even though nothing reads it yet: it costs nothing now, and without it
encrypting the refresh token at rest later would mean re-enrolling the credential.

RP ID is the page's own hostname, so `kawabudget.com` in production and `localhost` in development.
WebAuthn requires HTTPS, and `localhost` is exempt.

---

## What the credentials are worth if they leak

These are recorded because they change how the phases below are sequenced, not as a work list.

**The admin bypass token.** `server.js` defines `adminAccessToken` as a hardcoded string constant.
The `authenticatedRoute` middleware compares the incoming header against it and, on a match, skips
Cognito validation entirely and sets `res.locals.user = {role:"admin"}`. The `getUsername` helper
then honours a caller-supplied `req.body.username` for admin callers. The three facts compose:
possession of that literal string is a permanent credential that reads any user's financial data,
and it is committed to git, so it cannot be rotated by editing the file — the old value stays in
history.

**AWS credentials in source.** `src/config/awsConfig.js` carries an access key id and secret as
string literals, also committed. Separately, `AWSAccessKeyId` falls back to
`process.env.AWS_SECRET_KEY` — the same variable name the secret uses — so moving to real
environment variables would silently set the key id to the secret's value, and fail in a way that
does not point at its own cause.

**The server sees the password in the clear.** Because the SRP exchange happens server-side, the
plaintext password crosses the wire to Kawa and exists in server memory. TLS covers the transport,
but a browser-side Cognito SRP exchange would mean the password never leaves the device at all.

**Login failures return HTTP 200.** The `login` handler sends `JSON.stringify(err)` with the default
status, so the client distinguishes success from failure by duck-typing `res.code !== undefined`.
`JSON.stringify` on an `Error` yields `{}` unless the properties are own and enumerable, which is
why `submitCredentials` also carries a branch for an empty response.

**CORS is open.** `expressApp.use(cors())` with no origin restriction, and `serverless.yml` sets
`origin: '*'` on both HTTP events.

---

## Roadmap

> **This section is a deliberate exception to Rule 5 of [`context.md`](context.md)**, which bars
> status and work-in-progress from this folder. Julien asked for the decisions on this system to be
> tracked here as they are made. The exception is scoped to this section of this file: everything
> above it describes the system as it actually is, and stays Rule 5 clean. As each phase lands, its
> mechanism moves up into the body and its entry here shrinks to a line in the decision log.

### Phase 1b — Sliding expiry (refresh token rotation)

**Goal.** The stated ask: a session that never expires as long as it keeps being used, rather than
one that expires on a fixed date regardless.

A stock Cognito refresh token expires on an absolute schedule from issuance — refreshing returns new
access and ID tokens but leaves the refresh token's original expiry intact. Turning on refresh token
rotation for the app client makes Cognito reissue the refresh token on each use, which is what
converts the window from absolute to sliding.

The client is already built for this: `AuthService.refreshSession` passes back whatever refresh token
comes out of the session and `ApiCaller.refreshSession` stores it, so a rotated token is picked up
with no code change. What is left is confirming the setting exists on the pool's current tier and
enabling it. Worth doing after Phase 1a has been observed working, so that a rotation misconfiguration
is not diagnosed through a lengthened window at the same time.

### Deferred, and why

**The admin bypass token and the AWS keys.** Both are live exposures, and in a public app both would
outrank everything else here. Julien's call is that they wait: Kawa is not public, so the exposure is
theoretical rather than reachable. Recorded with the condition attached, because that reasoning has an
expiry date — **going public is the event that promotes these to urgent, and it has to happen before
launch rather than after.** Note that neither is fixed by editing the file: both values are in git
history, so they stay exposed until they are rotated at the source. Rotating them also means touching
deployment and the Cognito/IAM configuration, which is a different kind of risk from an app change,
and is the other reason they are not bundled into a session about login UX.

**Encrypting the refresh token at rest (WebAuthn `prf`).** Derive an AES-GCM key from the
authenticator via the `prf` extension and store the refresh token encrypted. This is what turns
Phase 2 from a UX gate into real protection at rest, because the ciphertext is undecryptable without
a successful biometric assertion. Deferred on `prf` support being uneven across browsers, which
forces a fallback path and roughly doubles the surface. Requesting `prf` at enrolment now means
adopting this later needs no re-enrolment.

**Server-verified WebAuthn.** Verify assertions server-side with `@simplewebauthn/server`, hold
credential public keys in DynamoDB, and issue sessions from Kawa. Real cryptographic
authentication. The cost is not the WebAuthn code — it is that Kawa would own session issuance,
which Cognito and `cognito-express` own today.

**Cognito native passkeys.** Enable WebAuthn on the user pool, move the app client to the
`USER_AUTH` flow, register through `StartWebAuthnRegistration`, and sign in with the `WEB_AUTHN`
challenge. Cognito stays the single source of session truth and the `authenticatedRoute` middleware
never changes. Gated behind a paid Cognito tier, and the registration flow is awkward outside
Managed Login. Verify the current tier requirement and API shape against AWS documentation before
committing — this surface has moved since launch.

### Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-09-03 | Refresh tokens before biometrics | Without one, nothing can mint an access token but the password. Biometrics on their own would put a fingerprint in front of a session that still dies on the access token's schedule. |
| 2026-09-03 | Refresh token in `localStorage`, not an `httpOnly` cookie | A cookie the browser sends automatically cannot be withheld pending a biometric check, which would make Phase 2 decorative. |
| 2026-09-03 | Local biometric gate accepted over server-verified WebAuthn | Single-user app; the threat being defended against is an unlocked phone, not a remote attacker. Revisit if Kawa ever gains a second account. |
| 2026-09-03 | The fingerprint gates every app open, rather than only appearing on a login screen | Phase 1 removed the login screen from daily use, which left the originally-specced glyph with nowhere to appear and nothing to unlock — after a logout the refresh token is already gone. Gating the restore is the only version where the fingerprint does real work. It trades the zero-touch launch Phase 1 had just delivered for closing the unlocked-phone threat, which was accepted deliberately. |
| 2026-09-03 | Enrolment always replaces whatever credential is stored | The gate fires on enrolment alone, so a credential gone stale — device biometrics reset — would force a password at every launch, worse than no gate. Reaching the password means the biometric path is not working, which makes it the right moment to replace it. |
| 2026-09-03 | A declined enrolment records nothing | Storing no credential leaves the gate off and the session restoring as before, so refusal needs no separate flag. Password logins are rare enough that re-offering then costs nothing. |
| 2026-09-03 | Request `prf` at enrolment despite nothing reading it | Costs nothing now; without it, encrypting the token at rest later would require re-enrolling the credential. |
| 2026-09-03 | Refresh token window of 1 year, not Cognito's 10-year maximum | The ask was "longer is better". Without rotation the window is absolute, so a year is already roughly one password entry per year — the extra nine years buy no meaningful convenience and lengthen the life of a bearer credential to live bank data. |
| 2026-09-03 | Startup refreshes rather than validating the stored access token first | An access token older than a day is dead, so validating first would often spend a round trip to learn nothing. |
| 2026-09-03 | Token revocation enabled on the app client alongside the 1-year window | The client was created in 2020, before the feature existed. A year-long refresh token that cannot be withdrawn is a materially worse trade than a 30-day one; enabling it costs nothing and keeps the option open. |
| 2026-09-03 | Corrected: the access token ceiling is 1 day, not 1 hour | Read from the live app client rather than assumed from Cognito's default. The `tokenExpiration: 3600000` in `server.js` reads as ~41 days, not 1 hour, because `jsonwebtoken` takes `maxAge` in seconds — it never binds. The session cookie, not the token TTL, was the dominant reason the password was needed so often. |
| 2026-09-03 | The 401 retry lives in `ApiCaller.sendRequest` | Every API method already funnels through it, so recovery is written once instead of at 20-odd call sites. Retrofitting the existing seam rather than adding a new one — DECISION-PRINCIPLES.md #1. |
| 2026-09-03 | Admin bypass token and AWS keys deferred behind the login work | Kawa is not public, so the exposure is not reachable. The condition is explicit: going public promotes both to urgent, and neither is fixed by editing the file since the values are in git history. |
