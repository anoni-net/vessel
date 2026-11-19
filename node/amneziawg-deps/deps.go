//go:build tools

// Package deps names the modules node/Dockerfile builds amneziawg-go with on top of upstream's go.mod: golang.org/x/
// crypto, x/net and x/sys, at the versions in go.mod here. It is never built. Importing them keeps go mod tidy (and
// Dependabot, which runs it) from dropping them, so Dependabot proposes their new versions and flags known
// vulnerabilities in them, which it cannot do for versions written into the Dockerfile.
package deps

import (
	_ "golang.org/x/crypto/chacha20poly1305"
	_ "golang.org/x/net/ipv4"
	_ "golang.org/x/sys/unix"
)
