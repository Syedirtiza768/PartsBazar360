#!/bin/bash
set -e

# PartsBazar360 EC2 Deployment Script
# Domain: partsbazar360.realtrackapp.com

echo "=== PartsBazar360 Deployment Script ==="
echo ""

# Update system
echo "[1/8] Updating system packages..."
sudo apt-get update -y
sudo apt-get upgrade -y

# Install Docker
echo "[2/8] Installing Docker..."
if ! command -v docker &> /dev/null; then
    sudo apt-get install -y apt-transport-https ca-certificates curl software-properties-common
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io
    sudo usermod -aG docker $USER
    echo "Docker installed successfully"
else
    echo "Docker already installed"
fi

# Install Docker Compose
echo "[3/8] Installing Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo "Docker Compose installed successfully"
else
    echo "Docker Compose already installed"
fi

# Clone repository
echo "[4/8] Cloning repository..."
cd /home/ubuntu
if [ -d "PartsBazar360" ]; then
    cd PartsBazar360
    git pull origin main
else
    git clone https://github.com/Syedirtiza768/PartsBazar360.git
    cd PartsBazar360
fi

# Create certbot directories
echo "[5/8] Creating certbot directories..."
mkdir -p certbot/conf certbot/www

# Create temporary nginx config for initial SSL certificate request
echo "[6/8] Setting up temporary nginx for SSL certificate..."
cat > nginx/nginx-temp.conf << 'EOF'
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout 65;
    client_max_body_size 20m;

    server {
        listen 80;
        server_name partsbazar360.realtrackapp.com;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 200 'PartsBazar360 - Setting up SSL...';
            add_header Content-Type text/plain;
        }
    }
}
EOF

# Start temporary nginx
echo "[7/8] Starting temporary nginx for certificate validation..."
docker run -d --name temp-nginx \
    -p 80:80 \
    -v $(pwd)/nginx/nginx-temp.conf:/etc/nginx/nginx.conf:ro \
    -v $(pwd)/certbot/www:/var/www/certbot:ro \
    nginx:alpine

# Request SSL certificate
echo "[8/8] Requesting SSL certificate from Let's Encrypt..."
echo ""
echo "IMPORTANT: Make sure the DNS A record for partsbazar360.realtrackapp.com"
echo "           points to this server's IP address before continuing!"
echo ""
read -p "Press Enter to continue with certificate request..."

docker run --rm \
    -v $(pwd)/certbot/conf:/etc/letsencrypt \
    -v $(pwd)/certbot/www:/var/www/certbot \
    certbot/certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email admin@realtrackapp.com \
    --agree-tos \
    --no-eff-email \
    -d partsbazar360.realtrackapp.com

# Stop temporary nginx
docker stop temp-nginx
docker rm temp-nginx

# Remove temporary nginx config
rm nginx/nginx-temp.conf

# Start all services
echo ""
echo "=== Starting all services with docker-compose ==="
docker-compose up -d --build

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Your application is now running at:"
echo "  https://partsbazar360.realtrackapp.com"
echo ""
echo "Portal URLs:"
echo "  Admin:      https://partsbazar360.realtrackapp.com/admin/"
echo "  Buyer:      https://partsbazar360.realtrackapp.com/buyer/"
echo "  Seller:     https://partsbazar360.realtrackapp.com/seller/"
echo "  Operations: https://partsbazar360.realtrackapp.com/operations/"
echo "  Workshop:   https://partsbazar360.realtrackapp.com/workshop/"
echo "  API:        https://partsbazar360.realtrackapp.com/api/"
echo ""
echo "To view logs: docker-compose logs -f"
echo "To restart:   docker-compose restart"
echo "To stop:      docker-compose down"
echo ""
