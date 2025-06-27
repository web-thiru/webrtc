import React, { useEffect, useRef, useState } from 'react';
import io, { Socket } from 'socket.io-client';

const SIGNALING_SERVER_URL = 'http://localhost:3001'; // Adjust if your backend is elsewhere
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // You might add TURN servers here if needed for more complex NAT scenarios
    // { urls: 'turn:your.turn.server.com', username: 'user', credential: 'password' },
  ],
};

function Room() {
    
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const socket = useRef<Socket | null>(null);
  const localStream = useRef<MediaStream | null>(null);

  const [userId, setUserId] = useState('');
  const [remoteUserId, setRemoteUserId] = useState<string | null>(null);
  const [status, setStatus] = useState('Enter your name to start...');
  const [isConnected, setIsConnected] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const [activeRoom, setActiveRoom] = useState(false);

  function handleSocket()  {
    socket.current = io(SIGNALING_SERVER_URL);

    socket.current.on('connect', () => {
      console.log('Connected to signaling server');
    //   setStatus('Connected to signaling server.');
    });

    socket.current.on('user-list', (users: string[]) => {
    //   console.log('Current users:', users);
      // You could display a list of available users here for selection
      // For a simple two-person call, we'll rely on the backend's matchmaking
    });

    socket.current.on('status', (message: string) => {
      setStatus(message);
    });

    // Handle incoming call offer
    socket.current.on('call-incoming', async (callerUserId: string, callerSocketId: string) => {
    //   setStatus(`Incoming call from ${callerUserId}.`);
      setRemoteUserId(callerUserId);
      setIsCallActive(true);

      peerConnection.current = new RTCPeerConnection(iceServers);
      setupPeerConnectionListeners(callerSocketId);

      // Add local stream to peer connection
      if (localStream.current) {
        localStream.current.getTracks().forEach((track) => {
          peerConnection.current?.addTrack(track, localStream.current!);
        });
      }

      // Send answer
      socket.current?.emit('answer', callerSocketId, await createAnswer());
    });

    // Handle call initiated (when you are the caller)
    socket.current.on('call-initiated', async (calleeUserId: string, calleeSocketId: string) => {
      setStatus(`Call initiated with ${calleeUserId}. Waiting for answer...`);
      setRemoteUserId(calleeUserId);
      setIsCallActive(true);

      peerConnection.current = new RTCPeerConnection(iceServers);
      setupPeerConnectionListeners(calleeSocketId);

      // Add local stream to peer connection
      if (localStream.current) {
        localStream.current.getTracks().forEach((track) => {
          peerConnection.current?.addTrack(track, localStream.current!);
        });
      }

      // Create and send offer
      socket.current?.emit('offer', calleeSocketId, await createOffer());
    });

    // Handle incoming offer
    socket.current.on('offer', async (senderSocketId: string, offer: RTCSessionDescriptionInit) => {
    //   console.log('Received offer:', offer);
      if (peerConnection.current) {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(offer));
        socket.current?.emit('answer', senderSocketId, await createAnswer());
      }
    });

    // Handle incoming answer
    socket.current.on('answer', async (senderSocketId: string, answer: RTCSessionDescriptionInit) => {
    //   console.log('Received answer:', answer);
      if (peerConnection.current) {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
        setStatus('Connected!');
      }
    });

    // Handle incoming ICE candidates
    socket.current.on('ice-candidate', async (senderSocketId: string, candidate: RTCIceCandidate) => {
    //   console.log('Received ICE candidate:', candidate);
      if (peerConnection.current) {
        try {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('Error adding received ICE candidate', e);
        }
      }
    });

    socket.current.on('call-ended-by-peer', () => {
    //   console.log('Call ended by peer.');
      handleCallEnd();
    //   setStatus('Call ended by the other person.');
    });

    socket.current.on('disconnect', () => {
      console.log('Disconnected from signaling server');
      setStatus('Disconnected from signaling server.');
      handleCallEnd();
    });

    return () => {
      socket.current?.disconnect();
      if (localStream.current) {
        localStream.current.getTracks().forEach(track => track.stop());
      }
      if (peerConnection.current) {
        peerConnection.current.close();
      }
    };
  };

  const setupPeerConnectionListeners = (targetSocketId: string) => {
    if (!peerConnection.current) return;

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        // console.log('Sending ICE candidate:', event.candidate);
        socket.current?.emit('ice-candidate', targetSocketId, event.candidate);
      }
    };

    peerConnection.current.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    peerConnection.current.onconnectionstatechange = () => {
    //   console.log('Peer connection state:', peerConnection.current?.connectionState);
      if (peerConnection.current?.connectionState === 'disconnected' || peerConnection.current?.connectionState === 'failed') {
        handleCallEnd();
      }
    };
  };

  const getLocalMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideoRef.current!.srcObject = stream;
      localStream.current = stream;
      setIsConnected(true);
      return stream;
    } catch (err) {
      console.error('Error accessing media devices.', err);
      setStatus('Error accessing camera/microphone. Please allow access.');
      return null;
    }
  };

  const createOffer = async () => {
    if (!peerConnection.current) return;
    const offer = await peerConnection.current.createOffer();
    await peerConnection.current.setLocalDescription(offer);
    return offer;
  };

  const createAnswer = async () => {
    if (!peerConnection.current) return;
    const answer = await peerConnection.current.createAnswer();
    await peerConnection.current.setLocalDescription(answer);
    return answer;
  };

  const handleJoin = async () => {
    if (userId.trim() === '') {
      setStatus('Please enter your name.');
      return;
    }
    const stream = await getLocalMedia();
    if (stream) {
        handleSocket();
      socket.current?.emit('register', userId);
    }
  };

  const handleEndCall = () => {
    
    if (isCallActive && socket.current) {
    //   console.log('User clicked End Call. Emitting end-call event.');
      // The backend already knows who you are (via socket.id)
      // and who your current peer is.
      socket.current.emit('end-call'); // Just tell the backend you're ending your call
    //   getLocalMedia();/
      handleCallEnd(); // Clean up local state, set to false as it's user initiated
    } else {
        setStatus('Not in an active call to end.');
    }
  };

  const handleEndRoom = () => {
    if (isCallActive && socket.current) {
    //   console.log('User clicked Exit Room. Emitting end-room event.');
      socket.current.emit('end-room'); // Notify the backend to end the room
    //   handleCallEnd(); // Clean up local state, set to false as it's user initiated
    setActiveRoom(false);
    setIsConnected(false);
    } else {
      setStatus('Not in an active call to exit.');
    }
  };

  const handleCallEnd = () => {
    
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    // if (localVideoRef.current) {
    //   localVideoRef.current.srcObject = null;
    // }
    // if (remoteVideoRef.current) {
    //   remoteVideoRef.current.srcObject = null;
    // }
    // setIsCallActive(false);
    // setRemoteUserId(null);
    // setStatus('Call ended. Enter your name to start a new one.');
    // setIsConnected(false); // Allow re-joining
  };


  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <h1>Let's connect...</h1>

      {/* Join Room Section */}

      {(!isConnected || activeRoom) && (
        <div>
          <input
            type="text"
            placeholder="Enter your name"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            style={{ padding: '10px', width: '200px', marginRight: '10px' }}
          />
          <button style={{ padding: '10px 20px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }} onClick={handleJoin} disabled={userId.trim() === ''}>
            Join
          </button>
        </div>
      )}

      {/* {isConnected && ( */}
        <div className='video-container'>
          <div>
            <video ref={localVideoRef} autoPlay muted className='local-video' ></video>
          </div>
          <div>
            <video ref={remoteVideoRef} autoPlay  className='remote-video'></video>
          </div>
        </div>
        {/* )} */}

      {isCallActive && isConnected&&(
        <>
        <button onClick={handleEndCall} style={{ marginTop: '20px', padding: '10px 20px', backgroundColor: 'gray', color: 'white', border: 'none', borderRadius: '5px' }}>
          Next
        </button>
       
        </>
      )}
      { isCallActive && isConnected && (
      <button onClick={handleEndRoom} style={{ marginTop: '20px', marginLeft:'20px',padding: '10px 20px ', backgroundColor: 'red', color: 'white', border: 'none', borderRadius: '5px' }}>
        End Room
      </button>
      )}
    </div>
  );
}

export default Room;