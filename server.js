const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Connexion à la base de données SQLite
const dbPath = path.join(process.cwd(), 'visio.db');
const db = new Database(dbPath);

// Fonction pour nettoyer les salles inactives dans la DB
function cleanupInactiveRoomsInDB() {
  const stmt = db.prepare(`
    UPDATE rooms SET is_active = 0 
    WHERE is_active = 1 
    AND datetime(last_activity, '+5 minutes') < datetime('now')
  `);
  const result = stmt.run();
  if (result.changes > 0) {
    console.log(`Nettoyage: ${result.changes} salle(s) inactive(s) fermée(s)`);
  }
  return result.changes;
}

// Stockage des salles et participants en mémoire
const rooms = new Map();
const roomTimers = new Map();

// Durée d'inactivité avant fermeture (5 minutes)
const INACTIVITY_TIMEOUT = 5 * 60 * 1000;

app.prepare().then(() => {
  // Nettoyer les salles inactives au démarrage
  console.log('Nettoyage des salles inactives au démarrage...');
  cleanupInactiveRoomsInDB();
  
  // Lancer un nettoyage périodique toutes les minutes
  setInterval(() => {
    cleanupInactiveRoomsInDB();
  }, 60 * 1000);

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Fonction pour réinitialiser le timer d'inactivité
  function resetRoomTimer(roomId) {
    if (roomTimers.has(roomId)) {
      clearTimeout(roomTimers.get(roomId));
    }
    
    const timer = setTimeout(() => {
      const room = rooms.get(roomId);
      if (room && room.participants.size === 0) {
        console.log(`Fermeture de la salle ${roomId} pour inactivité`);
        io.to(roomId).emit('room-closed');
        rooms.delete(roomId);
        roomTimers.delete(roomId);
        
        // Marquer la salle comme fermée dans la DB
        fetch(`http://localhost:${port}/api/rooms/${roomId}`, {
          method: 'DELETE'
        }).catch(console.error);
      }
    }, INACTIVITY_TIMEOUT);
    
    roomTimers.set(roomId, timer);
  }

  io.on('connection', (socket) => {
    console.log('Nouvelle connexion:', socket.id);
    
    let currentRoom = null;
    let currentUser = null;

    socket.on('join-room', ({ roomId, userName }) => {
      currentRoom = roomId;
      currentUser = { id: socket.id, name: userName, videoOff: false, muted: false };
      
      // Rejoindre la room Socket.io
      socket.join(roomId);
      
      // Initialiser ou récupérer la salle
      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          participants: new Map()
        });
      }
      
      const room = rooms.get(roomId);
      
      // Envoyer la liste des participants existants au nouveau (avec leur état audio/vidéo)
      const existingUsers = Array.from(room.participants.values());
      socket.emit('existing-users', { users: existingUsers });
      
      // Ajouter le nouveau participant
      room.participants.set(socket.id, currentUser);
      
      // Notifier les autres de la nouvelle connexion
      socket.to(roomId).emit('user-joined', {
        userId: socket.id,
        userName: userName
      });
      
      // Réinitialiser le timer d'inactivité
      resetRoomTimer(roomId);
      
      console.log(`${userName} a rejoint la salle ${roomId}`);
    });

    socket.on('offer', ({ offer, to }) => {
      const room = rooms.get(currentRoom);
      const fromUser = room?.participants.get(socket.id);
      
      socket.to(to).emit('offer', {
        offer,
        from: socket.id,
        fromName: fromUser?.name || 'Inconnu'
      });
    });

    socket.on('answer', ({ answer, to }) => {
      socket.to(to).emit('answer', {
        answer,
        from: socket.id
      });
    });

    socket.on('ice-candidate', ({ candidate, to }) => {
      socket.to(to).emit('ice-candidate', {
        candidate,
        from: socket.id
      });
    });

    socket.on('name-change', ({ name }) => {
      if (currentRoom && currentUser) {
        currentUser.name = name;
        const room = rooms.get(currentRoom);
        if (room) {
          room.participants.set(socket.id, currentUser);
        }
        
        socket.to(currentRoom).emit('user-name-changed', {
          userId: socket.id,
          newName: name
        });
      }
    });

    socket.on('video-toggle', ({ videoOff }) => {
      if (currentRoom && currentUser) {
        currentUser.videoOff = videoOff;
        const room = rooms.get(currentRoom);
        if (room) {
          room.participants.set(socket.id, currentUser);
        }
        
        socket.to(currentRoom).emit('user-video-toggle', {
          userId: socket.id,
          videoOff
        });
      }
    });

    socket.on('audio-toggle', ({ muted }) => {
      if (currentRoom && currentUser) {
        currentUser.muted = muted;
        const room = rooms.get(currentRoom);
        if (room) {
          room.participants.set(socket.id, currentUser);
        }
        
        socket.to(currentRoom).emit('user-audio-toggle', {
          userId: socket.id,
          muted
        });
      }
    });

    // Répondre aux pings des clients pour la détection de déconnexion
    socket.on('ping-server', () => {
      socket.emit('pong-server');
    });

    socket.on('disconnect', () => {
      if (currentRoom) {
        const room = rooms.get(currentRoom);
        if (room) {
          room.participants.delete(socket.id);
          
          // Notifier les autres
          socket.to(currentRoom).emit('user-left', {
            userId: socket.id
          });
          
          console.log(`Utilisateur ${socket.id} a quitté la salle ${currentRoom}`);
          
          // Si la salle est vide, démarrer le timer de fermeture
          if (room.participants.size === 0) {
            resetRoomTimer(currentRoom);
          }
        }
      }
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Serveur prêt sur http://${hostname}:${port}`);
  });
});
