#!/bin/bash
# Docker auto-prune cron job setup
set -e
CRON_LINE='0 3 * * 0 /usr/bin/docker system prune -af --volumes=false > /dev/null 2>&1'

# Write to temp file
echo "$CRON_LINE" | sudo tee /tmp/docker-prune.cron > /dev/null

# Install crontab
sudo crontab /tmp/docker-prune.cron

# Clean up
rm -f /tmp/docker-prune.cron

echo "=== Cron job installed ==="
sudo crontab -l
