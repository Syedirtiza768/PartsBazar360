FROM node:22-alpine

WORKDIR /workspace

# The app is built on the host with `npm run build`; the standalone output
# keeps this local deployment small while the generated catalogue stays in a
# host-mounted volume so a fresh live snapshot can be used without rebuilding
# the image.
COPY .next/standalone/node_modules ./node_modules
COPY .next/standalone/apps/enrichment-workbench ./apps/enrichment-workbench
COPY .next/static ./apps/enrichment-workbench/.next/static

# lib/store.ts locates the workspace from these two markers at runtime.
RUN printf '{"name":"PartsBazar360-local-workspace"}\n' > package.json \
    && printf '{"pipeline":{}}\n' > turbo.json

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3004

EXPOSE 3004

CMD ["node", "apps/enrichment-workbench/server.js"]
