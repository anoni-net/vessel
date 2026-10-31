# AmneziaWG (the userspace implementation and its tools) from the upstream image at a fixed version; the rest on a
# current Alpine. The upstream image is on Alpine 3.19, whose unbound 1.20.0 ignores RPZ tags after recursion
# (NLnetLabs/unbound#1079, fixed in 1.21), which toomore/anoni-net-ws#447 needs. Upgrading either is a
# deliberate step: change the tag, rebuild, then run.sh.
FROM amneziavpn/amneziawg-go:3.1.20260828 AS awg

FROM alpine:3.22
RUN apk add --no-cache bash iproute2 iptables unbound ca-certificates \
 && mkdir -p /var/lib/unbound && chown unbound:unbound /var/lib/unbound
COPY --from=awg /usr/bin/amneziawg-go /usr/bin/awg /usr/bin/awg-quick /usr/bin/
COPY start.sh /start.sh
RUN chmod 755 /start.sh
ENTRYPOINT ["/start.sh"]
