FROM node:22-slim

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Deps first (layer cache)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-workspace --prod=false

# Source + build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# Socket Mode = outbound only, no ports exposed.
CMD ["node", "dist/index.js"]
