import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styles from './Payment.module.scss';
import { errorToast, successToast } from '../../lib/toast';
import { useSeats } from '../../api';
import { useAuth } from '../../context/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

const Payment = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { paymentLoading, payForBooking, releaseHold } = useSeats();
  const razorpayInstanceRef = useRef(null);

  // Get booking data from navigation state
  const {
    seats,
    section,
    bookingId,
    expiresIn,
    userId,
    count,
    city,
    movieTitle = "Dune: Part Two",
    showTime = "03:15 PM",
    hall = "Screen 1 - PVR Director's Cut",
    moviePoster = "https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=800&auto=format&fit=crop"
  } = location.state || {};

  const bookedSeats = seats || [];
  const seatCount = count || bookedSeats.length;

  const [userName, setUserName] = useState(user?.name || '');
  const [userEmail, setUserEmail] = useState(user?.email || '');
  const [userPhone, setUserPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('razorpay');
  const [razorpayPaymentId, setRazorpayPaymentId] = useState(null);

  // Timestamp-based hold expiration (persisted in localStorage across page reloads)
  const [expiresAtTimestamp] = useState(() => {
    if (!bookingId) return Date.now() + 120000;
    const storageKey = `seat_hold_expires_${bookingId}`;
    const savedTimestamp = localStorage.getItem(storageKey);
    if (savedTimestamp) {
      return parseInt(savedTimestamp, 10);
    }
    const newTimestamp = Date.now() + (expiresIn || 120) * 1000;
    localStorage.setItem(storageKey, newTimestamp.toString());
    return newTimestamp;
  });

  // Calculate actual remaining seconds from real clock timestamp
  const calculateRemainingSeconds = () => {
    const remaining = Math.floor((expiresAtTimestamp - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
  };

  const [timeLeft, setTimeLeft] = useState(calculateRemainingSeconds);
  const [isExpired, setIsExpired] = useState(() => calculateRemainingSeconds() <= 0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState(null);

  useEffect(() => {
    if (!bookedSeats.length || !section || !bookingId) {
      navigate('/');
    }
  }, [bookedSeats, section, bookingId, navigate]);

  useEffect(() => {
    if (user) {
      if (!userName) setUserName(user.name);
      if (!userEmail) setUserEmail(user.email);
    }
  }, [user]);

  // Helper to close Razorpay modal safely via SDK & DOM removal
  const closeRazorpayModal = () => {
    console.log("[Razorpay] Closing Razorpay window programmatically...");
    
    if (razorpayInstanceRef.current) {
      try {
        razorpayInstanceRef.current.close();
      } catch (e) {
        console.warn("[Razorpay] rzp.close() instance warning:", e);
      }
      razorpayInstanceRef.current = null;
    }

    try {
      const rzpContainers = document.querySelectorAll(
        '.razorpay-container, .razorpay-checkout-frame, iframe[src*="razorpay"], div[class*="razorpay"]'
      );
      rzpContainers.forEach((el) => {
        if (el && el.parentNode) {
          el.parentNode.removeChild(el);
        }
      });

      document.body.style.overflow = '';
    } catch (e) {
      console.warn("[Razorpay] DOM element removal warning:", e);
    }
  };

  // Realtime clock-based timer loop (resilient to page reloads)
  useEffect(() => {
    if (paymentStatus === 'success') {
      if (bookingId) {
        localStorage.removeItem(`seat_hold_expires_${bookingId}`);
      }
      return;
    }

    const checkTimer = () => {
      const remaining = calculateRemainingSeconds();
      setTimeLeft(remaining);

      if (remaining <= 0 && !isExpired) {
        setIsExpired(true);
        setIsProcessing(false);
        
        closeRazorpayModal();
        errorToast('Time Over! Seat reservation expired.');

        if (bookingId) {
          localStorage.removeItem(`seat_hold_expires_${bookingId}`);
        }

        bookedSeats.forEach(seat => {
          releaseHold(seat.seatId, userId || user?.id);
        });
      }
    };

    // Run check immediately
    checkTimer();

    const timerInterval = setInterval(checkTimer, 1000);
    return () => clearInterval(timerInterval);
  }, [expiresAtTimestamp, paymentStatus, isExpired, bookedSeats, userId, user, releaseHold, bookingId]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getTimerClass = () => {
    if (timeLeft <= 30) return `${styles.timer} ${styles.critical}`;
    if (timeLeft <= 60) return `${styles.timer} ${styles.warning}`;
    return styles.timer;
  };

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    if (isExpired || isProcessing || paymentLoading) return;

    setIsProcessing(true);
    const totalPrice = section.price * seatCount;

    // Load Razorpay Checkout SDK
    const resLoaded = await loadRazorpayScript();
    if (!resLoaded) {
      errorToast("Razorpay SDK failed to load. Check network connection.");
      setIsProcessing(false);
      return;
    }

    try {
      // 1. Create Razorpay order via Next.js API
      const orderRes = await fetch(`${API_BASE_URL}/pay/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: totalPrice,
          bookingId,
        }),
      });

      const orderData = await orderRes.json();
      if (!orderRes.ok) {
        throw new Error(orderData.error || "Failed to create Razorpay Order");
      }

      // 2. Configure Razorpay Modal Options
      const options = {
        key: orderData.keyId || "rzp_test_CinePulseKey123",
        amount: orderData.amount,
        currency: orderData.currency || "INR",
        name: "CinePulse Live Ticket Booking",
        description: `Booking for ${movieTitle} (${seatCount} Seats)`,
        image: moviePoster,
        order_id: orderData.isMock ? undefined : orderData.orderId,
        handler: function (response) {
          const payId = response.razorpay_payment_id || `pay_${Date.now()}`;
          setRazorpayPaymentId(payId);

          // 3. Confirm booking with backend API
          payForBooking(
            {
              bookingId,
              movieTitle,
              showTime,
              hall,
              moviePoster,
              razorpay_order_id: response.razorpay_order_id || orderData.orderId,
              razorpay_payment_id: payId,
              razorpay_signature: response.razorpay_signature || "mock_sig",
            },
            payId,
            (data, error) => {
              if (error) {
                setPaymentStatus('failed');
                setIsProcessing(false);
                return;
              }

              if (bookingId) {
                localStorage.removeItem(`seat_hold_expires_${bookingId}`);
              }

              setPaymentStatus('success');
              successToast('Razorpay payment verified! Booking confirmed.');
            }
          );
        },
        prefill: {
          name: userName || user?.name || "Movie Buff",
          email: userEmail || user?.email || "user@example.com",
          contact: userPhone || "9876543210",
        },
        theme: {
          color: "#eab308",
        },
        modal: {
          ondismiss: function () {
            setIsProcessing(false);
            razorpayInstanceRef.current = null;
          },
        },
      };

      const paymentObject = new window.Razorpay(options);
      razorpayInstanceRef.current = paymentObject;
      paymentObject.open();
    } catch (err) {
      console.error("[Razorpay Error]", err);
      errorToast(err.message || "Payment initiation failed");
      setIsProcessing(false);
    }
  };

  const handleBackToSeats = () => {
    if (bookingId) {
      localStorage.removeItem(`seat_hold_expires_${bookingId}`);
    }
    if (!isExpired && paymentStatus !== 'success') {
      bookedSeats.forEach(seat => {
        releaseHold(seat.seatId, userId || user?.id);
      });
    }
    navigate('/');
  };

  if (!bookedSeats.length || !section || !bookingId) {
    return null;
  }

  const getSeatIdsString = () => bookedSeats.map(s => s.seatId).join(', ');
  const totalPrice = section.price * seatCount;

  // SUCCESS CONFIRMATION SCREEN
  if (paymentStatus === 'success') {
    return (
      <div className={styles.container}>
        <div className={styles.successCard}>
          <div className={styles.successIcon}>✓</div>
          <h1>Booking Confirmed!</h1>
          <p className={styles.confirmationText}>
            Your {seatCount > 1 ? `${seatCount} seats have` : 'seat has'} been successfully booked via Razorpay.
          </p>

          <div className={styles.ticketDetails}>
            <div className={styles.ticketHeader}>
              <span className={styles.ticketLabel}>RAZORPAY VERIFIED PASS</span>
              <span className={styles.ticketId}>#{bookingId.substring(0, 8).toUpperCase()}</span>
            </div>

            <div className={styles.ticketBody}>
              <div className={styles.movieShowcase}>
                {moviePoster && <img src={moviePoster} alt={movieTitle} className={styles.ticketPoster} />}
                <div className={styles.movieMeta}>
                  <h2 className={styles.movieTitle}>{movieTitle}</h2>
                  <p className={styles.showSlot}>🕒 Allotted Slot: {showTime}</p>
                  <p className={styles.hall}>📍 Venue: {hall}</p>
                </div>
              </div>

              <div className={styles.userInfo}>
                <p><strong>Pass Holder:</strong> {userName}</p>
                <p><strong>Email:</strong> {userEmail}</p>
                {razorpayPaymentId && <p><strong>Razorpay Pay ID:</strong> <code>{razorpayPaymentId}</code></p>}
                {city && <p><strong>City:</strong> {city}</p>}
              </div>

              <div className={styles.seatInfo}>
                <div className={styles.infoBox}>
                  <span className={styles.label}>Section</span>
                  <span className={styles.value}>{section.sectionName}</span>
                </div>
                <div className={styles.infoBox}>
                  <span className={styles.label}>{seatCount > 1 ? 'Seats' : 'Seat'}</span>
                  <span className={styles.value}>{getSeatIdsString()}</span>
                </div>
                <div className={styles.infoBox}>
                  <span className={styles.label}>Total Paid</span>
                  <span className={styles.value}>₹{totalPrice.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.successActions}>
            <button className={styles.profileBtn} onClick={() => navigate('/profile')}>
              🎟️ View In My Bookings
            </button>
            <button className={styles.doneButton} onClick={() => navigate('/')}>
              Book Another Show
            </button>
          </div>
        </div>
      </div>
    );
  }

  // WIDE 2-COLUMN PAYMENT CHECKOUT SCREEN WITH RAZORPAY INTEGRATION
  return (
    <div className={styles.container}>
      <div className={styles.paymentCard}>
        {/* TIMER BAR */}
        <div className={getTimerClass()}>
          <span className={styles.timerLabel}>🕒 Seat Lock Expiry Timer</span>
          <span className={styles.timerValue}>{formatTime(timeLeft)}</span>
        </div>

        {isExpired ? (
          <div className={styles.expiredMessage}>
            <span className={styles.expiredIcon}>⏰</span>
            <h2>Time Over! Seat Reservation Expired</h2>
            <p>Your 2-minute seat hold timer has run out. The Razorpay payment window was automatically closed to prevent double-booking.</p>
            <button className={styles.backButton} onClick={handleBackToSeats}>
              Back to Seat Selection
            </button>
          </div>
        ) : (
          <div className={styles.checkoutLayout}>
            {/* LEFT COLUMN: MOVIE SHOWCASE & SUMMARY */}
            <div className={styles.leftCol}>
              <div className={styles.movieShowcaseCard}>
                <img src={moviePoster} alt={movieTitle} className={styles.summaryPoster} />
                <div className={styles.movieInfo}>
                  <span className={styles.liveTag}>● HELD IN REALTIME</span>
                  <h2 className={styles.summaryTitle}>{movieTitle}</h2>
                  <p className={styles.summarySlot}>🕒 {showTime}</p>
                  <p className={styles.summaryHall}>📍 {hall}</p>
                </div>
              </div>

              <div className={styles.orderSummaryBox}>
                <h3>Booking Summary</h3>
                <div className={styles.summaryRow}>
                  <span>Section Class</span>
                  <span>{section.sectionName}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Seat Number(s)</span>
                  <span className={styles.seatPill}>{getSeatIdsString()}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Seats Count</span>
                  <span>{seatCount} Seat{seatCount > 1 ? 's' : ''}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Price per Seat</span>
                  <span>₹{section.price.toLocaleString()}</span>
                </div>
                <div className={`${styles.summaryRow} ${styles.totalRow}`}>
                  <span>Total Payable</span>
                  <span className={styles.totalPriceVal}>₹{totalPrice.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: PASS HOLDER DETAILS & RAZORPAY PAYMENT GATEWAY */}
            <div className={styles.rightCol}>
              <h2>Pass Holder & Razorpay Payment</h2>
              <p className={styles.formSub}>Secure payment powered by Razorpay (UPI, Credit/Debit Cards, NetBanking)</p>

              <form onSubmit={handlePaymentSubmit} className={styles.checkoutForm}>
                <div className={styles.formGroup}>
                  <label htmlFor="name">Full Name *</label>
                  <input
                    type="text"
                    id="name"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="Enter your full name"
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="email">Email Address *</label>
                  <input
                    type="email"
                    id="email"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="name@example.com"
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="phone">Phone Number *</label>
                  <input
                    type="tel"
                    id="phone"
                    value={userPhone}
                    onChange={(e) => setUserPhone(e.target.value)}
                    placeholder="+91 XXXXX XXXXX"
                    required
                  />
                </div>

                <div className={styles.razorpayBadgeBox}>
                  <span className={styles.rzpIcon}>💳</span>
                  <div>
                    <strong>Razorpay Secured Checkout</strong>
                    <p>Supports UPI (GPay, PhonePe, Paytm), Cards & NetBanking</p>
                  </div>
                </div>

                {paymentStatus === 'failed' && (
                  <div className={styles.failedMessage}>
                    <p>Payment transaction failed. Please try again.</p>
                  </div>
                )}

                <button
                  type="submit"
                  className={styles.payButton}
                  disabled={isProcessing || paymentLoading}
                >
                  {isProcessing || paymentLoading
                    ? 'Launching Razorpay Checkout...'
                    : `Pay ₹${totalPrice.toLocaleString()} via Razorpay ➔`}
                </button>

                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={handleBackToSeats}
                  disabled={isProcessing}
                >
                  Cancel & Release Seats
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Payment;
