FROM node:alpine as build-env

WORKDIR /workdir

COPY src src
COPY tsconfig.json package*.json ./

RUN \
	npm ci && \
	npm run build


FROM node:lts-slim as runtime

LABEL author="Alberto Amoruso"

EXPOSE 8443

WORKDIR /opt/bot4img2pdf

COPY --from=build-env /workdir/dist .
COPY package*.json .

RUN npm ci --only=production

RUN \
	apt-get update && \
	apt-get install --no-install-recommends -y img2pdf curl && \
	apt-get clean && \
	rm -rf /var/lib/apt/lists/*


HEALTHCHECK --interval=60s --timeout=30s --start-period=30s --retries=3 CMD [ "curl", "-v", "localhost:8443" ]

CMD ["/usr/local/bin/node","/opt/bot4img2pdf/index.js"]