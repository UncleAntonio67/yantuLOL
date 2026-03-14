FROM node:20-alpine AS build

WORKDIR /srv/frontend

COPY package.json package-lock.json /srv/frontend/
RUN npm ci

COPY . /srv/frontend/
RUN npm run build


FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /srv/frontend/dist /usr/share/nginx/html

EXPOSE 80

