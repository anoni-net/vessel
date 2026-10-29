# Analysis tools for tools/dpi-check: nDPI's ndpiReader built from source (Debian's package is years behind),
# tshark and tcpdump.
FROM debian:trixie-slim
ARG NDPI_VERSION=6.0
ARG DEBIAN_MIRROR
RUN if [ -n "$DEBIAN_MIRROR" ]; then sed -i "s#http://deb.debian.org/debian#$DEBIAN_MIRROR#g" /etc/apt/sources.list.d/debian.sources; fi \
    && apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      tshark tcpdump ca-certificates git build-essential autoconf automake libtool pkg-config libpcap-dev libjson-c-dev \
    && rm -rf /var/lib/apt/lists/*
# autogen.sh no longer runs configure by itself
RUN git clone --depth 1 --branch "$NDPI_VERSION" https://github.com/ntop/nDPI.git /src/nDPI \
    && cd /src/nDPI && ./autogen.sh >/dev/null && ./configure >/dev/null && make -j"$(nproc)" >/dev/null \
    && cp example/ndpiReader /usr/local/bin/ && rm -rf /src
