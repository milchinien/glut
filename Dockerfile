FROM node:24-alpine
WORKDIR /srv/glut
COPY package.json ./
COPY src ./src
COPY public ./public
COPY install.ps1 ./install.ps1
RUN mkdir -p /data && chown node:node /data
USER node
ENV GLUT_DATA_DIR=/data GLUT_HOST=0.0.0.0 GLUT_PORT=4318
EXPOSE 4318
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4318/usage/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/host.mjs"]
