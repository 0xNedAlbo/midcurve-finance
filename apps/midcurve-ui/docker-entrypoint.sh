#!/bin/sh
cat > /usr/share/nginx/html/config.js << EOF
window.__ENV__ = {
  apiUrl: "${API_URL}"
};
EOF
sed -i "s/listen 3000/listen ${PORT:-3000}/g" /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
