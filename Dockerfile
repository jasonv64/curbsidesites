# Curbside Sites — production image (Azure Container Apps, RUNBOOK.md Phase 5).
#
# One deliberately-fat image, three jobs:
#   1. `npm start`               — the web app (the default CMD)
#   2. `npm run export:static && npm run snapshots:upload` — the nightly
#      failover-snapshot job (ACA cron Job, same image, different command)
#   3. report PDFs — Playwright chromium is baked in because report-run.ts
#      renders the monthly report PDF in-process (ASSUMPTIONS #58 resolved:
#      chromium ships in the image; no separate render service).
#
# No multi-stage/standalone tricks: the cron jobs need scripts/ + tsx, and
# dynamic imports (playwright, @azure/*) defeat output tracing. Image size
# (~2 GB) is a storage cost, not a runtime one — see COSTS.md.
#
# `next build` here needs NO database: every page is request-dynamic
# (host-routed), so nothing queries at build time. Build with:
#   az acr build --registry <acr> --image curbside-app:<tag> .
FROM node:24-bookworm-slim

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
RUN npm ci

# Chromium + its OS libraries for report PDFs. Pinned to the repo's
# @playwright/test version via package-lock.
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build && chown -R node:node /app /ms-playwright

USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
