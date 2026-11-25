#!/bin/sh
# Packs the builder that get.sh downloads: this project's scripts plus their
# production npm dependencies, so users need no npm or pnpm. Contains no
# Linear code. Writes dist/release/{linear-desktop-linux-builder.tar.gz,SHA256SUMS}.
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
name=linear-desktop-linux-builder
out="$root/dist/release"
stage="$out/$name"

rm -rf "$out"
mkdir -p "$stage"
cp -R "$root/package.json" "$root/pnpm-lock.yaml" "$root/LICENSE" "$root/README.md" \
  "$root/scripts" "$root/src" "$root/packaging" "$stage/"
# A flat node_modules (no pnpm symlink store) that works with plain Node.
(cd "$stage" && pnpm install --prod --frozen-lockfile --ignore-scripts --config.node-linker=hoisted >/dev/null)
# pnpm's bookkeeping records local paths (the store directory); it isn't needed.
rm -rf "$stage/node_modules/.modules.yaml" "$stage/node_modules/.pnpm-workspace-state-v1.json" \
  "$stage/node_modules/.pnpm" "$stage/node_modules/.bin"

# Neutral owners: tar would otherwise record the local user and group names.
tar -czf "$out/$name.tar.gz" --sort=name --owner=0 --group=0 --numeric-owner -C "$out" "$name"
rm -rf "$stage"
(cd "$out" && sha256sum "$name.tar.gz" > SHA256SUMS)
echo "$out/$name.tar.gz"
