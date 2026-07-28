sed -i 's/\r$//' /tmp/run-wipe-fast.sh /tmp/wipe-bs-fast.sql
chmod +x /tmp/run-wipe-fast.sh
nohup bash /tmp/run-wipe-fast.sh > /tmp/wipe-fast.log 2>&1 &
echo $!
sleep 5
head -n 50 /tmp/wipe-fast.log
