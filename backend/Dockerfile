FROM node:18-alpine

# Install build tools needed for native modules like bcrypt
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files first (layer caching — only reinstalls if dependencies change)
COPY package*.json ./

# Install dependencies inside the container (not copied from Mac)
RUN npm ci --only=production

# Copy source code (node_modules excluded via .dockerignore)
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Start the server
CMD ["node", "src/app.js"]
