-- Whether a device's config has the private IPv6 address next to its IPv4 one (anoni-net/vessel#122). Without it,
-- iOS sends IPv6 around the tunnel, so the devices page suggests a new config for devices made before.
ALTER TABLE devices ADD COLUMN ipv6 boolean NOT NULL DEFAULT false;
