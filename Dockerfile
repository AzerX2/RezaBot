# Image de base légère et sécurisée
FROM node:20-alpine

# Outils de build requis pour les modules natifs (notamment better-sqlite3 sur Alpine musl)
RUN apk add --no-cache python3 make g++

# Définition du répertoire de travail
WORKDIR /app

# Copie des manifests de dépendances
COPY package*.json ./
COPY .npmrc ./

# Installation des dépendances de production uniquement
RUN npm ci --omit=dev

# Copie du reste du code source
COPY . .

# Démarrage de l'application
CMD ["npm", "start"]
