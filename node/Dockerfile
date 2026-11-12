# AmneziaWG (the userspace implementation and its tools) from the upstream image at a fixed version; the rest on the
# latest stable Alpine, with the unbound it ships. The upstream image is on Alpine 3.19, whose unbound 1.20.0
# ignores RPZ tags after recursion (NLnetLabs/unbound#1079, fixed in 1.21), which toomore/anoni-net-ws#447 needs.
# Both images are fixed by digest, so a tag that was moved or replaced upstream does not change what a rebuild puts
# on a node: AmneziaWG's binaries handle the server key and everyone's traffic. A rebuild still picks up Alpine's
# package fixes within 3.24 (apk). Moving to the next Alpine or AmneziaWG release is a deliberate step: change the tag
# and the digest, rebuild, then run.sh.
FROM amneziavpn/amneziawg-go:3.1.20260828@sha256:cbafc02b8373a83f428272db6d8001b37bc02e6211cbd8c0cb4e2e3759b12b72 AS awg

FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf
RUN apk add --no-cache bash iproute2 iptables conntrack-tools unbound ca-certificates \
 && mkdir -p /var/lib/unbound && chown unbound:unbound /var/lib/unbound
COPY --from=awg /usr/bin/amneziawg-go /usr/bin/awg /usr/bin/awg-quick /usr/bin/
COPY start.sh /start.sh
RUN chmod 755 /start.sh
ENTRYPOINT ["/start.sh"]
