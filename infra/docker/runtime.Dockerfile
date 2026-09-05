FROM node:24-bookworm-slim AS foundation
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY . .
RUN pnpm install --frozen-lockfile
ARG VITE_API_BASE_URL=http://localhost:4000
ARG VITE_DEMO_MODE=true
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE
RUN pnpm build
USER node
