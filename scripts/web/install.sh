#!/usr/bin/env bash
#
# Install or upgrade rmux-web for the current user (issue #18). Run from the
# unpacked package directory:
#
#   ./install.sh            desktop UI on 127.0.0.1:47110 and mobile on :47111
#   ./install.sh --no-mobile
#
# Puts everything in ~/.rmux-web, keeps the previous install in
# ~/.rmux-web/old-<version>-<time>, creates the access token once (0600; never
# printed), and enables systemd *user* units. Nothing here needs root. For the
# services to survive logout and reboot, lingering must be on — that one step
# needs sudo, so it is printed rather than run.

set -euo pipefail
cd "$(dirname "$0")"

MOBILE=1
for a in "$@"; do
  case "$a" in
    --no-mobile) MOBILE=0 ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

DEST="$HOME/.rmux-web"
VERSION="$(cat VERSION)"
mkdir -p "$DEST"
chmod 700 "$DEST"

# Keep the previous install, so a bad upgrade is one `mv` away from undone.
if [ -x "$DEST/rmux-web" ]; then
  OLD="$DEST/old-$(cat "$DEST/VERSION" 2>/dev/null || echo unknown)-$(date +%s)"
  mkdir -p "$OLD"
  for f in rmux-web resources ui ui-mobile VERSION; do
    [ -e "$DEST/$f" ] && mv "$DEST/$f" "$OLD/"
  done
  echo "previous install kept in $OLD"
fi

cp rmux-web VERSION "$DEST/"
cp -R resources ui ui-mobile "$DEST/"

# The token: made once, kept across upgrades. rmux-web refuses a token file
# anyone else can read.
if [ ! -s "$DEST/token" ]; then
  (umask 077 && head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$DEST/token")
  echo "created $DEST/token (0600)"
fi
chmod 600 "$DEST/token"

UNITS="$HOME/.config/systemd/user"
mkdir -p "$UNITS"
cp rmux-web.service "$UNITS/"
[ "$MOBILE" = 1 ] && cp rmux-mobile-web.service "$UNITS/"

if command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
  systemctl --user daemon-reload
  systemctl --user enable rmux-web.service >/dev/null
  systemctl --user restart rmux-web.service
  if [ "$MOBILE" = 1 ]; then
    systemctl --user enable rmux-mobile-web.service >/dev/null
    systemctl --user restart rmux-mobile-web.service
  fi
  echo "rmux-web $VERSION is running (systemctl --user status rmux-web)"
else
  echo "no systemd user session here; start it by hand:"
  echo "  $DEST/rmux-web --ui $DEST/ui --resources $DEST/resources --token-file $DEST/token"
fi

if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
  echo
  echo "To keep it running after you log out and across reboots, run once:"
  echo "  sudo loginctl enable-linger $USER"
fi

cat <<MSG

Open it through a tunnel (it listens on loopback only), e.g. from your laptop:
  ssh -N -L 47110:127.0.0.1:47110 -L 47111:127.0.0.1:47111 $USER@<this host>
then http://127.0.0.1:47110/#token=<the contents of $DEST/token>
(mobile: port 47111). See docs/rmux-web.md for Cloudflare Access and Tailscale.
MSG
