FROM node:alpine as build-env

COPY src src
COPY tsconfig.json package*.json ./

RUN \
	npm ci && \
	npm run build


FROM node:lts-slim as runtime

LABEL author="Alberto Amoruso"

EXPOSE 8443

WORKDIR /opt/bot4img2pdf

COPY --from=build-env dist .
COPY package*.json .

RUN npm ci --only=production

RUN \
	apt update && \
	apt install -y img2pdf curl


HEALTHCHECK --interval=60s --timeout=30s --start-period=30s --retries=3 CMD [ "curl", "-v", "localhost:8443" ]

CMD ["/usr/local/bin/node","/opt/bot4img2pdf/index.js"]