import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import styles from "./Navbar.module.scss";

export default function Navbar() {
  const location = useLocation();
  const { user, openAuthModal, logout } = useAuth();

  return (
    <header className={styles.navbar}>
      <div className={styles.container}>
        <Link to="/" className={styles.logo}>
          <span className={styles.logoIcon}>🎟️</span>
          <span className={styles.logoText}>Cine<span className={styles.highlight}>Pulse</span></span>
        </Link>

        <nav className={styles.navLinks}>
          <Link
            to="/"
            className={`${styles.link} ${location.pathname === "/" ? styles.active : ""}`}
          >
            Home
          </Link>
          <Link
            to="/movies"
            className={`${styles.link} ${location.pathname === "/movies" ? styles.active : ""}`}
          >
            Movies & Shows
          </Link>
          <Link
            to="/booking"
            className={`${styles.link} ${location.pathname === "/booking" ? styles.active : ""}`}
          >
            Seat Map
          </Link>
          {user && (
            <Link
              to="/profile"
              className={`${styles.link} ${location.pathname === "/profile" ? styles.active : ""}`}
            >
              My Bookings
            </Link>
          )}
        </nav>

        <div className={styles.rightSection}>
          <div className={styles.searchBar}>
            <span className={styles.searchIcon}>🔍</span>
            <input type="text" placeholder="Search movies, concerts..." />
          </div>

          {user ? (
            <div className={styles.userProfile}>
              <Link to="/profile">
                <img src={user.avatar} alt={user.name} className={styles.avatar} />
              </Link>
              <div className={styles.userInfo}>
                <Link to="/profile" className={styles.userNameLink}>
                  <span className={styles.userName}>{user.name}</span>
                </Link>
                <button onClick={logout} className={styles.logoutBtn}>
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            <button className={styles.signInBtn} onClick={openAuthModal}>
              Sign In
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
