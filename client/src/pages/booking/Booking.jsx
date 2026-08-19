import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styles from './Booking.module.scss';
import { eventData, seatLayout, transformSeatsData } from '../../data/mockData';
import { featuredMovies } from '../../data/moviesData';
import { errorToast, successToast, infoToast } from '../../lib/toast';
import { useSeats } from '../../api';
import { socket } from "../../lib/socket";
import { useAuth } from '../../context/AuthContext';
import WaitingRoom from '../../components/WaitingRoom/WaitingRoom';

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
const MAX_SEATS = 4;

const Booking = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, openAuthModal } = useAuth();
  const { seatsLoading, bookingLoading, getSeats, bookSeat } = useSeats();

  const showTitle = searchParams.get("title") || eventData.eventName;
  const showTime = searchParams.get("time") || eventData.time;
  const showHall = searchParams.get("hall") || eventData.venue;
  const showPoster = searchParams.get("poster") || "https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=800&auto=format&fit=crop";

  const getGuestUserId = () => {
    let guestId = localStorage.getItem('cine_guest_user_id');
    if (!guestId) {
      guestId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      localStorage.setItem('cine_guest_user_id', guestId);
    }
    return guestId;
  };

  const activeUserId = user?.id || getGuestUserId();

  const [queueStatus, setQueueStatus] = useState("CHECKING"); // CHECKING | QUEUED | GRANTED
  const [accessToken, setAccessToken] = useState(null);

  const matchingMovie = featuredMovies.find(m => m.title.toLowerCase() === showTitle.toLowerCase()) || {
    format: "IMAX 3D, 4DX",
    language: "English, Hindi",
    rating: 8.8,
  };

  const [seats, setSeats] = useState(null);
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [targetSeatCount, setTargetSeatCount] = useState(2);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingSeatId, setLoadingSeatId] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [city, setCity] = useState('Mumbai');

  // Virtual Waiting Room Queue Interceptor
  useEffect(() => {
    let isMounted = true;

    const joinQueueApi = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/queue/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: activeUserId,
            eventId: showTitle,
          }),
        });

        const data = await res.json();
        if (!isMounted) return;

        if (data.status === "GRANTED") {
          setAccessToken(data.token);
          setQueueStatus("GRANTED");
        } else {
          setQueueStatus("QUEUED");
        }
      } catch (err) {
        console.error("[Booking] Queue join error:", err);
        if (isMounted) setQueueStatus("GRANTED");
      }
    };

    joinQueueApi();

    return () => {
      isMounted = false;
      fetch(`${API_BASE_URL}/queue/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: activeUserId,
          eventId: showTitle,
        }),
      }).catch(() => {});
    };
  }, [activeUserId, showTitle]);

  useEffect(() => {
    if (queueStatus === "GRANTED") {
      fetchSeats();
    }
  }, [queueStatus]);

  const updateSeatStatus = (seatId, newStatus) => {
    setSeats((prevSeats) => {
      if (!prevSeats || !prevSeats.sections) return prevSeats;

      const newSeats = { ...prevSeats };
      newSeats.sections = newSeats.sections.map((section) => ({
        ...section,
        rows: section.rows.map((row) =>
          row.map((seat) =>
            seat.seatId === seatId ? { ...seat, status: newStatus } : seat
          )
        ),
      }));
      return newSeats;
    });
  };

  useEffect(() => {
    socket.on("connect", () => {
      console.log("[Socket] Connected:", socket.id);
    });

    socket.on("seat:update", (data) => {
      const { seatId, status } = data;
      if (!seatId || !status) return;

      const uiStatus = status === "HELD" ? "HOLD" : status;
      updateSeatStatus(seatId, uiStatus);

      if (uiStatus !== "AVAILABLE") {
        setSelectedSeats((prev) => prev.filter((s) => s.seat.seatId !== seatId));
      }
    });

    socket.on("disconnect", () => {
      console.log("[Socket] Disconnected");
    });

    return () => {
      socket.off("connect");
      socket.off("seat:update");
      socket.off("disconnect");
    };
  }, []);

  const fetchSeats = () => {
    getSeats((data, error) => {
      if (error) {
        setSeats(seatLayout);
        setInitialLoading(false);
        return;
      }

      const transformedData = transformSeatsData(data.sections);
      setSeats(transformedData);
      setInitialLoading(false);
    });
  };

  const handleSeatClick = (seat, section) => {
    if (seat.status !== 'AVAILABLE' || isLoading || bookingLoading) return;

    const isAlreadySelected = selectedSeats.some(s => s.seat.seatId === seat.seatId);

    if (isAlreadySelected) {
      setSelectedSeats(prev => prev.filter(s => s.seat.seatId !== seat.seatId));
    } else {
      if (selectedSeats.length >= MAX_SEATS) {
        errorToast(`Maximum ${MAX_SEATS} seats allowed per booking`);
        return;
      }
      if (selectedSeats.length > 0 && selectedSeats[0].section.sectionId !== section.sectionId) {
        errorToast('All selected seats must be in the same section');
        return;
      }
      setSelectedSeats(prev => [...prev, { seat, section }]);
      infoToast(`Seat ${seat.seatId} selected (${selectedSeats.length + 1}/${MAX_SEATS})`);
    }
  };

  const removeSelectedSeat = (seatId) => {
    setSelectedSeats(prev => prev.filter(s => s.seat.seatId !== seatId));
  };

  const handleConfirmBooking = () => {
    if (!user) {
      infoToast('Please sign in to proceed with booking');
      openAuthModal();
      return;
    }
    if (!city) {
      errorToast('Please select a city first');
      return;
    }
    if (selectedSeats.length === 0 || isLoading || bookingLoading) return;

    const section = selectedSeats[0].section;
    const seatsToBook = selectedSeats.map(s => ({
      seatId: s.seat.seatId,
      sectionId: s.section.sectionId,
    }));

    setIsLoading(true);
    infoToast(`Reserving ${selectedSeats.length} seat(s)...`);

    const activeUserId = user.id || "usr_demo";

    bookSeat(
      {
        seats: seatsToBook,
        userId: activeUserId,
        city,
      },
      (data, error) => {
        if (error) {
          if (error?.error === "SEAT_ALREADY_TAKEN") {
            const takenSeat = error.seatId || seatsToBook[0]?.seatId;
            if (takenSeat) {
              updateSeatStatus(takenSeat, 'BOOKED');
              setSelectedSeats(prev => prev.filter(s => s.seat.seatId !== takenSeat));
              errorToast(`Seat ${takenSeat} was just booked by another user!`);
            }
          } else {
            errorToast(error?.message || "Seat booking failed");
          }
          setIsLoading(false);
          return;
        }

        successToast(`${selectedSeats.length} seat(s) reserved!`);

        navigate('/payment', {
          state: {
            seats: data.seats || seatsToBook,
            section: section,
            bookingId: data.bookingId,
            expiresIn: data.expiresIn,
            userId: activeUserId,
            count: data.count || selectedSeats.length,
            city,
            movieTitle: showTitle,
            showTime: showTime,
            hall: showHall,
            moviePoster: showPoster,
          },
        });

        setSelectedSeats([]);
        setIsLoading(false);
      }
    );
  };

  const handleSectionBook = (section) => {
    if (!user) {
      infoToast('Please sign in to proceed with booking');
      openAuthModal();
      return;
    }
    if (!city) {
      errorToast('Please select a city first');
      return;
    }
    if (isLoading || bookingLoading) return;

    const availableSeats = [];
    section.rows.forEach(row => {
      row.forEach(seat => {
        if (seat.status === 'AVAILABLE') {
          availableSeats.push(seat);
        }
      });
    });

    if (availableSeats.length === 0) {
      errorToast(`No available seats in ${section.sectionName}`);
      return;
    }

    const countToBook = Math.min(targetSeatCount, availableSeats.length);
    const chosenSeats = availableSeats.slice(0, countToBook);
    
    setIsLoading(true);
    setLoadingSeatId(chosenSeats[0].seatId);

    const activeUserId = user.id || "usr_demo";
    const seatsPayload = chosenSeats.map(s => ({ seatId: s.seatId, sectionId: section.sectionId }));

    bookSeat(
      {
        seats: seatsPayload,
        userId: activeUserId,
        city,
      },
      (data, error) => {
        if (error) {
          if (error?.error === "SEAT_ALREADY_TAKEN") {
            updateSeatStatus(chosenSeats[0].seatId, 'BOOKED');
          }
          setIsLoading(false);
          setLoadingSeatId(null);
          return;
        }

        successToast(`${countToBook} seat(s) reserved!`);

        navigate('/payment', {
          state: {
            seats: data.seats || seatsPayload,
            section: section,
            bookingId: data.bookingId,
            expiresIn: data.expiresIn,
            userId: activeUserId,
            count: data.count || countToBook,
            city,
            movieTitle: showTitle,
            showTime: showTime,
            hall: showHall,
            moviePoster: showPoster,
          },
        });

        setIsLoading(false);
        setLoadingSeatId(null);
      }
    );
  };

  const getSeatClass = (seat, section) => {
    const isSelected = selectedSeats.some(s => s.seat.seatId === seat.seatId);
    let classes = [styles.seatWrapper];

    if (section.sectionId === 'A' || section.sectionName.toLowerCase().includes('gold')) {
      classes.push(styles.vipSeat);
    }

    if (isSelected) {
      classes.push(styles.selected);
    } else if (seat.status === 'AVAILABLE') {
      classes.push(styles.available);
    } else if (seat.status === 'HOLD') {
      classes.push(styles.hold);
    } else if (seat.status === 'BOOKED') {
      classes.push(styles.booked);
    }

    if (loadingSeatId === seat.seatId) {
      classes.push(styles.loading);
    }

    return classes.join(' ');
  };

  const getSectionBadge = (name) => {
    if (name.toLowerCase().includes("gold") || name.toLowerCase().includes("vip")) {
      return { icon: "👑", tag: "ROYAL VIP RECLINERS" };
    }
    if (name.toLowerCase().includes("silver") || name.toLowerCase().includes("executive")) {
      return { icon: "✨", tag: "CLUB EXECUTIVE SEATING" };
    }
    return { icon: "🎟️", tag: "CLASSIC ARENA SEATING" };
  };

  const renderSeatItem = (seat, section) => (
    <div
      key={seat.seatId}
      className={getSeatClass(seat, section)}
      onClick={() => handleSeatClick(seat, section)}
      title={`Seat ${seat.seatId} (${seat.status}) - ${section.sectionName}`}
    >
      <div className={styles.headrest}></div>
      <div className={styles.seatBack}></div>
      <div className={styles.seatBase}>
        {loadingSeatId === seat.seatId ? (
          <div className={styles.spinner}></div>
        ) : seat.status === 'HOLD' ? (
          <span className={styles.lockIcon}>🔒</span>
        ) : seat.status === 'BOOKED' ? (
          <span className={styles.bookedIcon}>✕</span>
        ) : (
          <span className={styles.seatNumber}>
            {seat.seatId.replace(/^[A-Z]+/, '')}
          </span>
        )}
      </div>
      <div className={styles.armrestLeft}></div>
      <div className={styles.armrestRight}></div>
    </div>
  );

  if (queueStatus === "CHECKING") {
    return (
      <div className={styles.container}>
        <div className={styles.loadingOverlay} style={{ minHeight: '450px' }}>
          <div className={styles.loadingContent}>
            <div className={styles.loadingSpinner}></div>
            <p>Verifying traffic queue & seat availability...</p>
          </div>
        </div>
      </div>
    );
  }

  if (queueStatus === "QUEUED") {
    return (
      <WaitingRoom
        userId={activeUserId}
        eventId={showTitle}
        movieTitle={showTitle}
        moviePoster={showPoster}
        hall={showHall}
        showTime={showTime}
        onAccessGranted={(token) => {
          setAccessToken(token);
          setQueueStatus("GRANTED");
          successToast("Your turn reached! Entering seat selection...");
        }}
      />
    );
  }

  if (initialLoading || !seats) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingOverlay} style={{ minHeight: '400px' }}>
          <div className={styles.loadingContent}>
            <div className={styles.loadingSpinner}></div>
            <p>Loading interactive cinema hall...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* SHOWCASE HEADER CARD */}
      <div className={styles.showcaseBanner}>
        <img src={showPoster} alt={showTitle} className={styles.bannerPoster} />
        
        <div className={styles.bannerDetails}>
          <div className={styles.topBadgeRow}>
            <span className={styles.liveBadge}>● LIVE SYNC</span>
            <span className={styles.formatBadge}>{matchingMovie.format}</span>
            {matchingMovie.rating && <span className={styles.ratingBadge}>★ {matchingMovie.rating}</span>}
          </div>

          <h1 className={styles.bannerTitle}>{showTitle}</h1>

          <div className={styles.bannerMeta}>
            <span>📍 {showHall}</span>
            <span className={styles.dot}>•</span>
            <span>🕒 {showTime}</span>
            <span className={styles.dot}>•</span>
            <span>🗣️ {matchingMovie.language}</span>
          </div>
        </div>

        {/* QUICK SEAT COUNT PICKER */}
        <div className={styles.ticketCountPicker}>
          <label>How Many Seats?</label>
          <div className={styles.countPills}>
            {[1, 2, 3, 4].map(num => (
              <button
                key={num}
                className={`${styles.countBtn} ${targetSeatCount === num ? styles.activeCount : ''}`}
                onClick={() => setTargetSeatCount(num)}
              >
                {num}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.citySelectorBox}>
          <label>Location</label>
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className={styles.cityDropdown}
          >
            <option value="Mumbai">Mumbai</option>
            <option value="Delhi">Delhi</option>
            <option value="Bangalore">Bangalore</option>
            <option value="Ahmedabad">Ahmedabad</option>
          </select>
        </div>
      </div>

      {/* CURVED CINEMA SCREEN PROJECTION */}
      <div className={styles.screenContainer}>
        <div className={styles.screenLightBeam}></div>
        <div className={styles.screenCurve}>
          <span>IMAX 70mm CURVED SCREEN • ALL EYES THIS WAY ➔</span>
        </div>
      </div>

      {/* SEAT LAYOUT MAP WITH LUXURY CHAIRS */}
      <div className={styles.seatLayout}>
        {seats.sections.map((section) => {
          const badge = getSectionBadge(section.sectionName);
          return (
            <div key={section.sectionId} className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionInfo}>
                  <span className={styles.sectionIcon}>{badge.icon}</span>
                  <div>
                    <h3>{section.sectionName} Class</h3>
                    <span className={styles.subTag}>{badge.tag}</span>
                  </div>
                  <span className={styles.price}>
                    {eventData.currency}{section.price.toLocaleString()}
                  </span>
                </div>
                <button
                  className={styles.quickBook}
                  onClick={() => handleSectionBook(section)}
                  disabled={isLoading}
                >
                  ⚡ Auto-Select {targetSeatCount} Best Seat{targetSeatCount > 1 ? 's' : ''}
                </button>
              </div>

              <div className={styles.rows}>
                {section.rows.map((row, rowIndex) => {
                  const midIndex = Math.ceil(row.length / 2);
                  const leftBlock = row.slice(0, midIndex);
                  const rightBlock = row.slice(midIndex);

                  return (
                    <div key={rowIndex} className={styles.row}>
                      <span className={styles.rowLabel}>Row {rowIndex + 1}</span>

                      <div className={styles.seatBlock}>
                        {leftBlock.map((seat) => renderSeatItem(seat, section))}
                      </div>

                      <div className={styles.aisleGap}>
                        <span>AISLE</span>
                      </div>

                      <div className={styles.seatBlock}>
                        {rightBlock.map((seat) => renderSeatItem(seat, section))}
                      </div>

                      <span className={styles.rowLabelRight}>Row {rowIndex + 1}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* LEGEND BAR */}
      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <div className={`${styles.legendBox} ${styles.available}`}></div>
          <span>Available Seat</span>
        </div>
        <div className={styles.legendItem}>
          <div className={`${styles.legendBox} ${styles.selected}`}></div>
          <span>Selected Seat ({selectedSeats.length}/{MAX_SEATS})</span>
        </div>
        <div className={styles.legendItem}>
          <div className={`${styles.legendBox} ${styles.hold}`}></div>
          <span>Locked in Realtime</span>
        </div>
        <div className={styles.legendItem}>
          <div className={`${styles.legendBox} ${styles.booked}`}></div>
          <span>Sold Out</span>
        </div>
      </div>

      {/* FLOATING ACTION BAR */}
      {selectedSeats.length > 0 && (
        <div className={styles.selectionBar}>
          <div className={styles.selectionInfo}>
            <div className={styles.seatSummaryRow}>
              <span className={styles.selectionCount}>
                {selectedSeats.length} Seat{selectedSeats.length > 1 ? 's' : ''} Selected:
              </span>
              <div className={styles.selectedPillContainer}>
                {selectedSeats.map(s => (
                  <span
                    key={s.seat.seatId}
                    className={styles.selectedSeatsPill}
                    onClick={() => removeSelectedSeat(s.seat.seatId)}
                    title="Click to remove"
                  >
                    {s.seat.seatId} <span className={styles.removeX}>✕</span>
                  </span>
                ))}
              </div>
            </div>
            <span className={styles.selectionTotal}>
              Total Amount: <strong>{eventData.currency}{(selectedSeats[0]?.section.price * selectedSeats.length).toLocaleString()}</strong>
            </span>
          </div>

          <div className={styles.selectionActions}>
            <button
              className={styles.clearButton}
              onClick={() => setSelectedSeats([])}
              disabled={isLoading}
            >
              Clear
            </button>
            <button
              className={styles.confirmButton}
              onClick={handleConfirmBooking}
              disabled={isLoading}
            >
              {isLoading ? 'Reserving...' : `Proceed to Payment ➔`}
            </button>
          </div>
        </div>
      )}

      {/* LOADING OVERLAY */}
      {isLoading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.loadingContent}>
            <div className={styles.loadingSpinner}></div>
            <p>Reserving your selected seats via Redis distributed lock...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Booking;
