# The node image: the latest stable Alpine with the unbound it ships, AmneziaWG's daemon built here from upstream's
# source, and AmneziaWG's tools (awg, awg-quick) from upstream's image. The upstream image is on Alpine 3.19, whose
# unbound 1.20.0 ignores RPZ tags after recursion (NLnetLabs/unbound#1079, fixed in 1.21), which
# toomore/anoni-net-ws#447 needs.
#
# Built once, on a build host, and loaded onto the nodes (image.sh): a node has one CPU and its users' traffic, and
# compiles nothing. Every image is fixed by digest, so a tag moved upstream does not change what a build produces;
# Alpine's package fixes within 3.24 still come in with each build (apk).
#
# The daemon (amneziawg-go) is upstream's source unchanged, at the version below, fetched through the Go module proxy
# and checked against the checksum database. Two things differ from upstream's own build, both for security fixes
# upstream has not taken yet (amnezia-vpn/amneziawg-go#218): a supported Go release, and newer golang.org/x/crypto,
# x/net and x/sys, at the versions in amneziawg-deps/go.mod, where Dependabot proposes their new releases and flags
# their known vulnerabilities. The build flags are upstream's (its Dockerfile). The tests of every package the daemon
# is made of run before it is built. To upgrade AmneziaWG: change AWG_VERSION and the upstream image's tag together
# (node/test/awg-version-test.sh fails when they differ). Either way, then image.sh build, the tests in README.md's
# 升級, and image.sh push.
FROM amneziavpn/amneziawg-go:3.1.20261116@sha256:e6ac67745f024e3e41a4897b8e72f090cd15c375e42c7e3e6f9c981e057edafd AS upstream

FROM golang:1.27.4-alpine3.24@sha256:70bd7ddea8b6cbe5d6943cde279d6b67feb10cc924fb9100d1d8757c1575b280 AS build
ARG AWG_VERSION=v3.1.20261116
RUN apk add --no-cache build-base
COPY amneziawg-deps/go.mod /deps/go.mod
WORKDIR /src
RUN set -eu; \
    deps=$(awk '$1 ~ /^golang\.org\/x\/(crypto|net|sys)$/ && $2 ~ /^v[0-9]/ { print $1 "@" $2 }' /deps/go.mod); \
    test "$(echo "$deps" | wc -l)" -eq 3; \
    dir=$(cd / && go mod download -json "github.com/amnezia-vpn/amneziawg-go/v3@$AWG_VERSION" | grep '"Dir":' | cut -d'"' -f4); \
    test -n "$dir" && test -f "$dir/go.mod"; \
    cp -r "$dir"/. /src && chmod -R u+w /src; \
    go get $deps; \
    go mod tidy; \
    go mod verify; \
    go test $(go list -deps . | grep '^github.com/amnezia-vpn/amneziawg-go/v3'); \
    go build -ldflags '-linkmode external -extldflags "-fno-PIC -static"' -o /out/amneziawg-go .; \
    { echo "upstream github.com/amnezia-vpn/amneziawg-go/v3 $AWG_VERSION"; go version -m /out/amneziawg-go; } > /out/amneziawg-go.buildinfo

# what tools/dpi-check and tools/handshake-check run: upstream's image with the daemon built here
FROM upstream AS awg
COPY --from=build /out/amneziawg-go /usr/bin/amneziawg-go
COPY --from=build /out/amneziawg-go.buildinfo /usr/share/vessel-node/amneziawg-go.buildinfo

FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf
# upgrade first: apk add installs what is missing and leaves the base image's own packages (zlib, musl) as they are
RUN apk upgrade --no-cache \
 && apk add --no-cache bash iproute2 iptables conntrack-tools unbound ca-certificates \
 && mkdir -p /var/lib/unbound && chown unbound:unbound /var/lib/unbound
COPY --from=awg /usr/bin/amneziawg-go /usr/bin/awg /usr/bin/awg-quick /usr/bin/
# which Go and which modules the daemon was built with: docker exec vessel-node cat this
COPY --from=awg /usr/share/vessel-node/amneziawg-go.buildinfo /usr/share/vessel-node/
COPY start.sh /start.sh
RUN chmod 755 /start.sh
ENTRYPOINT ["/start.sh"]
