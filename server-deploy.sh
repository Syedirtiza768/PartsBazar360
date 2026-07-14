#!/bin/bash
set -e

echo "=== PartsBazar360 Deployment ==="

# Install Docker
echo "[1/6] Installing Docker..."
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker ubuntu

# Start Docker
sudo systemctl start docker
sudo systemctl enable docker

# Install docker-compose standalone
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

echo "[2/6] Docker installed successfully"

# Clone repository
echo "[3/6] Cloning repository..."
cd /home/ubuntu
if [ -d "PartsBazar360" ]; then
    cd PartsBazar360
    git pull origin main
else
    git clone https://github.com/Syedirtiza768/PartsBazar360.git
    cd PartsBazar360
fi

# Create certbot directories
mkdir -p certbot/conf certbot/www

# Create temporary nginx config for SSL certificate request
echo "[4/6] Setting up temporary nginx for SSL..."
cat > nginx/nginx-temp.conf << 'NGINX'
worker_processes auto;
events {
    worker_connections 1024;
}
http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout 65;
    server {
        listen 80;
        server_name partsbazar360.realtrackapp.com;
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        location / {
            return 200 'Setting up SSL...';
            add_header Content-Type text/plain;
        }
    }
}
NGINX

# Start temporary nginx
echo "[5/6] Requesting SSL certificate..."
sudo docker run -d --name temp-nginx -p 80:80 -v $(pwd)/nginx/nginx-temp.conf:/etc/nginx/nginx.conf:ro -v $(pwd)/certbot/www:/var/www/certbot:ro nginx:alpine

# Request SSL certificate
sudo docker run --rm -v $(pwd)/certbot/conf:/etc/letsencrypt -v $(pwd)/certbot/www:/var/www/certbot certbot/certbot certonly --webroot --webroot-path=/var/www/certbot --email admin@realtrackapp.com --agree-tos --no-eff-email -d partsbazar360.realtrackapp.com --non-interactive

# Stop temporary nginx
sudo docker stop temp-nginx
sudo docker rm temp-nginx

# Remove temporary nginx config
rm nginx/nginx-temp.conf

# Start all services
echo "[6/6] Starting all services..."
sudo docker compose up -d --build

echo ""
echo "=== Deployment Complete ==="
echo "Application: https://partsbazar360.realtrackapp.com"
echo ""
echo "Check status: sudo docker compose ps"
echo "View logs:    sudo docker compose logs -f"
