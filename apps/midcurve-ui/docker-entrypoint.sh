#!/bin/sh
cat > /usr/share/nginx/html/config.js << EOF
window.__ENV__ = {
  apiUrl: "${API_URL}"
};
EOF
exec nginx -g 'daemon off;'
