#!/bin/bash
# Quick update script - pull latest changes and rebuild
cd /home/ubuntu/PartsBazar360

echo "Pulling latest changes..."
git pull origin main

echo "Rebuilding and restarting services..."
docker-compose up -d --build

echo "Update complete! Application is running at https://partsbazar360.realtrackapp.com"
