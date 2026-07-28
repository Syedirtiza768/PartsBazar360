#!/usr/bin/env bash
set -euo pipefail
SRC="/c/Users/Irtaza Hassan/usinstance.pem"
KEY="$HOME/.ssh/partsbazar-deploy.pem"
mkdir -p "$HOME/.ssh"
cp "$SRC" "$KEY"
chmod 600 "$KEY"
ls -l "$KEY"
ssh -i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 ubuntu@3.217.241.37 "$@"
