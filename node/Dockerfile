FROM amneziavpn/amneziawg-go:latest
RUN apk add --no-cache unbound ca-certificates iptables \
 && mkdir -p /var/lib/unbound && chown unbound:unbound /var/lib/unbound
COPY start.sh /start.sh
RUN chmod 755 /start.sh
ENTRYPOINT ["/start.sh"]
