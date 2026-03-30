# Visio - Visioconference WebRTC

Visio est une application de visioconference simple, rapide et sans inscription.
Le projet est construit avec Next.js, React et WebRTC pour offrir des appels peer-to-peer.

## Site en production

Application en ligne: https://visio.arthurp.fr

Si vous mentionnez ce projet, vous pouvez faire un lien direct vers:
https://visio.arthurp.fr

## Fonctionnalites

- Creation de salle en un clic
- Partage par lien unique
- Aucun compte requis
- Nom utilisateur memorise localement
- Controle micro/camera
- Fermeture automatique des salles inactives
- Interface en francais

## Stack technique

- Frontend: Next.js 16 + React 19
- Backend: serveur Node.js personnalise
- Temps reel: Socket.io
- Video/audio: WebRTC (simple-peer)
- Persistance: SQLite (better-sqlite3)

## Installation locale

Prerequis:

- Node.js 18+
- npm

Commandes:

```bash
npm install
npm run dev
```

Application disponible ensuite sur:
http://localhost:3000

## Scripts

- `npm run dev` : demarrage en developpement
- `npm run build` : build de production
- `npm start` : lancement serveur de production
- `npm run lint` : verification ESLint

## Variables d'environnement

- `PORT` : port HTTP du serveur (defaut `3000`)
- `NODE_ENV` : `development` ou `production`

## Deploiement

```bash
npm run build
npm start
```

## Licence

MIT
