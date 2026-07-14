#!/bin/bash
# SSL Certificate Renewal Script
# Run this via cron every 60 days: 0 0 */60 * * /home/ubuntu/PartsBazar360/renew-ssl.sh

cd /home/ubuntu/PartsBazar360

# Renew certificate
docker-compose run --rm certbot renew

# Reload nginx to pick up new certificate
docker-compose exec nginx nginx -s reload

echo "SSL certificate renewed successfully"
