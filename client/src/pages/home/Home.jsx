import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { featuredMovies, categories } from "../../data/moviesData";
import styles from "./Home.module.scss";

export default function Home() {
  const navigate = useNavigate();
  const [selectedCategory, setSelectedCategory] = useState("All");
  const heroMovie = featuredMovies[0]; // Dune: Part Two

  const filteredMovies =
    selectedCategory === "All"
      ? featuredMovies
      : featuredMovies.filter((m) =>
          m.category.toLowerCase().includes(selectedCategory.toLowerCase())
        );

  return (
    <div className={styles.homePage}>
      {/* HERO SECTION */}
      <section
        className={styles.hero}
        style={{ backgroundImage: `url(${heroMovie.backdrop})` }}
      >
        <div className={styles.heroOverlay}></div>
        <div className={styles.heroContent}>
          <div className={styles.badgeGroup}>
            <span className={styles.categoryBadge}>{heroMovie.category}</span>
            <span className={styles.ratingBadge}>★ {heroMovie.rating}</span>
            <span className={styles.formatBadge}>{heroMovie.format}</span>
          </div>

          <h1 className={styles.heroTitle}>{heroMovie.title}</h1>
          <p className={styles.heroMeta}>
            <span>{heroMovie.genre}</span> • <span>{heroMovie.duration}</span> • <span>{heroMovie.language}</span>
          </p>
          <p className={styles.heroDesc}>{heroMovie.description}</p>

          <div className={styles.heroActions}>
            <button
              className={styles.primaryBtn}
              onClick={() => navigate(`/movies?movie=${heroMovie.id}`)}
            >
              🎟️ Book Tickets Now
            </button>
            <button
              className={styles.secondaryBtn}
              onClick={() => navigate("/movies")}
            >
              Explore All Shows
            </button>
          </div>
        </div>
      </section>

      {/* MAIN CONTAINER */}
      <div className={styles.container}>
        {/* CATEGORY FILTER PILLS */}
        <section className={styles.filterSection}>
          <div className={styles.sectionHeader}>
            <h2>Now Showing & Upcoming</h2>
            <p>Select your favorite movies, concerts & live experiences</p>
          </div>

          <div className={styles.categoryPills}>
            {categories.map((cat) => (
              <button
                key={cat}
                className={`${styles.pill} ${
                  selectedCategory === cat ? styles.activePill : ""
                }`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </section>

        {/* MOVIES GRID */}
        <section className={styles.moviesGrid}>
          {filteredMovies.map((movie) => (
            <div key={movie.id} className={styles.movieCard}>
              <div className={styles.posterWrapper}>
                <img src={movie.poster} alt={movie.title} className={styles.poster} />
                <span className={styles.cardRating}>★ {movie.rating}</span>
                <span className={styles.cardFormat}>{movie.format.split(",")[0]}</span>
              </div>

              <div className={styles.cardDetails}>
                <span className={styles.cardGenre}>{movie.genre}</span>
                <h3 className={styles.cardTitle}>{movie.title}</h3>
                <p className={styles.cardMeta}>{movie.language} • {movie.duration}</p>

                <div className={styles.cardFooter}>
                  <button
                    className={styles.bookCardBtn}
                    onClick={() => navigate(`/movies?movie=${movie.id}`)}
                  >
                    Select Showtimes
                  </button>
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* FEATURES SHOWCASE BANNER */}
        <section className={styles.featuresBanner}>
          <div className={styles.featureItem}>
            <span className={styles.featureIcon}>⚡</span>
            <div>
              <h4>Real-Time Seat Locks</h4>
              <p>Redis-powered distributed locking prevents double bookings instantly.</p>
            </div>
          </div>
          <div className={styles.featureItem}>
            <span className={styles.featureIcon}>⏱️</span>
            <div>
              <h4>120-Second Hold Timer</h4>
              <p>Lock your seats while you enter payment details comfortably.</p>
            </div>
          </div>
          <div className={styles.featureItem}>
            <span className={styles.featureIcon}>🛡️</span>
            <div>
              <h4>Instant Confirmation</h4>
              <p>Asynchronous queue architecture ensures guaranteed tickets.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
