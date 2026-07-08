# Getting Android users connected (Intra app)

## The link/URL your bot sends

`keys.js` generates one URL per customer, all on the same domain and port,
distinguished only by the key in the path:

```
https://dns.royalgaming.com:11111/a1A10A4qQmNCh3GgcL0e2w
```

There's no subdomain-per-customer and no IP address involved — just your one
domain, your chosen port, and the key as the last path segment. That URL is
what goes straight into Intra's custom-server field.

## Why not a one-tap deep link

Worth knowing before building a UX around it: Intra has no documented deep
link that pre-fills its custom-server field, and its own GitHub issue
tracker shows that field has been flaky historically. So "send a link" here
realistically means: send the URL as text, the user copies it, opens Intra,
and pastes it in. Two taps, not zero.

## Message template for the bot

```
Your DNS key is ready ✅

https://dns.royalgaming.com:11111/a1A10A4qQmNCh3GgcL0e2w

To connect on Android:
1. Install Intra: https://play.google.com/store/apps/details?id=app.intra
2. Open Intra → tap the server name → Custom Server
3. Paste the URL above
4. Toggle Intra on

Your key expires in 30 days.
```

## Testing before you send it to a customer

```
./test/test-dns.sh dns.royalgaming.com 11111 a1A10A4qQmNCh3GgcL0e2w
```

Confirms: the cert is valid for the domain, a bogus key gets rejected (403),
the real key resolves (200), and latency looks reasonable.

## Next steps (not covered here yet)

- **Windows/macOS**: both support DoH natively at the OS or browser level,
  but neither takes a bare custom URL as easily as Intra does — usually
  needs a small registry change (Windows) or a signed configuration profile
  (macOS). Worth its own pass once Android is confirmed working end-to-end.
- **iPhone**: iOS needs a signed `.mobileconfig` DNS profile (self-signed
  profiles show an "unverified" warning unless signed by a trusted CA) —
  different mechanism entirely from pasting a URL into an app.
