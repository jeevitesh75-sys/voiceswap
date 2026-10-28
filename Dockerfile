FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Run as a normal user (required by Hugging Face Spaces)
USER node
WORKDIR /home/node/app
COPY --chown=node . .
ENV PORT=7860 NODE_ENV=production DATA_DIR=/home/node/data
RUN mkdir -p /home/node/data
EXPOSE 7860
CMD ["node", "server/index.js"]
