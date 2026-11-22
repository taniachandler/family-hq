#!/usr/bin/env python3
"""Turn a Family HQ setup JSON file into a one-tap setup link.

Usage:  python3 make_setup_link.py https://their-site.netlify.app setup.json
Prints: https://their-site.netlify.app/#/setup/<code>

The family details go after the '#', which browsers never send to any server.
Setup checks the code again and shows a summary before anything is saved.
"""
import base64
import json
import sys


def fail(msg):
    print(f"Problem: {msg}", file=sys.stderr)
    sys.exit(1)


def main():
    if len(sys.argv) != 3:
        fail("usage: make_setup_link.py <site link> <setup.json>")
    site, path = sys.argv[1].strip().rstrip("/"), sys.argv[2]
    if not site.startswith("https://"):
        fail("the site link should start with https://")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    people = data.get("people") or []
    names = [str(p.get("name", "")).strip() for p in people]
    if not names or not all(names):
        fail("add at least one person, each with a name")
    if len({n.lower() for n in names}) != len(names):
        fail("two people have the same name")
    if not any(p.get("role") == "adult" for p in people):
        fail("at least one person must have role 'adult'")
    lower = {n.lower() for n in names}
    for night, slots in (data.get("chart") or {}).items():
        for s in slots:
            if str(s.get("who", "")).strip().lower() not in lower:
                fail(f"{night}: '{s.get('who')}' isn't in the list of people")

    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    code = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    print(f"{site}/#/setup/{code}")


if __name__ == "__main__":
    main()
