'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { io, Socket } from 'socket.io-client';
import { useLocalStorage } from '@/hooks/useLocalStorage';

interface Participant {
  id: string;
  name: string;
  stream?: MediaStream;
  videoOff?: boolean;
  muted?: boolean;
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id as string;
  
  const [storedUserName, setStoredUserName] = useLocalStorage<string>('visio_username', '');
  const [userName, setUserName] = useState('');
  const [tempName, setTempName] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [roomExists, setRoomExists] = useState<boolean | null>(null);
  const [roomClosed, setRoomClosed] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzersRef = useRef<Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode }>>(new Map());
  const speakingTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidate[]>>(new Map());
  const activityIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pongTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPongRef = useRef<number>(Date.now());

  // Vérifier si la salle existe
  useEffect(() => {
    const checkRoom = async () => {
      try {
        const response = await fetch(`/api/rooms/${roomId}`);
        if (response.ok) {
          setRoomExists(true);
        } else if (response.status === 410) {
          setRoomClosed(true);
          setRoomExists(false);
        } else {
          setRoomExists(false);
        }
      } catch {
        setRoomExists(false);
      }
    };
    
    checkRoom();
  }, [roomId]);

  // Charger le nom depuis localStorage
  useEffect(() => {
    if (storedUserName) {
      setTempName(storedUserName);
    }
  }, [storedUserName]);

  // Mettre à jour l'activité de la salle
  const updateActivity = useCallback(async () => {
    try {
      await fetch(`/api/rooms/${roomId}`, { method: 'PATCH' });
    } catch (error) {
      console.error('Erreur mise à jour activité:', error);
    }
  }, [roomId]);

  // Initialiser les médias locaux
  const initLocalMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      
      localStreamRef.current = stream;
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      // Configurer la détection vocale pour soi-même
      setupVoiceDetection('local', stream);
      
      return stream;
    } catch (err) {
      console.error('Erreur accès média:', err);
      setError('Impossible d\'accéder à la caméra ou au microphone. Veuillez vérifier les permissions.');
      throw err;
    }
  };

  // Configuration WebRTC
  const createPeerConnection = useCallback((peerId: string, peerName: string) => {
    const config: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // Serveurs TURN publics pour les connexions difficiles (mobile, NAT restrictif)
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ],
      iceCandidatePoolSize: 10
    };
    
    console.log(`Création connexion peer avec ${peerName} (${peerId})`);
    const pc = new RTCPeerConnection(config);
    
    // Ajouter les tracks locaux
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }
    
    // Gérer les ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          to: peerId
        });
      }
    };
    
    pc.onicecandidateerror = (event) => {
      console.warn(`Erreur ICE candidate pour ${peerId}:`, event);
    };
    
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE connection state avec ${peerName}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed') {
        console.log(`Tentative de redémarrage ICE avec ${peerName}`);
        pc.restartIce();
      }
    };
    
    // Gérer les tracks distants
    pc.ontrack = (event) => {
      console.log(`Track reçu de ${peerName}`);
      const [remoteStream] = event.streams;
      setParticipants(prev => {
        const existing = prev.find(p => p.id === peerId);
        if (existing) {
          return prev.map(p => p.id === peerId ? { ...p, stream: remoteStream } : p);
        }
        return [...prev, { id: peerId, name: peerName, stream: remoteStream }];
      });
    };
    
    pc.onconnectionstatechange = () => {
      console.log(`Connection state avec ${peerName}: ${pc.connectionState}`);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        handlePeerDisconnect(peerId);
      }
    };
    
    peersRef.current.set(peerId, pc);
    
    // Appliquer les candidats en attente
    const pendingCandidates = pendingCandidatesRef.current.get(peerId) || [];
    if (pendingCandidates.length > 0) {
      console.log(`Application de ${pendingCandidates.length} candidats en attente pour ${peerName}`);
      pendingCandidates.forEach(candidate => {
        pc.addIceCandidate(candidate).catch(err => 
          console.warn('Erreur ajout candidat en attente:', err)
        );
      });
      pendingCandidatesRef.current.delete(peerId);
    }
    
    return pc;
  }, []);

  const handlePeerDisconnect = (peerId: string) => {
    const pc = peersRef.current.get(peerId);
    if (pc) {
      pc.close();
      peersRef.current.delete(peerId);
    }
    pendingCandidatesRef.current.delete(peerId);
    // Nettoyer l'analyseur audio
    const analyzerData = analyzersRef.current.get(peerId);
    if (analyzerData) {
      analyzerData.source.disconnect();
      analyzersRef.current.delete(peerId);
    }
    // Nettoyer le timeout de speaking
    const speakingTimeout = speakingTimeoutsRef.current.get(peerId);
    if (speakingTimeout) {
      clearTimeout(speakingTimeout);
      speakingTimeoutsRef.current.delete(peerId);
    }
    setSpeakingUsers(prev => {
      const next = new Set(prev);
      next.delete(peerId);
      return next;
    });
    setParticipants(prev => prev.filter(p => p.id !== peerId));
  };

  // Détection vocale avec Web Audio API
  const setupVoiceDetection = useCallback((userId: string, stream: MediaStream) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    
    // Éviter les doublons
    if (analyzersRef.current.has(userId)) {
      return;
    }
    
    const audioContext = audioContextRef.current;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.4;
    
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    
    analyzersRef.current.set(userId, { analyser, source });
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    const checkAudio = () => {
      if (!analyzersRef.current.has(userId)) return;
      
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      
      const isSpeaking = average > 10; // Seuil de détection
      
      if (isSpeaking) {
        // Annuler le timeout existant si on parle
        const existingTimeout = speakingTimeoutsRef.current.get(userId);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
          speakingTimeoutsRef.current.delete(userId);
        }
        
        setSpeakingUsers(prev => {
          if (!prev.has(userId)) {
            const next = new Set(prev);
            next.add(userId);
            return next;
          }
          return prev;
        });
      } else {
        // Délai de 500ms avant de retirer l'état speaking
        setSpeakingUsers(prev => {
          if (prev.has(userId) && !speakingTimeoutsRef.current.has(userId)) {
            const timeout = setTimeout(() => {
              setSpeakingUsers(p => {
                const next = new Set(p);
                next.delete(userId);
                return next;
              });
              speakingTimeoutsRef.current.delete(userId);
            }, 500);
            speakingTimeoutsRef.current.set(userId, timeout);
          }
          return prev;
        });
      }
      
      requestAnimationFrame(checkAudio);
    };
    
    checkAudio();
  }, []);

  // Rejoindre la salle
  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!tempName.trim()) {
      setError('Veuillez entrer votre nom');
      return;
    }
    
    const finalName = tempName.trim();
    setUserName(finalName);
    setStoredUserName(finalName);
    
    try {
      await initLocalMedia();
      
      // Connexion Socket.io
      const socket = io({
        path: '/socket.io'
      });
      
      socketRef.current = socket;
      
      socket.on('connect', () => {
        console.log('Socket.io connecté');
        socket.emit('join-room', { roomId, userName: finalName });
        setIsJoined(true);
        
        // Démarrer le heartbeat d'activité
        activityIntervalRef.current = setInterval(updateActivity, 30000);
        updateActivity();
        
        // Démarrer le système de ping pour détecter les déconnexions
        lastPongRef.current = Date.now();
        pingIntervalRef.current = setInterval(() => {
          if (socketRef.current?.connected) {
            socketRef.current.emit('ping-server');
            
            // Vérifier si on a reçu un pong récemment (10 secondes max)
            const timeSinceLastPong = Date.now() - lastPongRef.current;
            if (timeSinceLastPong > 10000) {
              console.error('Serveur injoignable - pas de réponse depuis', timeSinceLastPong, 'ms');
              setError('Le serveur ne répond plus. Vérifiez votre connexion.');
              cleanup();
            }
          }
        }, 3000); // Ping toutes les 3 secondes
      });
      
      socket.on('pong-server', () => {
        lastPongRef.current = Date.now();
      });
      
      socket.on('existing-users', async ({ users }) => {
        // Liste des utilisateurs déjà présents (avec leur état audio/vidéo)
        for (const user of users) {
          if (!participants.find(p => p.id === user.id)) {
            setParticipants(prev => [...prev, { 
              id: user.id, 
              name: user.name,
              videoOff: user.videoOff || false,
              muted: user.muted || false
            }]);
          }
        }
      });
      
      socket.on('user-joined', async ({ userId, userName: peerName }) => {
        // Un nouvel utilisateur a rejoint, créer une offre
        const pc = createPeerConnection(userId, peerName);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        socket.emit('offer', {
          offer: offer,
          to: userId
        });
        
        setParticipants(prev => {
          if (!prev.find(p => p.id === userId)) {
            return [...prev, { id: userId, name: peerName }];
          }
          return prev;
        });
      });
      
      socket.on('offer', async ({ offer, from, fromName }) => {
        // Recevoir une offre, créer une réponse
        const pc = createPeerConnection(from, fromName);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        
        // Appliquer les candidats ICE en attente
        const pendingCandidates = pendingCandidatesRef.current.get(from) || [];
        if (pendingCandidates.length > 0) {
          console.log(`Application de ${pendingCandidates.length} candidats en attente après offer`);
          for (const candidate of pendingCandidates) {
            try {
              await pc.addIceCandidate(candidate);
            } catch (err) {
              console.warn('Erreur ajout candidat en attente:', err);
            }
          }
          pendingCandidatesRef.current.delete(from);
        }
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('answer', {
          answer: answer,
          to: from
        });
      });
      
      socket.on('answer', async ({ answer, from }) => {
        // Recevoir une réponse
        const pc = peersRef.current.get(from);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          
          // Appliquer les candidats ICE en attente
          const pendingCandidates = pendingCandidatesRef.current.get(from) || [];
          if (pendingCandidates.length > 0) {
            console.log(`Application de ${pendingCandidates.length} candidats en attente après answer`);
            for (const candidate of pendingCandidates) {
              try {
                await pc.addIceCandidate(candidate);
              } catch (err) {
                console.warn('Erreur ajout candidat en attente:', err);
              }
            }
            pendingCandidatesRef.current.delete(from);
          }
        }
      });
      
      socket.on('ice-candidate', async ({ candidate, from }) => {
        // Recevoir un ICE candidate
        if (!candidate) return;
        
        const pc = peersRef.current.get(from);
        if (pc && pc.remoteDescription) {
          // La connexion est prête, ajouter le candidat directement
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.warn('Erreur ajout ICE candidate:', err);
          }
        } else {
          // Mettre en file d'attente si la connexion n'est pas encore prête
          console.log(`Mise en file d'attente du candidat ICE pour ${from}`);
          const pending = pendingCandidatesRef.current.get(from) || [];
          pending.push(new RTCIceCandidate(candidate));
          pendingCandidatesRef.current.set(from, pending);
        }
      });
      
      socket.on('user-left', ({ userId }) => {
        handlePeerDisconnect(userId);
      });
      
      socket.on('user-name-changed', ({ userId, newName }) => {
        setParticipants(prev => 
          prev.map(p => p.id === userId ? { ...p, name: newName } : p)
        );
      });
      
      socket.on('user-video-toggle', ({ userId, videoOff }) => {
        setParticipants(prev => 
          prev.map(p => p.id === userId ? { ...p, videoOff } : p)
        );
      });
      
      socket.on('user-audio-toggle', ({ userId, muted }) => {
        setParticipants(prev => 
          prev.map(p => p.id === userId ? { ...p, muted } : p)
        );
      });
      
      socket.on('room-closed', () => {
        setRoomClosed(true);
        cleanup();
      });
      
      socket.on('disconnect', () => {
        console.log('Socket.io déconnecté');
        if (isJoined && !roomClosed) {
          setError('Connexion perdue. Veuillez rafraîchir la page.');
        }
      });
      
      socket.on('connect_error', (error) => {
        console.error('Socket.io erreur:', error);
        setError('Erreur de connexion au serveur');
      });
      
    } catch (err) {
      console.error('Erreur lors de la connexion:', err);
    }
  };

  // Cleanup
  const cleanup = useCallback(() => {
    if (activityIntervalRef.current) {
      clearInterval(activityIntervalRef.current);
    }
    
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current);
    }
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();
    
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Réassigner le stream vidéo local quand le composant est rendu
  useEffect(() => {
    if (isJoined && localStreamRef.current && localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [isJoined]);

  // Contrôles média
  const toggleMute = () => {
    if (localStreamRef.current) {
      const newMuted = !isMuted;
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !newMuted;
      });
      setIsMuted(newMuted);
      
      // Notifier les autres participants
      if (socketRef.current) {
        socketRef.current.emit('audio-toggle', { muted: newMuted });
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const newVideoOff = !isVideoOff;
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = !newVideoOff;
      });
      setIsVideoOff(newVideoOff);
      
      // Notifier les autres participants
      if (socketRef.current) {
        socketRef.current.emit('video-toggle', { videoOff: newVideoOff });
      }
    }
  };

  const leaveRoom = () => {
    cleanup();
    router.push('/');
  };

  const copyLink = () => {
    const url = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNameChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (tempName.trim()) {
      setUserName(tempName.trim());
      setStoredUserName(tempName.trim());
      setShowSettings(false);
      
      // Notifier les autres participants du changement de nom
      if (socketRef.current) {
        socketRef.current.emit('name-change', {
          name: tempName.trim()
        });
      }
    }
  };

  // Page de chargement
  if (roomExists === null) {
    return (
      <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  // Salle fermée
  if (roomClosed) {
    return (
      <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="card max-w-md w-full text-center">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Salle fermée</h2>
          <p className="text-gray-600 mb-6">
            Cette visioconférence a été fermée car elle est restée inactive pendant plus de 5 minutes.
          </p>
          <Link href="/" className="btn-primary inline-block">
            Retour à l'accueil
          </Link>
        </div>
      </div>
    );
  }

  // Salle non trouvée
  if (!roomExists) {
    return (
      <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="card max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Salle introuvable</h2>
          <p className="text-gray-600 mb-6">
            Cette salle de visioconférence n'existe pas ou le code est incorrect.
          </p>
          <Link href="/" className="btn-primary inline-block">
            Retour à l'accueil
          </Link>
        </div>
      </div>
    );
  }

  // Page pour rejoindre (demande de nom)
  if (!isJoined) {
    return (
      <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="card max-w-md w-full">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Rejoindre la visio</h2>
            <p className="text-gray-600">
              Code de la salle : <span className="font-mono font-semibold">{roomId}</span>
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                Votre nom
              </label>
              <input
                type="text"
                id="name"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                placeholder="Entrez votre nom"
                className="input-field"
                autoFocus
              />
            </div>
            <button type="submit" className="btn-primary w-full">
              Rejoindre
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link href="/" className="text-blue-500 hover:text-blue-600 text-sm">
              ← Retour à l'accueil
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Page de visioconférence
  const gridClass = `video-grid video-grid-${Math.min(participants.length + 1, 4)}`;

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-white font-semibold hidden sm:inline">Visio</span>
          </Link>
          <span className="text-gray-400 text-sm">
            Salle : <span className="font-mono">{roomId}</span>
          </span>
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={copyLink}
            className="flex items-center space-x-2 bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg text-sm transition-colors"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Copié !</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                <span className="hidden sm:inline">Partager</span>
              </>
            )}
          </button>
          
          <button
            onClick={() => {
              setTempName(userName);
              setShowSettings(true);
            }}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            title="Paramètres"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Zone vidéo */}
      <main className="flex-1 p-4 overflow-auto">
        <div className={gridClass}>
          {/* Vidéo locale */}
          <div className={`video-container aspect-video ${speakingUsers.has('local') ? 'speaking' : ''}`}>
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className={isVideoOff ? 'hidden' : ''}
            />
            {isVideoOff && (
              <div className="video-placeholder">
                <div className="w-20 h-20 bg-gray-700 rounded-full flex items-center justify-center">
                  <span className="text-3xl text-white font-semibold">
                    {userName.charAt(0).toUpperCase()}
                  </span>
                </div>
              </div>
            )}
            <div className="video-label">
              {userName} (Vous)
              {isMuted && (
                <svg className="w-4 h-4 inline ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
              )}
            </div>
          </div>

          {/* Vidéos des participants */}
          {participants.map((participant) => (
            <div key={participant.id} className={`video-container aspect-video ${speakingUsers.has(participant.id) ? 'speaking' : ''}`}>
              {participant.stream && !participant.videoOff ? (
                <video
                  autoPlay
                  playsInline
                  ref={(el) => {
                    if (el && participant.stream) {
                      el.srcObject = participant.stream;
                      // Configurer la détection vocale pour ce participant
                      setupVoiceDetection(participant.id, participant.stream);
                    }
                  }}
                />
              ) : (
                <div className="video-placeholder">
                  <div className="w-20 h-20 bg-gray-700 rounded-full flex items-center justify-center">
                    <span className="text-3xl text-white font-semibold">
                      {participant.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                </div>
              )}
              <div className="video-label">
                {participant.name}
                {participant.muted && (
                  <svg className="w-4 h-4 inline ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                )}
              </div>
            </div>
          ))}
        </div>

        {participants.length === 0 && (
          <div className="mt-8 text-center text-gray-400">
            <p>En attente d'autres participants...</p>
            <p className="text-sm mt-2">
              Partagez le lien pour inviter des personnes
            </p>
          </div>
        )}
      </main>

      {/* Barre de contrôles */}
      <footer className="bg-gray-800 px-4 py-4">
        <div className="flex items-center justify-center space-x-4">
          <button
            onClick={toggleMute}
            className={`btn-icon ${isMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}
            title={isMuted ? 'Activer le micro' : 'Couper le micro'}
          >
            {isMuted ? (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>

          <button
            onClick={toggleVideo}
            className={`btn-icon ${isVideoOff ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}
            title={isVideoOff ? 'Activer la caméra' : 'Couper la caméra'}
          >
            {isVideoOff ? (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
          </button>

          <button
            onClick={leaveRoom}
            className="btn-icon bg-red-500 hover:bg-red-600"
            title="Quitter"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
            </svg>
          </button>
        </div>
        
        <div className="text-center mt-2 text-gray-500 text-sm">
          {participants.length + 1} participant{participants.length > 0 ? 's' : ''}
        </div>
      </footer>

      {/* Modal paramètres */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">Paramètres</h3>
              <button
                onClick={() => setShowSettings(false)}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <form onSubmit={handleNameChange} className="space-y-4">
              <div>
                <label htmlFor="settings-name" className="block text-sm font-medium text-gray-700 mb-2">
                  Votre nom
                </label>
                <input
                  type="text"
                  id="settings-name"
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  className="input-field"
                />
              </div>
              <div className="flex space-x-3">
                <button type="submit" className="btn-primary flex-1">
                  Enregistrer
                </button>
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  className="btn-secondary flex-1"
                >
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
