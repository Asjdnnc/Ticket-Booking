import React, { useEffect, useState } from 'react';
import styles from './WaitingRoom.module.scss';
import { socket } from '../../lib/socket';

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

const WaitingRoom = ({
  userId,
  eventId = "default_show",
  movieTitle = "Dune: Part Two",
  moviePoster = "https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=800&auto=format&fit=crop",
  hall = "PVR Director's Cut",
  showTime = "03:15 PM",
  onAccessGranted,
}) => {
  const [queueInfo, setQueueInfo] = useState({
    queuePosition: 1,
    usersAhead: 0,
    estimatedWaitSeconds: 15,
  });

  const [isConnected, setIsConnected] = useState(socket.connected && navigator.onLine);

  const fetchQueueStatus = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/queue/status?userId=${encodeURIComponent(userId)}&eventId=${encodeURIComponent(eventId)}`);
      const data = await res.json();

      if (data.status === "GRANTED") {
        onAccessGranted(data.token);
        return;
      }

      setQueueInfo({
        queuePosition: data.queuePosition || 1,
        usersAhead: data.usersAhead || 0,
        estimatedWaitSeconds: data.estimatedWaitSeconds || 15,
      });
      setIsConnected(true);
    } catch (err) {
      console.error("[WaitingRoom] Failed to fetch queue status:", err);
      setIsConnected(false);
    }
  };

  useEffect(() => {
    fetchQueueStatus();

    // Join socket room
    if (socket.connected) {
      socket.emit("join:user_queue", { userId });
    }

    const handleConnect = () => {
      console.log("[WaitingRoom] Socket connected/reconnected");
      setIsConnected(true);
      socket.emit("join:user_queue", { userId });
      fetchQueueStatus();
    };

    const handleDisconnect = (reason) => {
      console.warn("[WaitingRoom] Socket disconnected:", reason);
      setIsConnected(false);
    };

    const handleGranted = (data) => {
      console.log("[WaitingRoom] Access granted via Socket.IO!", data);
      onAccessGranted(data.token);
    };

    const handleRefresh = () => {
      fetchQueueStatus();
    };

    const handleOnline = () => {
      setIsConnected(true);
      fetchQueueStatus();
    };

    const handleOffline = () => {
      setIsConnected(false);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("queue:granted", handleGranted);
    socket.on("queue:refresh", handleRefresh);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Poll every 3 seconds as backup when connected
    const interval = setInterval(() => {
      if (navigator.onLine) {
        fetchQueueStatus();
      }
    }, 3000);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("queue:granted", handleGranted);
      socket.off("queue:refresh", handleRefresh);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [userId, eventId]);

  return (
    <div className={styles.container}>
      <div className={styles.waitingCard}>
        {!isConnected && (
          <div className={styles.disconnectedBanner}>
            ⚡ Connection Lost • Reconnecting to Queue...
          </div>
        )}

        <div className={styles.headerBadge}>
          <span className={styles.liveDot}>●</span> HIGH DEMAND TRAFFIC QUEUE
        </div>

        <div className={styles.movieHeader}>
          {moviePoster && <img src={moviePoster} alt={movieTitle} className={styles.poster} />}
          <div className={styles.movieDetails}>
            <h2>{movieTitle}</h2>
            <p className={styles.slot}>🕒 {showTime} • 📍 {hall}</p>
            <span className={styles.demandPill}>🔥 98% Seats Filled - Queue Active</span>
          </div>
        </div>

        {/* QUEUE POSITION CIRCULAR RING */}
        <div className={styles.queueRingContainer}>
          <div className={`${styles.pulseRing} ${!isConnected ? styles.pulseOffline : ''}`}></div>
          <div className={styles.queueRingContent}>
            <span className={styles.rankNumber}>
              {isConnected ? `#${queueInfo.queuePosition}` : '...'}
            </span>
            <span className={styles.rankLabel}>
              {isConnected ? 'Your Rank in Line' : 'Reconnecting'}
            </span>
          </div>
        </div>

        <div className={styles.statsBox}>
          <div className={styles.statItem}>
            <span className={styles.statVal}>{isConnected ? queueInfo.usersAhead : '-'}</span>
            <span className={styles.statLab}>Users Ahead of You</span>
          </div>
          <div className={styles.divider}></div>
          <div className={styles.statItem}>
            <span className={styles.statVal}>{isConnected ? `~${queueInfo.estimatedWaitSeconds}s` : '-'}</span>
            <span className={styles.statLab}>Est. Wait Time</span>
          </div>
        </div>

        <div className={styles.progressBarWrapper}>
          <div className={`${styles.progressBarFill} ${!isConnected ? styles.progressOffline : ''}`}></div>
        </div>

        <p className={styles.noticeText}>
          🔒 <strong>Please keep this window open.</strong> As soon as an active buyer completes their order or their hold expires, you will automatically enter seat selection!
        </p>
      </div>
    </div>
  );
};

export default WaitingRoom;
