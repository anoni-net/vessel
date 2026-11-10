"""dedupe.py <raw dir> <out dir> <zone>...: leave out of each blocklist what an earlier one already answers.

unbound checks the zones in the order of node/unbound/rpz-zones.conf and stops at the first match, so an entry already
answered by an earlier zone is never reached: taking it out changes no answer and no count, and saves the memory. Every
zone before the ad list applies to both filter options, so what they answer the ad list need not hold. An exact name is
answered by the same name earlier or by a wildcard above it. A wildcard is answered only by the same wildcard or one
above it: an earlier exact name says nothing about its subdomains, and "*.a.b" does not match "a.b" itself.

Writes <out dir>/.<zone>.new for each zone. A zone that would lose more than MAX_SHARE of its entries is not written and
the exit status is 3: something upstream has gone wrong, and the previous zone is better than a guess.
"""
import os, sys

MAX_SHARE = 0.6


def entry(line):
    """(name, is_wildcard) for a block entry, None for the header lines."""
    p = line.split()
    if len(p) != 3 or p[1].upper() != "CNAME" or p[2] != ".":
        return None
    name = p[0].lower().rstrip(".")
    return (name[2:], True) if name.startswith("*.") else (name, False)


def main(raw, out, zones):
    names, wild, status = set(), set(), 0

    def above(name, include_self):
        labels = name.split(".")
        return any(".".join(labels[i:]) in wild for i in range(0 if include_self else 1, len(labels)))

    for zone in zones:
        path = f"{raw}/{zone}.zone"
        if not os.path.exists(path):
            continue
        kept, own_names, own_wild, total = [], set(), set(), 0
        for line in open(path, encoding="utf-8"):
            e = entry(line)
            if e is None:
                kept.append(line)
                continue
            total += 1
            name, is_wild = e
            (own_wild if is_wild else own_names).add(name)
            if (above(name, True) if is_wild else (name in names or above(name, False))):
                continue
            kept.append(line)
        dropped = total - sum(1 for line in kept if entry(line))
        names |= own_names
        wild |= own_wild
        if total and dropped / total > MAX_SHARE:
            print(f"{zone}: would lose {dropped} of {total} entries, left as it was", file=sys.stderr)
            status = 3
            continue
        with open(f"{out}/.{zone}.new", "w", encoding="utf-8") as f:
            f.writelines(kept)
        print(f"{zone}: {total} entries, {dropped} already answered by an earlier list")
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3:]))
