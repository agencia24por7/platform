FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:26-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 tria && adduser --system --uid 1001 --ingroup tria tria

COPY --from=build --chown=tria:tria /app/.next/standalone ./
COPY --from=build --chown=tria:tria /app/.next/static ./.next/static
COPY --from=build --chown=tria:tria /app/public ./public
COPY --from=deps --chown=tria:tria /app/node_modules/zod ./node_modules/zod
COPY --from=build --chown=tria:tria /app/src/shared/config/env.ts /app/src/shared/config/validarAmbiente.ts /app/src/shared/config/validarAmbienteCli.ts ./release/

USER tria
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=15s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --timeout=10 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
