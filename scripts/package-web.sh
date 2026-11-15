#!/usr/bin/env bash
#
# Package rmux-web for a self-hosted Linux dev box (issue #18).
#
#   scripts/package-web.sh [x86_64|aarch64]      (default: x86_64)
#
# Produces target/rmux-web-<version>-<arch>-linux.tar.gz: a static musl
# rmux-web, the agents it hands out (the host's own as resources/agents/rmux-agent),
# both UI bundles, and scripts/web/install.sh. Unpack it on the host and run
# ./install.sh — no compiler, Rust or Node is needed there, because the binaries
# are cross-compiled here with zig, exactly like the agents.
#
# Needs: `cargo install cargo-zigbuild`, zig, pnpm; agents built by
# scripts/build-agents.sh (it is checked, not rebuilt).

set -euo pipefail
cd "$(dirname "$0")/.."

ARCH="${1:-x86_64}"
case "$ARCH" in
  x86_64 | aarch64) ;;
  *) echo "usage: $0 [x86_64|aarch64]" >&2; exit 2 ;;
esac
TRIPLE="$ARCH-unknown-linux-musl"

VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)"
AGENTS="src-tauri/agents"
if [ "$(cat "$AGENTS/VERSION" 2>/dev/null)" != "$VERSION" ]; then
  echo "$AGENTS/VERSION is not $VERSION — run scripts/build-agents.sh first." >&2
  exit 1
fi
[ -f "$AGENTS/rmux-agent-$TRIPLE" ] || { echo "missing $AGENTS/rmux-agent-$TRIPLE" >&2; exit 1; }

echo "==> rmux-web for $TRIPLE"
rustup target add "$TRIPLE" >/dev/null 2>&1 || true
cargo zigbuild -p rmux-web --release --target "$TRIPLE"

echo "==> UI bundles"
pnpm exec vite build >/dev/null
pnpm exec vite build --config vite.mobile.config.ts >/dev/null

NAME="rmux-web-$VERSION-$ARCH-linux"
STAGE="target/package-web/$NAME"
rm -rf "$STAGE"
mkdir -p "$STAGE/resources/agents"
cp "target/$TRIPLE/release/rmux-web" "$STAGE/rmux-web"
# Every agent, so sessions on *other* hosts reached from this one work too; the
# host's own build doubles as the local agent.
cp "$AGENTS"/rmux-agent-* "$AGENTS/VERSION" "$STAGE/resources/agents/"
cp "$AGENTS/rmux-agent-$TRIPLE" "$STAGE/resources/agents/rmux-agent"
cp -R dist "$STAGE/ui"
cp -R dist-mobile "$STAGE/ui-mobile"
cp scripts/web/install.sh scripts/web/rmux-web.service scripts/web/rmux-mobile-web.service "$STAGE/"
echo "$VERSION" > "$STAGE/VERSION"
chmod +x "$STAGE/rmux-web" "$STAGE/install.sh" "$STAGE/resources/agents/"rmux-agent*

COPYFILE_DISABLE=1 tar --no-xattrs -C target/package-web -czf "target/$NAME.tar.gz" "$NAME"
echo "==> target/$NAME.tar.gz"
