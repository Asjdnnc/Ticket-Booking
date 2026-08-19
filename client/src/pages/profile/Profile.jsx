import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import styles from "./Profile.module.scss";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

export default function Profile() {
  const navigate = useNavigate();
  const { user, openAuthModal } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    // Fetch user bookings from backend API
    const fetchBookings = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/user/bookings?userId=${encodeURIComponent(user.id)}`);
        if (res.ok) {
          const data = await res.json();
          setBookings(data.bookings || []);
        }
      } catch (err) {
        console.error("Error fetching user bookings:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchBookings();
  }, [user]);

  if (!user) {
    return (
      <div className={styles.container}>
        <div className={styles.authPromptCard}>
          <h2>Sign In to View Your Bookings</h2>
          <p>Please log in to your account to view your confirmed movie tickets and digital passes.</p>
          <button className={styles.loginBtn} onClick={openAuthModal}>
            Sign In to Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.profilePage}>
      <div className={styles.container}>
        {/* USER HEADER CARD */}
        <div className={styles.userHeaderCard}>
          <img src={user.avatar} alt={user.name} className={styles.userAvatar} />
          <div className={styles.userMeta}>
            <h1>{user.name}</h1>
            <p className={styles.userEmail}>{user.email}</p>
            <span className={styles.memberBadge}>⭐ Verified Moviegoer</span>
          </div>
        </div>

        {/* BOOKED TICKETS SECTION */}
        <div className={styles.ticketsSection}>
          <div className={styles.sectionTitle}>
            <h2>My Confirmed Tickets & Passes</h2>
            <p>Your active reservations and digital entry passes</p>
          </div>

          {loading ? (
            <div className={styles.loadingSpinner}>Loading your tickets...</div>
          ) : bookings.length === 0 ? (
            <div className={styles.noTicketsCard}>
              <span className={styles.emptyIcon}>🎟️</span>
              <h3>No Booked Tickets Yet</h3>
              <p>You haven't booked any seats yet. Explore trending movies and concerts now!</p>
              <button className={styles.exploreBtn} onClick={() => navigate("/movies")}>
                Browse Movies & Shows
              </button>
            </div>
          ) : (
            <div className={styles.ticketsGrid}>
              {bookings.map((ticket) => (
                <div key={ticket.booking_id} className={styles.ticketCard}>
                  <div className={styles.cardHeader}>
                    <span className={styles.passLabel}>DIGITAL ENTRY PASS</span>
                    <span className={styles.confirmedBadge}>✓ CONFIRMED</span>
                  </div>

                  <div className={styles.cardMain}>
                    <img
                      src={ticket.movie_poster || "https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=800&auto=format&fit=crop"}
                      alt={ticket.movie_title}
                      className={styles.poster}
                    />

                    <div className={styles.showInfo}>
                      <h3 className={styles.movieTitle}>{ticket.movie_title || "Dune: Part Two"}</h3>
                      <p className={styles.slot}>🕒 {ticket.show_time || "03:15 PM"}</p>
                      <p className={styles.hall}>📍 {ticket.hall || "PVR IMAX"}</p>
                      <p className={styles.bookingId}>Booking ID: <code>#{ticket.booking_id.substring(0, 8).toUpperCase()}</code></p>
                    </div>
                  </div>

                  <div className={styles.cardFooter}>
                    <div className={styles.seatMeta}>
                      <span className={styles.label}>Seat Number</span>
                      <span className={styles.seatVal}>{ticket.seat_id} ({ticket.section_id})</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
