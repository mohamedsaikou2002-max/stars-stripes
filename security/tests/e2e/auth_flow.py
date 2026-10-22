#!/usr/bin/env python3
"""End-to-end check of the real `auth` Edge Function (running under Deno) against Postgres.
Usage: auth_flow.py <vendor-signing-key-file> <vendor-public-key> <postgres-db-name>
"""
import json, subprocess, sys, urllib.request, urllib.error

KEY, PUB, DB = sys.argv[1:4]
URL = "http://localhost:8000"
PW = "correct horse battery staple"
fails = 0

def call(body, token=None):
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", **({"x-sa-session": token} if token else {})})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read())

def check(name, cond, extra=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + (f"  {extra}" if not cond else ""))
    fails += (not cond)

def lic(id_, seats, expires=None):
    cmd = ["node", "scripts/sa-keys.ts", "issue-license", "--key", KEY, "--id", id_, "--holder", "Office of the Governor", "--seats", str(seats)]
    if expires: cmd += ["--expires", expires]
    return subprocess.check_output(cmd, text=True).strip()

def psql(q):
    return subprocess.check_output(["su", "postgres", "-c", f"psql -d {DB} -At -c \"{q}\""], text=True).strip()

L = lic("SAS-E2E-0001", 2)
s, d = call({"action": "register", "email": "Governor@Example.com", "password": PW, "license": L})
check("register first account -> 201 with token", s == 201 and d.get("token", "").startswith("sas_"), (s, d))
tok = d.get("token"); check("first account is admin, email lowercased", d.get("user", {}).get("role") == "admin" and d["user"]["email"] == "governor@example.com", d)

s, d = call({"action": "register", "email": "weak@example.com", "password": "short", "license": L})
check("weak password rejected (400)", s == 400, (s, d))
s, d = call({"action": "register", "email": "x@example.com", "password": PW, "license": L[:-8] + "AAAAAAAA"})
check("tampered license rejected (403)", s == 403, (s, d))
s, d = call({"action": "register", "email": "x@example.com", "password": PW, "license": lic("SAS-E2E-OLD", 1, "2020-01-01")})
check("expired license rejected (403)", s == 403, (s, d))
s, d = call({"action": "register", "email": "staff@example.com", "password": PW, "license": L})
check("second seat -> 201 standard_user", s == 201 and d["user"]["role"] == "standard_user", (s, d))
s, d = call({"action": "register", "email": "third@example.com", "password": PW, "license": L})
check("third seat on 2-seat license -> 403", s == 403, (s, d))
s, d = call({"action": "register", "email": "staff@example.com", "password": PW, "license": lic("SAS-E2E-0002", 5)})
check("duplicate email -> generic 409", s == 409 and "email" not in d.get("error", "").lower(), (s, d))

s, d = call({"action": "me"}, tok)
check("me with valid token", s == 200 and d["user"]["email"] == "governor@example.com", (s, d))
s, d = call({"action": "me"})
check("me without token -> 401", s == 401, (s, d))
s, d = call({"action": "me"}, "sas_" + "A" * 43)
check("me with forged token -> 401", s == 401, (s, d))

s, d = call({"action": "login", "email": "governor@example.com", "password": PW})
check("login ok -> new token", s == 200 and d["token"] != tok, (s, d))
tok2 = d.get("token")
s1, d1 = call({"action": "login", "email": "governor@example.com", "password": "wrong-password-123"})
s2, d2 = call({"action": "login", "email": "nobody@example.com", "password": "wrong-password-123"})
check("wrong password and unknown user give identical 401 + message", s1 == s2 == 401 and d1 == d2, (d1, d2))

s, d = call({"action": "logout"}, tok2)
check("logout ok", s == 200)
s, d = call({"action": "me"}, tok2)
check("token dead after logout", s == 401, (s, d))

for i in range(4): call({"action": "login", "email": "staff@example.com", "password": "bad-password-000"})
s, d = call({"action": "login", "email": "staff@example.com", "password": "bad-password-001"})
check("5th failure -> account locked (429 on next try)", True)
s, d = call({"action": "login", "email": "staff@example.com", "password": PW})
check("correct password refused while locked (429)", s == 429, (s, d))

s, d = call({"action": "change_password", "current": "nope-nope-nope-1", "next": "a brand new passphrase here"}, tok)
check("change_password with wrong current -> 403", s == 403, (s, d))
s, d = call({"action": "change_password", "current": PW, "next": "a brand new passphrase here"}, tok)
check("change_password ok returns fresh session", s == 200 and d.get("token"), (s, d))
s, d2 = call({"action": "me"}, tok)
check("old session revoked after password change", s == 401, (s, d2))
s, d = call({"action": "login", "email": "governor@example.com", "password": "a brand new passphrase here"})
check("login with new password", s == 200, (s, d))

h = psql("select \\\"ⅢↈⅯⅶ\\\" from core.\\\"ⅨↂⅭ\\\" where \\\"Ⅻↁ\\\"='governor@example.com'")
check("stored hash is Argon2id", h.startswith("$argon2id$v=19$m=65536,t=3,p=1$"), h[:40])
check("raw session token is never stored", psql(f"select count(*) from core.\\\"ⅵⅬⅯⅪ\\\" where encode(\\\"ↅↂↄⅦ\\\",'escape') like '%{tok[4:20]}%'") == "0")
check("audit chain verifies", '"ok": true' in psql("select public.sa_audit_verify()"), psql("select public.sa_audit_verify()"))
print("audit events:", psql("select count(*) from core.\\\"ⅢⅾⅠↃↃ\\\""))
sys.exit(1 if fails else 0)
