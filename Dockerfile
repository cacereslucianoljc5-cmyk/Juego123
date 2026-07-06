FROM nginx:1.27-alpine

# Static site: no build step required
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
