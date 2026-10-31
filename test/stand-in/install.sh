#!/bin/sh
# A stand-in for the vendor's installer: prints, waits a little, and puts the stand-in `agy`
# where the vendor's installer puts it on this test's PATH: `$HOME/.local/bin/agy`. `fail` as
# the first argument makes it the installer that does not finish. Never run against a real home.
here=$(cd "$(dirname "$0")" && pwd)
echo "stand-in installer: downloading…"
sleep 1
if [ "$1" = "fail" ]; then
  echo "stand-in installer: the download failed (this is the failing variant)"
  exit 7
fi
mkdir -p "$HOME/.local/bin"
cp "$here/agy" "$HOME/.local/bin/agy"
cp "$here/agy.ts" "$HOME/.local/bin/agy.ts"
chmod +x "$HOME/.local/bin/agy"
echo "stand-in installer: installed to $HOME/.local/bin/agy"
